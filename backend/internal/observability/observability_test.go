package observability

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
	recovermw "github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

type capturedLogger struct {
	mu     sync.Mutex
	events []Event
}

func (l *capturedLogger) Log(event Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, event)
}

func (l *capturedLogger) Events() []Event {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]Event(nil), l.events...)
}

func TestMiddlewareCorrelatesRequestsWithoutLoggingRequestInput(t *testing.T) {
	logger := &capturedLogger{}
	telemetry := New(logger)
	app := fiber.New()
	app.Use(telemetry.Middleware())

	var handlerRequestID string
	app.Get("/widgets/:id", func(c *fiber.Ctx) error {
		handlerRequestID = RequestID(c)
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/widgets/42?draft=private-manuscript", nil)
	req.Header.Set(RequestIDHeader, "judge-run-42")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusNoContent)
	}
	if got := resp.Header.Get(RequestIDHeader); got != "judge-run-42" {
		t.Errorf("response request ID = %q, want propagated ID", got)
	}
	if handlerRequestID != "judge-run-42" {
		t.Errorf("handler request ID = %q, want propagated ID", handlerRequestID)
	}

	events := logger.Events()
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	event := events[0]
	if event.Event != "http_request" || event.Method != http.MethodGet || event.Status != fiber.StatusNoContent || event.Outcome != "success" {
		t.Errorf("event = %#v, want structured successful request metadata", event)
	}
	if event.Path != "/widgets/:id" {
		t.Errorf("event path = %q, want route template", event.Path)
	}
	if event.RequestID != "judge-run-42" {
		t.Errorf("event request ID = %q, want propagated ID", event.RequestID)
	}

	snapshot := telemetry.Snapshot()
	if snapshot.Requests.Total != 1 || snapshot.Requests.ServerErrors != 0 {
		t.Errorf("request metrics = %#v, want one successful request", snapshot.Requests)
	}
}

func TestMiddlewareReplacesUnsafeRequestIDAndClassifiesServerErrors(t *testing.T) {
	logger := &capturedLogger{}
	telemetry := New(logger)
	app := fiber.New()
	app.Use(telemetry.Middleware())
	app.Get("/unavailable", func(*fiber.Ctx) error {
		return fiber.NewError(fiber.StatusServiceUnavailable, "dependency unavailable")
	})

	req := httptest.NewRequest(http.MethodGet, "/unavailable", nil)
	req.Header.Set(RequestIDHeader, "not safe with spaces")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
	requestID := resp.Header.Get(RequestIDHeader)
	if requestID == "not safe with spaces" {
		t.Fatal("unsafe request ID was propagated")
	}
	if _, err := uuid.Parse(requestID); err != nil {
		t.Errorf("replacement request ID = %q, want UUID: %v", requestID, err)
	}

	event := logger.Events()[0]
	if event.Status != fiber.StatusServiceUnavailable || event.Outcome != "server_error" {
		t.Errorf("event = %#v, want server-error outcome", event)
	}
	if event.RequestID != requestID {
		t.Errorf("event request ID = %q, want response ID %q", event.RequestID, requestID)
	}

	snapshot := telemetry.Snapshot()
	if snapshot.Requests.ServerErrors != 1 {
		t.Errorf("server errors = %d, want 1", snapshot.Requests.ServerErrors)
	}
}

func TestMiddlewareRecordsRecoveredPanicAsServerError(t *testing.T) {
	logger := &capturedLogger{}
	telemetry := New(logger)
	app := fiber.New()
	app.Use(telemetry.Middleware())
	app.Use(recovermw.New())
	app.Get("/panic", func(*fiber.Ctx) error {
		panic("unexpected failure")
	})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/panic", nil))
	if err != nil {
		t.Fatalf("panic request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
	event := logger.Events()[0]
	if event.Status != fiber.StatusInternalServerError || event.Outcome != "server_error" {
		t.Errorf("event = %#v, want recovered server-error outcome", event)
	}
}

func TestStatusExposesBoundedGraphAndWebSocketSignals(t *testing.T) {
	telemetry := New(nil)
	app := fiber.New()
	app.Use(telemetry.Middleware())
	app.Get("/api/v1/universes/:universe_id/graph", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusBadGateway)
	})
	app.Get("/api/v1/ws", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})
	app.Get("/api/v1/status", telemetry.Status)

	for _, path := range []string{"/api/v1/universes/known-universe/graph", "/api/v1/ws"} {
		resp, err := app.Test(httptest.NewRequest(http.MethodGet, path, nil))
		if err != nil {
			t.Fatalf("request %s: %v", path, err)
		}
		resp.Body.Close()
	}

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/status", nil))
	if err != nil {
		t.Fatalf("status request: %v", err)
	}
	defer resp.Body.Close()

	var snapshot StatusSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if snapshot.Status != "ok" {
		t.Errorf("status = %q, want ok", snapshot.Status)
	}
	if graph := snapshot.Signals[SignalGraphHTTP]; graph.Total != 1 || graph.ServerErrors != 1 {
		t.Errorf("graph signal = %#v, want one server error", graph)
	}
	if ws := snapshot.Signals[SignalWSHandshake]; ws.Total != 1 || ws.ServerErrors != 0 {
		t.Errorf("WS signal = %#v, want one successful handshake boundary", ws)
	}
}

var errQueueUnavailable = errors.New("queue unavailable")

type submitterStub struct {
	err error
}

func (s submitterStub) SubmitParagraph(context.Context, string, string, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return s.err
}

func TestInstrumentParagraphSubmitterRecordsQueueOutcome(t *testing.T) {
	tests := []struct {
		name             string
		err              error
		wantServerErrors uint64
	}{
		{name: "accepted", wantServerErrors: 0},
		{name: "rejected", err: errQueueUnavailable, wantServerErrors: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			telemetry := New(nil)
			submitter := telemetry.InstrumentParagraphSubmitter(submitterStub{err: tt.err})
			err := submitter.SubmitParagraph(context.Background(), "submission", "paragraph", uuid.New(), uuid.New(), uuid.New(), uuid.New(), "private draft text")
			if !errors.Is(err, tt.err) {
				t.Errorf("SubmitParagraph error = %v, want %v", err, tt.err)
			}

			signal := telemetry.Snapshot().Signals[SignalAnalysisEnqueue]
			if signal.Total != 1 || signal.ServerErrors != tt.wantServerErrors {
				t.Errorf("analysis enqueue signal = %#v, want total 1 and server errors %d", signal, tt.wantServerErrors)
			}
		})
	}
}
