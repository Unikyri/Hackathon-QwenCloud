package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

type universeAccessTestResolver struct {
	universe *models.Universe
	err      error
}

func (r universeAccessTestResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Universe, error) {
	return r.universe, r.err
}

func TestUniverseAccessRejectsUnauthenticatedAndForeignUsers(t *testing.T) {
	universeID := uuid.New()
	ownerID := uuid.New()

	t.Run("unauthenticated", func(t *testing.T) {
		app := fiber.New()
		app.Get("/universes/:id", func(c *fiber.Ctx) error {
			if err := authorizeUniverse(c, universeAccessTestResolver{universe: &models.Universe{ID: universeID, UserID: ownerID}}, universeID); err != nil {
				return universeAccessError(c, err)
			}
			return c.SendStatus(fiber.StatusNoContent)
		})

		resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/universes/"+universeID.String(), nil))
		if err != nil {
			t.Fatalf("app.Test: %v", err)
		}
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
		}
	})

	t.Run("foreign user", func(t *testing.T) {
		app := fiber.New()
		app.Use(func(c *fiber.Ctx) error {
			c.Locals("user_id", uuid.New())
			return c.Next()
		})
		app.Get("/universes/:id", func(c *fiber.Ctx) error {
			if err := authorizeUniverse(c, universeAccessTestResolver{universe: &models.Universe{ID: universeID, UserID: ownerID}}, universeID); err != nil {
				return universeAccessError(c, err)
			}
			return c.SendStatus(fiber.StatusNoContent)
		})

		resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/universes/"+universeID.String(), nil))
		if err != nil {
			t.Fatalf("app.Test: %v", err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusForbidden)
		}
	})
}

func TestExploreAndReviewHandlersRejectForeignUniverse(t *testing.T) {
	universeID := uuid.New()
	resolver := universeAccessTestResolver{universe: &models.Universe{ID: universeID, UserID: uuid.New()}}

	tests := []struct {
		name     string
		method   string
		path     string
		register func(*fiber.App)
	}{
		{
			name:   "entities list",
			method: http.MethodGet,
			path:   "/universes/" + universeID.String() + "/entities",
			register: func(app *fiber.App) {
				h := NewEntityHandler(services.NewEntityService(nil, repositories.NewEntityRepo(nil), nil, nil))
				h.SetUniverseOwnerRepo(resolver)
				app.Get("/universes/:universe_id/entities", h.ListByUniverse)
			},
		},
		{
			name:   "timeline list",
			method: http.MethodGet,
			path:   "/universes/" + universeID.String() + "/timeline",
			register: func(app *fiber.App) {
				h := NewTimelineHandler(nil, repositories.NewTimelineRepo(nil))
				h.SetUniverseOwnerRepo(resolver)
				app.Get("/universes/:universe_id/timeline", h.ListByUniverse)
			},
		},
		{
			name:   "contradiction resolve",
			method: http.MethodPut,
			path:   "/universes/" + universeID.String() + "/contradictions/" + uuid.NewString() + "/resolve",
			register: func(app *fiber.App) {
				h := NewContradictionHandler(nil, repositories.NewContradictionRepo(nil))
				h.SetUniverseOwnerRepo(resolver)
				app.Put("/universes/:universe_id/contradictions/:id/resolve", h.Resolve)
			},
		},
		{
			name:   "plot hole dismiss",
			method: http.MethodPut,
			path:   "/universes/" + universeID.String() + "/plot-holes/" + uuid.NewString() + "/dismiss",
			register: func(app *fiber.App) {
				h := NewPlotHoleHandler(nil).WithRepo(repositories.NewPlotHoleRepo(nil))
				h.SetUniverseOwnerRepo(resolver)
				app.Put("/universes/:universe_id/plot-holes/:id/dismiss", h.Dismiss)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			app.Use(func(c *fiber.Ctx) error {
				c.Locals("user_id", uuid.New())
				return c.Next()
			})
			tt.register(app)

			resp, err := app.Test(httptest.NewRequest(tt.method, tt.path, nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusForbidden)
			}
		})
	}
}
