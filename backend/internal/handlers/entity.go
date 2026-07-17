package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/middleware"
	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

type EntityHandler struct {
	entitySvc *services.EntityService
	ownerRepo universeOwnerResolver
}

func NewEntityHandler(entitySvc *services.EntityService) *EntityHandler {
	return &EntityHandler{entitySvc: entitySvc}
}

// SetUniverseOwnerRepo enables ownership checks while preserving the
// constructor used by focused handler tests.
func (h *EntityHandler) SetUniverseOwnerRepo(repo universeOwnerResolver) {
	h.ownerRepo = repo
}

func (h *EntityHandler) ListByUniverse(c *fiber.Ctx) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe ID"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, universeID); err != nil {
		return universeAccessError(c, err)
	}

	filters := repositories.EntityFilters{
		Type:         c.Query("type"),
		Status:       c.Query("status"),
		MinRelevance: c.QueryFloat("min_relevance"),
		Search:       c.Query("search"),
		Page:         c.QueryInt("page", 1),
		Limit:        c.QueryInt("limit", 50),
	}

	entities, total, err := h.entitySvc.ListByUniverse(c.Context(), universeID, filters)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}
	countsByType, err := h.entitySvc.CountByType(c.Context(), universeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	totalPages := total / filters.Limit
	if total%filters.Limit > 0 {
		totalPages++
	}

	return c.JSON(fiber.Map{
		"entities":       entities,
		"counts_by_type": countsByType,
		"pagination": fiber.Map{
			"page":        filters.Page,
			"limit":       filters.Limit,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

func (h *EntityHandler) GetByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid entity ID"},
		})
	}
	if h.ownerRepo != nil && middleware.GetUserID(c) == uuid.Nil {
		return universeAccessError(c, fiber.ErrUnauthorized)
	}

	e, err := h.entitySvc.GetByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "Entity not found"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, e.UniverseID); err != nil {
		return universeAccessError(c, err)
	}

	return c.JSON(fiber.Map{"entity": e})
}

func (h *EntityHandler) Update(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid entity ID"},
		})
	}
	if h.ownerRepo != nil && middleware.GetUserID(c) == uuid.Nil {
		return universeAccessError(c, fiber.ErrUnauthorized)
	}

	e, err := h.entitySvc.GetByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "Entity not found"},
		})
	}
	if err := authorizeUniverse(c, h.ownerRepo, e.UniverseID); err != nil {
		return universeAccessError(c, err)
	}

	var req models.UpdateEntityRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid request body"},
		})
	}

	e, err = h.entitySvc.Update(c.Context(), id, req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"entity": e})
}
