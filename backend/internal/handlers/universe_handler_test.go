package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
)

type universeHandlerTestResolver struct {
	universe *models.Universe
	err      error
}

func (r universeHandlerTestResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Universe, error) {
	return r.universe, r.err
}

func TestUniverseHandlerRejectsForeignUserForReadAndMutation(t *testing.T) {
	universeID := uuid.New()
	ownerID := uuid.New()
	requesterID := uuid.New()

	for _, tt := range []struct {
		name     string
		method   string
		register func(*fiber.App, *UniverseHandler)
	}{
		{"get", http.MethodGet, func(app *fiber.App, h *UniverseHandler) { app.Get("/universes/:id", h.GetByID) }},
		{"update", http.MethodPut, func(app *fiber.App, h *UniverseHandler) { app.Put("/universes/:id", h.Update) }},
		{"delete", http.MethodDelete, func(app *fiber.App, h *UniverseHandler) { app.Delete("/universes/:id", h.Delete) }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			app.Use(func(c *fiber.Ctx) error {
				c.Locals("user_id", requesterID)
				return c.Next()
			})
			h := NewUniverseHandler(nil)
			h.SetUniverseOwnerRepo(universeHandlerTestResolver{universe: &models.Universe{ID: universeID, UserID: ownerID}})
			tt.register(app, h)

			resp, err := app.Test(httptest.NewRequest(tt.method, "/universes/"+universeID.String(), nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusForbidden)
			}
		})
	}
}

func TestUniverseHandlerMapsMissingUniverseToNotFound(t *testing.T) {
	universeID := uuid.New()

	for _, tt := range []struct {
		name     string
		method   string
		register func(*fiber.App, *UniverseHandler)
	}{
		{"get", http.MethodGet, func(app *fiber.App, h *UniverseHandler) { app.Get("/universes/:id", h.GetByID) }},
		{"update", http.MethodPut, func(app *fiber.App, h *UniverseHandler) { app.Put("/universes/:id", h.Update) }},
		{"delete", http.MethodDelete, func(app *fiber.App, h *UniverseHandler) { app.Delete("/universes/:id", h.Delete) }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			app.Use(func(c *fiber.Ctx) error {
				c.Locals("user_id", uuid.New())
				return c.Next()
			})
			h := NewUniverseHandler(nil)
			h.SetUniverseOwnerRepo(universeHandlerTestResolver{err: errors.New("universe missing")})
			tt.register(app, h)

			resp, err := app.Test(httptest.NewRequest(tt.method, "/universes/"+universeID.String(), nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
			}
		})
	}
}
