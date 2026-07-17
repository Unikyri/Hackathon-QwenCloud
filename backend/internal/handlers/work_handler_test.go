package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
)

type workHandlerUniverseResolver struct {
	universe *models.Universe
	err      error
}

func (r workHandlerUniverseResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Universe, error) {
	return r.universe, r.err
}

type workHandlerWorkResolver struct {
	work *models.Work
	err  error
}

func (r workHandlerWorkResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Work, error) {
	return r.work, r.err
}

func TestWorkHandlerRejectsForeignUsers(t *testing.T) {
	callerID := uuid.New()
	foreignOwnerID := uuid.New()
	universeID := uuid.New()
	workID := uuid.New()

	h := &WorkHandler{
		ownerRepo: workHandlerUniverseResolver{universe: &models.Universe{ID: universeID, UserID: foreignOwnerID}},
		workRepo:  workHandlerWorkResolver{work: &models.Work{ID: workID, UniverseID: universeID}},
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", callerID)
		return c.Next()
	})
	app.Post("/universes/:universe_id/works", h.Create)
	app.Get("/universes/:universe_id/works", h.ListByUniverse)
	app.Get("/works/:id", h.GetByID)
	app.Put("/works/:id", h.Update)
	app.Delete("/works/:id", h.Delete)

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/universes/" + universeID.String() + "/works", `{"title":"private"}`},
		{http.MethodGet, "/universes/" + universeID.String() + "/works", ""},
		{http.MethodGet, "/works/" + workID.String(), ""},
		{http.MethodPut, "/works/" + workID.String(), `{"title":"private"}`},
		{http.MethodDelete, "/works/" + workID.String(), ""},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test %s %s: %v", tc.method, tc.path, err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s status = %d, want 403", tc.method, tc.path, resp.StatusCode)
		}
	}
}

func TestWorkHandlerReturnsNotFoundForMissingWork(t *testing.T) {
	h := &WorkHandler{
		ownerRepo: workHandlerUniverseResolver{universe: &models.Universe{ID: uuid.New(), UserID: uuid.New()}},
		workRepo:  workHandlerWorkResolver{err: errors.New("missing work")},
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", uuid.New())
		return c.Next()
	})
	app.Get("/works/:id", h.GetByID)

	req := httptest.NewRequest(http.MethodGet, "/works/"+uuid.New().String(), nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}
