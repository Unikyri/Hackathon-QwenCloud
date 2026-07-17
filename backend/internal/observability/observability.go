// Package observability provides the small, dependency-free operational signals
// needed to run Quill safely without exposing request bodies or user content.
package observability

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	// RequestIDHeader is returned on every HTTP response so callers can correlate
	// a failed request with its structured server event.
	RequestIDHeader = "X-Request-ID"
	// RequestIDLocalKey exposes the correlation ID to handlers without placing it
	// in a URL, body, or log payload.
	RequestIDLocalKey = "quill.request_id"

	SignalGraphHTTP       = "graph_http"
	SignalWSHandshake     = "ws_handshake"
	SignalAnalysisEnqueue = "analysis_enqueue"
)

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// Event is a deliberately narrow structured request event. It contains only
// correlation and transport metadata; request bodies, query parameters,
// credentials, and error text are never recorded.
type Event struct {
	Event      string    `json:"event"`
	Timestamp  time.Time `json:"timestamp"`
	RequestID  string    `json:"request_id"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Status     int       `json:"status"`
	DurationMS float64   `json:"duration_ms"`
	Outcome    string    `json:"outcome"`
}

// EventLogger makes structured event delivery testable without coupling tests
// to the standard logger's text formatting.
type EventLogger interface {
	Log(Event)
}

// EventLoggerFunc adapts a function into an EventLogger.
type EventLoggerFunc func(Event)

func (f EventLoggerFunc) Log(event Event) {
	f(event)
}

// JSONLogger writes one JSON event per line using only the standard library.
type JSONLogger struct {
	logger *log.Logger
}

func (l JSONLogger) Log(event Event) {
	if l.logger == nil {
		return
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	l.logger.Print(string(payload))
}

type counters struct {
	total        uint64
	clientErrors uint64
	serverErrors uint64
	latencyTotal time.Duration
	latencyMax   time.Duration
}

// LatencySnapshot avoids percentiles and unbounded histograms while still
// making elevated latency visible in a small status response.
type LatencySnapshot struct {
	AverageMS float64 `json:"average_ms"`
	MaxMS     float64 `json:"max_ms"`
}

// MetricSnapshot is a bounded aggregate. It deliberately has no per-user,
// per-request, or raw-path dimensions.
type MetricSnapshot struct {
	Total        uint64          `json:"total"`
	ClientErrors uint64          `json:"client_errors"`
	ServerErrors uint64          `json:"server_errors"`
	Latency      LatencySnapshot `json:"latency_ms"`
}

// StatusSnapshot is returned by the safe /api/v1/status route. Values reset
// on process restart and should be compared as counter deltas by an operator.
type StatusSnapshot struct {
	Status        string                    `json:"status"`
	UptimeSeconds int64                     `json:"uptime_seconds"`
	Requests      MetricSnapshot            `json:"requests"`
	Signals       map[string]MetricSnapshot `json:"signals"`
}

// Telemetry owns bounded, process-local request and operation aggregates.
// It intentionally has no external exporter or background worker.
type Telemetry struct {
	startedAt time.Time
	logger    EventLogger

	mu       sync.RWMutex
	requests counters
	signals  map[string]*counters
}

// New creates a telemetry recorder. A nil logger disables event emission while
// retaining metrics, which is useful for focused tests.
func New(logger EventLogger) *Telemetry {
	return &Telemetry{
		startedAt: time.Now(),
		logger:    logger,
		signals: map[string]*counters{
			SignalGraphHTTP:       {},
			SignalWSHandshake:     {},
			SignalAnalysisEnqueue: {},
		},
	}
}

// NewDefault creates production telemetry with raw JSON lines on stderr.
func NewDefault() *Telemetry {
	return New(JSONLogger{logger: log.New(os.Stderr, "", 0)})
}

// RequestID returns the validated correlation ID assigned by Middleware.
func RequestID(c *fiber.Ctx) string {
	if c == nil {
		return ""
	}

	requestID, _ := c.Locals(RequestIDLocalKey).(string)
	return requestID
}

// Middleware assigns a validated correlation ID, emits a structured event, and
// records bounded HTTP aggregates. It never examines request or response bodies.
func (t *Telemetry) Middleware() fiber.Handler {
	if t == nil {
		return func(c *fiber.Ctx) error { return c.Next() }
	}

	return func(c *fiber.Ctx) error {
		startedAt := time.Now()
		requestID := c.Get(RequestIDHeader)
		if !validRequestID.MatchString(requestID) {
			requestID = uuid.NewString()
		}
		c.Locals(RequestIDLocalKey, requestID)
		c.Set(RequestIDHeader, requestID)

		err := c.Next()
		status := statusForError(err, c.Response().StatusCode())
		path := normalizedPath(c)
		elapsed := time.Since(startedAt)
		outcome := outcomeFor(status)

		t.recordHTTPRequest(path, elapsed, outcome)
		if t.logger != nil {
			t.logger.Log(Event{
				Event:      "http_request",
				Timestamp:  time.Now().UTC(),
				RequestID:  requestID,
				Method:     c.Method(),
				Path:       path,
				Status:     status,
				DurationMS: durationMilliseconds(elapsed),
				Outcome:    outcome,
			})
		}

		return err
	}
}

// Status returns the dependency-free status/metrics surface. Health dependency
// checks remain the responsibility of the existing health handler.
func (t *Telemetry) Status(c *fiber.Ctx) error {
	return c.JSON(t.Snapshot())
}

// Snapshot returns a copy of current bounded aggregate state.
func (t *Telemetry) Snapshot() StatusSnapshot {
	if t == nil {
		return StatusSnapshot{
			Status:  "unavailable",
			Signals: map[string]MetricSnapshot{},
		}
	}

	t.mu.RLock()
	defer t.mu.RUnlock()

	signals := make(map[string]MetricSnapshot, len(t.signals))
	for name, counter := range t.signals {
		signals[name] = counter.snapshot()
	}

	return StatusSnapshot{
		Status:        "ok",
		UptimeSeconds: int64(time.Since(t.startedAt).Seconds()),
		Requests:      t.requests.snapshot(),
		Signals:       signals,
	}
}

// ParagraphSubmitter is the narrow analysis queue boundary supplied by ws.Hub.
// It is declared here to avoid coupling the observability package to ws.
type ParagraphSubmitter interface {
	SubmitParagraph(ctx context.Context, submissionID, paragraphRef string, workID, chapterID, universeID, userID uuid.UUID, text string) error
}

// InstrumentParagraphSubmitter records only the synchronous queue-enqueue
// boundary. It does not retain or log the paragraph text or identifiers.
func (t *Telemetry) InstrumentParagraphSubmitter(next ParagraphSubmitter) ParagraphSubmitter {
	return instrumentedParagraphSubmitter{next: next, telemetry: t}
}

type instrumentedParagraphSubmitter struct {
	next      ParagraphSubmitter
	telemetry *Telemetry
}

func (s instrumentedParagraphSubmitter) SubmitParagraph(ctx context.Context, submissionID, paragraphRef string, workID, chapterID, universeID, userID uuid.UUID, text string) error {
	startedAt := time.Now()
	if s.next == nil {
		err := errors.New("analysis submitter unavailable")
		if s.telemetry != nil {
			s.telemetry.recordSignal(SignalAnalysisEnqueue, time.Since(startedAt), outcomeFor(fiber.StatusServiceUnavailable))
		}
		return err
	}

	err := s.next.SubmitParagraph(ctx, submissionID, paragraphRef, workID, chapterID, universeID, userID, text)
	if s.telemetry != nil {
		outcome := outcomeFor(fiber.StatusOK)
		if err != nil {
			outcome = "server_error"
		}
		s.telemetry.recordSignal(SignalAnalysisEnqueue, time.Since(startedAt), outcome)
	}
	return err
}

func (t *Telemetry) recordHTTPRequest(path string, elapsed time.Duration, outcome string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	record(&t.requests, elapsed, outcome)
	if signal := signalForHTTPPath(path); signal != "" {
		record(t.signals[signal], elapsed, outcome)
	}
}

func (t *Telemetry) recordSignal(signal string, elapsed time.Duration, outcome string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	counter, ok := t.signals[signal]
	if !ok {
		counter = &counters{}
		t.signals[signal] = counter
	}
	record(counter, elapsed, outcome)
}

func record(counter *counters, elapsed time.Duration, outcome string) {
	counter.total++
	counter.latencyTotal += elapsed
	if elapsed > counter.latencyMax {
		counter.latencyMax = elapsed
	}

	switch outcome {
	case "client_error":
		counter.clientErrors++
	case "server_error":
		counter.serverErrors++
	}
}

func (c counters) snapshot() MetricSnapshot {
	latency := LatencySnapshot{MaxMS: durationMilliseconds(c.latencyMax)}
	if c.total > 0 {
		latency.AverageMS = durationMilliseconds(c.latencyTotal) / float64(c.total)
	}

	return MetricSnapshot{
		Total:        c.total,
		ClientErrors: c.clientErrors,
		ServerErrors: c.serverErrors,
		Latency:      latency,
	}
}

func normalizedPath(c *fiber.Ctx) string {
	if route := c.Route(); route != nil && route.Path != "" {
		return route.Path
	}
	return "<unmatched>"
}

func signalForHTTPPath(path string) string {
	switch {
	case path == "/api/v1/ws":
		return SignalWSHandshake
	case strings.HasSuffix(path, "/graph"), strings.HasSuffix(path, "/neighbors"):
		return SignalGraphHTTP
	default:
		return ""
	}
}

func statusForError(err error, status int) int {
	if err == nil {
		if status == 0 {
			return fiber.StatusOK
		}
		return status
	}

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return fiberErr.Code
	}
	return fiber.StatusInternalServerError
}

func outcomeFor(status int) string {
	switch {
	case status >= fiber.StatusInternalServerError:
		return "server_error"
	case status >= fiber.StatusBadRequest:
		return "client_error"
	default:
		return "success"
	}
}

func durationMilliseconds(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}
