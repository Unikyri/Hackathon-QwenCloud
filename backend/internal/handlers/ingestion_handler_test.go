package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
)

// mockIngestionSvc returns a fixed job ID and records calls.
type mockIngestionSvc struct {
	jobID     uuid.UUID
	duplicate bool
	err       error
	jobs      []models.IngestionJob
}

type ingestionOwnerResolver struct {
	universe *models.Universe
}

func (r ingestionOwnerResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Universe, error) {
	return r.universe, nil
}

func (m *mockIngestionSvc) Start(ctx context.Context, universeID uuid.UUID, reader io.Reader, filename string) (uuid.UUID, bool, error) {
	return m.jobID, m.duplicate, m.err
}

func (m *mockIngestionSvc) ListJobs(ctx context.Context, universeID uuid.UUID) ([]models.IngestionJob, error) {
	return m.jobs, m.err
}

// TestIngestionHandlerPost verifies:
// - 202 Accepted response
// - job_id in response body
// - invalid universe ID returns 400
func TestIngestionHandlerPost(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: func(c *fiber.Ctx, err error) error {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}})

	jobID := uuid.New()
	mockSvc := &mockIngestionSvc{jobID: jobID}
	h := &IngestionHandler{ingestionSvc: mockSvc}
	app.Post("/api/v1/universes/:id/ingest", h.Ingest)

	// Build multipart form with a file
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "document.md")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("# Chapter 1\nTest content."))
	w.Close()

	universeID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/universes/"+universeID.String()+"/ingest", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}

	if resp.StatusCode != http.StatusAccepted {
		t.Errorf("expected 202 Accepted, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if body["job_id"] != jobID.String() {
		t.Errorf("job_id: got %q, want %q", body["job_id"], jobID.String())
	}
	if body["status"] != "accepted" {
		t.Errorf("status: got %q, want %q", body["status"], "accepted")
	}
}

// TestIngestionHandlerDuplicate verifies a duplicate upload responds 200
// with status "duplicate" and the existing job's ID.
func TestIngestionHandlerDuplicate(t *testing.T) {
	app := fiber.New()

	jobID := uuid.New()
	h := &IngestionHandler{ingestionSvc: &mockIngestionSvc{jobID: jobID, duplicate: true}}
	app.Post("/api/v1/universes/:id/ingest", h.Ingest)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "document.md")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("# Chapter 1\nTest content."))
	w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/universes/"+uuid.New().String()+"/ingest", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK for duplicate, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["status"] != "duplicate" {
		t.Errorf("status: got %q, want %q", body["status"], "duplicate")
	}
	if body["job_id"] != jobID.String() {
		t.Errorf("job_id: got %q, want %q", body["job_id"], jobID.String())
	}
}

// TestIngestionHandlerJobs verifies GET /universes/:id/ingestions returns
// the service's job list.
func TestIngestionHandlerJobs(t *testing.T) {
	app := fiber.New()

	job := models.IngestionJob{ID: uuid.New(), Status: "completed"}
	h := &IngestionHandler{ingestionSvc: &mockIngestionSvc{jobs: []models.IngestionJob{job}}}
	app.Get("/api/v1/universes/:id/ingestions", h.Jobs)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/universes/"+uuid.New().String()+"/ingestions", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", resp.StatusCode)
	}

	var body struct {
		Jobs []models.IngestionJob `json:"jobs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Jobs) != 1 || body.Jobs[0].ID != job.ID {
		t.Errorf("jobs: got %+v, want one job with ID %s", body.Jobs, job.ID)
	}
}

// TestIngestionHandlerInvalidID verifies 400 for bad UUID.
func TestIngestionHandlerInvalidID(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: func(c *fiber.Ctx, err error) error {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}})

	h := &IngestionHandler{}
	app.Post("/api/v1/universes/:id/ingest", h.Ingest)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/universes/not-a-uuid/ingest", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", resp.StatusCode)
	}
}

// TestIngestionHandlerNoFile verifies 400 when no file is attached.
func TestIngestionHandlerNoFile(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: func(c *fiber.Ctx, err error) error {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}})

	h := &IngestionHandler{}
	app.Post("/api/v1/universes/:id/ingest", h.Ingest)

	universeID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/universes/"+universeID.String()+"/ingest", nil)
	// No multipart form at all
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for no file, got %d", resp.StatusCode)
	}
}

func TestIngestionHandlerRejectsForeignUniverse(t *testing.T) {
	app := fiber.New()
	callerID := uuid.New()
	h := &IngestionHandler{
		ingestionSvc: &mockIngestionSvc{},
		ownerRepo:    ingestionOwnerResolver{universe: &models.Universe{UserID: uuid.New()}},
	}
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", callerID)
		return c.Next()
	})
	app.Post("/api/v1/universes/:id/ingest", h.Ingest)
	app.Get("/api/v1/universes/:id/ingestions", h.Jobs)

	universeID := uuid.New()
	for _, path := range []string{
		"/api/v1/universes/" + universeID.String() + "/ingest",
		"/api/v1/universes/" + universeID.String() + "/ingestions",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if path[len(path)-1] != 's' {
			req = httptest.NewRequest(http.MethodPost, path, nil)
		}
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test %s: %v", path, err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s status = %d, want 403", path, resp.StatusCode)
		}
	}
}
