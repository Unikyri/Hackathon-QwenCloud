package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

// PlotHoleHandler serves plot-hole-related REST endpoints.
type PlotHoleHandler struct {
	plotHoleSvc  *services.PlotHoleService
	plotHoleRepo *repositories.PlotHoleRepo
	ownerRepo    universeOwnerResolver
}

// NewPlotHoleHandler creates a plot hole handler.
// If plotHoleRepo is nil, listing falls back to the service's internal repo.
func NewPlotHoleHandler(plotHoleSvc *services.PlotHoleService) *PlotHoleHandler {
	return &PlotHoleHandler{plotHoleSvc: plotHoleSvc}
}

// WithRepo sets the PlotHoleRepo for read and status-update operations.
func (h *PlotHoleHandler) WithRepo(repo *repositories.PlotHoleRepo) *PlotHoleHandler {
	h.plotHoleRepo = repo
	return h
}

// SetUniverseOwnerRepo enables production ownership checks without changing
// the existing constructor contract.
func (h *PlotHoleHandler) SetUniverseOwnerRepo(repo universeOwnerResolver) {
	h.ownerRepo = repo
}

// ListByUniverse returns all plot holes for a universe.
// GET /api/v1/universes/:universe_id/plot-holes
func (h *PlotHoleHandler) ListByUniverse(c *fiber.Ctx) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe_id"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, universeID); err != nil {
		return universeAccessError(c, err)
	}

	if h.plotHoleRepo == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": "PlotHoleRepo not initialized"},
		})
	}

	holes, err := h.plotHoleRepo.ListByUniverse(c.Context(), universeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	if holes == nil {
		holes = []models.PlotHole{}
	}

	return c.JSON(fiber.Map{
		"plot_holes": holes,
	})
}

// Dismiss marks a plot hole as dismissed within its universe.
// PUT /api/v1/universes/:universe_id/plot-holes/:id/dismiss
func (h *PlotHoleHandler) Dismiss(c *fiber.Ctx) error {
	return h.updateStatus(c, "dismissed")
}

// Resolve marks a plot hole as resolved within its universe.
// PUT /api/v1/universes/:universe_id/plot-holes/:id/resolve
func (h *PlotHoleHandler) Resolve(c *fiber.Ctx) error {
	return h.updateStatus(c, "resolved")
}

func (h *PlotHoleHandler) updateStatus(c *fiber.Ctx, status string) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe_id"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, universeID); err != nil {
		return universeAccessError(c, err)
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid plot hole ID"},
		})
	}
	if h.plotHoleRepo == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": "PlotHoleRepo not initialized"},
		})
	}

	var updateErr error
	if status == "resolved" {
		updateErr = h.plotHoleRepo.Resolve(c.Context(), id, universeID)
	} else {
		updateErr = h.plotHoleRepo.Dismiss(c.Context(), id, universeID)
	}
	if errors.Is(updateErr, repositories.ErrPlotHoleNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "Plot hole not found"},
		})
	}
	if updateErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": updateErr.Error()},
		})
	}

	return c.JSON(fiber.Map{"status": status})
}
