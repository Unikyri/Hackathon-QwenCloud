package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

type WorkHandler struct {
	workSvc   *services.WorkService
	ownerRepo universeOwnerResolver
	workRepo  workOwnerResolver
}

func NewWorkHandler(workSvc *services.WorkService) *WorkHandler {
	return &WorkHandler{workSvc: workSvc}
}

// SetOwnershipRepos wires the parent-universe and work lookups used by every
// work route in production while keeping focused handler construction stable.
func (h *WorkHandler) SetOwnershipRepos(ownerRepo universeOwnerResolver, workRepo workOwnerResolver) {
	h.ownerRepo = ownerRepo
	h.workRepo = workRepo
}

func (h *WorkHandler) authorizeUniverse(c *fiber.Ctx, universeID uuid.UUID) error {
	if h.ownerRepo == nil {
		return fiber.ErrForbidden
	}
	return authorizeUniverse(c, h.ownerRepo, universeID)
}

func (h *WorkHandler) authorizeWork(c *fiber.Ctx, workID uuid.UUID) (*models.Work, error) {
	if h.ownerRepo == nil || h.workRepo == nil {
		return nil, fiber.ErrForbidden
	}
	work, err := h.workRepo.FindByID(c.Context(), workID)
	if err != nil || work == nil {
		return nil, fiber.ErrNotFound
	}
	if err := h.authorizeUniverse(c, work.UniverseID); err != nil {
		return nil, err
	}
	return work, nil
}

func workAccessError(c *fiber.Ctx, err error) error {
	if errors.Is(err, fiber.ErrNotFound) || errors.Is(err, repositories.ErrWorkNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "Work not found"},
		})
	}
	return universeAccessError(c, err)
}

func (h *WorkHandler) Create(c *fiber.Ctx) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe ID"},
		})
	}
	if err := h.authorizeUniverse(c, universeID); err != nil {
		return universeAccessError(c, err)
	}

	var req models.CreateWorkRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid request body"},
		})
	}

	w, err := h.workSvc.Create(c.Context(), universeID, req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"work": w})
}

func (h *WorkHandler) ListByUniverse(c *fiber.Ctx) error {
	universeID, err := uuid.Parse(c.Params("universe_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid universe ID"},
		})
	}
	if err := h.authorizeUniverse(c, universeID); err != nil {
		return universeAccessError(c, err)
	}

	works, err := h.workSvc.ListByUniverse(c.Context(), universeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"works": works})
}

func (h *WorkHandler) GetByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid work ID"},
		})
	}

	work, err := h.authorizeWork(c, id)
	if err != nil {
		return workAccessError(c, err)
	}

	w, err := h.workSvc.GetByIDInUniverse(c.Context(), id, work.UniverseID)
	if err != nil {
		return workAccessError(c, err)
	}

	return c.JSON(fiber.Map{"work": w})
}

func (h *WorkHandler) Update(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid work ID"},
		})
	}
	work, err := h.authorizeWork(c, id)
	if err != nil {
		return workAccessError(c, err)
	}

	var req models.CreateWorkRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid request body"},
		})
	}

	w, err := h.workSvc.Update(c.Context(), id, work.UniverseID, req)
	if err != nil {
		if errors.Is(err, repositories.ErrWorkNotFound) {
			return workAccessError(c, err)
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"work": w})
}

func (h *WorkHandler) Delete(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid work ID"},
		})
	}
	work, err := h.authorizeWork(c, id)
	if err != nil {
		return workAccessError(c, err)
	}

	if err := h.workSvc.Delete(c.Context(), id, work.UniverseID); err != nil {
		if errors.Is(err, repositories.ErrWorkNotFound) {
			return workAccessError(c, err)
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.SendStatus(fiber.StatusNoContent)
}
