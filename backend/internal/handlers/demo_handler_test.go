package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/services"
)

type demoHandlerTestService struct {
	cloneID      string
	resetID      string
	cloneErr     error
	resetErr     error
	cloneCalls   int
	resetCalls   int
	cloneUserID  uuid.UUID
	resetUserID  uuid.UUID
	cloneSession string
	resetSession string
}

func (s *demoHandlerTestService) CloneUniverse(_ context.Context, userID uuid.UUID, sessionID string) (string, error) {
	s.cloneCalls++
	s.cloneUserID = userID
	s.cloneSession = sessionID
	return s.cloneID, s.cloneErr
}

func (s *demoHandlerTestService) ResetUniverse(_ context.Context, userID uuid.UUID, sessionID string) (string, error) {
	s.resetCalls++
	s.resetUserID = userID
	s.resetSession = sessionID
	return s.resetID, s.resetErr
}

func TestDemoHandlerCloneRequiresAuthentication(t *testing.T) {
	svc := &demoHandlerTestService{cloneID: uuid.NewString()}
	app := fiber.New()
	app.Post("/demo/clone", NewDemoHandler(svc).Clone)

	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/demo/clone", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
	if svc.cloneCalls != 0 {
		t.Fatalf("CloneUniverse calls = %d, want 0", svc.cloneCalls)
	}
}

func TestDemoHandlerRequiresOpaqueSessionIDs(t *testing.T) {
	userID := uuid.New()
	svc := &demoHandlerTestService{cloneID: uuid.NewString(), resetID: uuid.NewString()}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", userID)
		return c.Next()
	})
	h := NewDemoHandler(svc)
	app.Post("/demo/clone", h.Clone)
	app.Post("/demo/reset", h.Reset)

	for _, tt := range []struct {
		name   string
		path   string
		header string
	}{
		{name: "missing clone session", path: "/demo/clone"},
		{name: "bearer token is not a session", path: "/demo/reset", header: "eyJhbGciOiJIUzI1NiJ9.payload.signature"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("X-Session-ID", tt.header)
			}
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
			}
		})
	}

	if svc.cloneCalls != 0 || svc.resetCalls != 0 {
		t.Fatalf("service must not receive invalid sessions: clone=%d reset=%d", svc.cloneCalls, svc.resetCalls)
	}
}

func TestDemoHandlerPropagatesAuthenticatedOwnerAndSession(t *testing.T) {
	userID := uuid.New()
	sessionID := uuid.NewString()
	svc := &demoHandlerTestService{cloneID: uuid.NewString(), resetID: uuid.NewString()}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", userID)
		return c.Next()
	})
	h := NewDemoHandler(svc)
	app.Post("/demo/clone", h.Clone)
	app.Post("/demo/reset", h.Reset)

	for _, tt := range []struct {
		name   string
		path   string
		calls  *int
		gotID  *uuid.UUID
		gotSID *string
	}{
		{"clone", "/demo/clone", &svc.cloneCalls, &svc.cloneUserID, &svc.cloneSession},
		{"reset", "/demo/reset", &svc.resetCalls, &svc.resetUserID, &svc.resetSession},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, nil)
			req.Header.Set("X-Session-ID", sessionID)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
			}
			if *tt.calls != 1 {
				t.Fatalf("service calls = %d, want 1", *tt.calls)
			}
			if *tt.gotID != userID {
				t.Fatalf("owner = %s, want %s", *tt.gotID, userID)
			}
			if *tt.gotSID != sessionID {
				t.Fatalf("session = %q, want %q", *tt.gotSID, sessionID)
			}
		})
	}
}

func TestDemoHandlerResetMapsMissingOwnerSessionToNotFound(t *testing.T) {
	userID := uuid.New()
	svc := &demoHandlerTestService{resetErr: services.ErrDemoUniverseNotFound}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", userID)
		return c.Next()
	})
	app.Post("/demo/reset", NewDemoHandler(svc).Reset)

	req := httptest.NewRequest(http.MethodPost, "/demo/reset", nil)
	req.Header.Set("X-Session-ID", uuid.NewString())
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if svc.resetCalls != 1 {
		t.Fatalf("ResetUniverse calls = %d, want 1", svc.resetCalls)
	}
}
