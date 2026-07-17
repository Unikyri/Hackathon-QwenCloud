package handlers

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

// ContradictionHandler serves contradiction-related REST endpoints.
type ContradictionHandler struct {
	contraSvc         *services.ContradictionService
	contradictionRepo *repositories.ContradictionRepo
	ownerRepo         universeOwnerResolver
}

// SetUniverseOwnerRepo enables production ownership checks without changing
// the existing constructor contract.
func (h *ContradictionHandler) SetUniverseOwnerRepo(repo universeOwnerResolver) {
	h.ownerRepo = repo
}

// NewContradictionHandler creates a contradiction handler.
func NewContradictionHandler(contraSvc *services.ContradictionService, contradictionRepo *repositories.ContradictionRepo) *ContradictionHandler {
	if contradictionRepo == nil {
		panic("contradictionRepo required")
	}
	return &ContradictionHandler{contraSvc: contraSvc, contradictionRepo: contradictionRepo}
}

// ListByUniverse returns all contradictions for a universe.
// GET /api/v1/universes/:universe_id/contradictions
func (h *ContradictionHandler) ListByUniverse(c *fiber.Ctx) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe_id"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, universeID); err != nil {
		return universeAccessError(c, err)
	}

	contradictions, err := h.contradictionRepo.ListByUniverse(c.Context(), universeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{
		"contradictions": contradictions,
	})
}

// Dismiss marks a contradiction as dismissed without resolving.
// PUT /api/v1/universes/:universe_id/contradictions/:id/dismiss
func (h *ContradictionHandler) Dismiss(c *fiber.Ctx) error {
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
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid contradiction ID"},
		})
	}

	if err := h.contradictionRepo.Dismiss(c.Context(), id, universeID); err != nil {
		if errors.Is(err, repositories.ErrContradictionNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fiber.Map{"code": "NOT_FOUND", "message": "Contradiction not found"},
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"status": "dismissed"})
}

// Resolve marks a contradiction as resolved.
// PUT /api/v1/universes/:universe_id/contradictions/:id/resolve
func (h *ContradictionHandler) Resolve(c *fiber.Ctx) error {
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
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid contradiction ID"},
		})
	}

	now := time.Now()
	if err := h.contradictionRepo.Resolve(c.Context(), id, universeID, &now); err != nil {
		if errors.Is(err, repositories.ErrContradictionNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fiber.Map{"code": "NOT_FOUND", "message": "Contradiction not found"},
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"status": "resolved"})
}
