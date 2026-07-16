package handlers

import (
	"context"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/middleware"
	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/services"
)

type ChapterHandler struct {
	chapterSvc  *services.ChapterService
	ownerRepo   universeOwnerResolver
	workRepo    workOwnerResolver
	chapterRepo chapterOwnerResolver
}

type workOwnerResolver interface {
	FindByID(ctx context.Context, id uuid.UUID) (*models.Work, error)
}

type chapterOwnerResolver interface {
	FindByID(ctx context.Context, id uuid.UUID) (*models.Chapter, error)
}

func NewChapterHandler(chapterSvc *services.ChapterService) *ChapterHandler {
	return &ChapterHandler{chapterSvc: chapterSvc}
}

// SetOwnershipRepos wires the narrow ownership lookups needed before chapter
// mutations. Nil seams remain supported by focused unit tests; production
// wiring supplies all three repositories.
func (h *ChapterHandler) SetOwnershipRepos(ownerRepo universeOwnerResolver, workRepo workOwnerResolver, chapterRepo chapterOwnerResolver) {
	h.ownerRepo = ownerRepo
	h.workRepo = workRepo
	h.chapterRepo = chapterRepo
}

func (h *ChapterHandler) authorizeUniverse(c *fiber.Ctx, universeID uuid.UUID) error {
	if h.ownerRepo == nil {
		return nil
	}
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return fiber.ErrUnauthorized
	}
	universe, err := h.ownerRepo.FindByID(c.Context(), universeID)
	if err != nil {
		return fiber.ErrNotFound
	}
	if universe == nil || universe.UserID != userID {
		return fiber.ErrForbidden
	}
	return nil
}

func (h *ChapterHandler) authorizeWork(c *fiber.Ctx, workID uuid.UUID) error {
	if h.ownerRepo == nil || h.workRepo == nil {
		return nil
	}
	work, err := h.workRepo.FindByID(c.Context(), workID)
	if err != nil {
		return fiber.ErrNotFound
	}
	return h.authorizeUniverse(c, work.UniverseID)
}

func (h *ChapterHandler) authorizeChapter(c *fiber.Ctx, chapterID uuid.UUID) error {
	if h.ownerRepo == nil || h.chapterRepo == nil {
		return nil
	}
	chapter, err := h.chapterRepo.FindByID(c.Context(), chapterID)
	if err != nil {
		return fiber.ErrNotFound
	}
	return h.authorizeUniverse(c, chapter.UniverseID)
}

func chapterOwnershipError(c *fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	code := "INTERNAL_ERROR"
	message := err.Error()
	switch err {
	case fiber.ErrUnauthorized:
		status, code, message = fiber.StatusUnauthorized, "UNAUTHORIZED", "authentication required"
	case fiber.ErrForbidden:
		status, code, message = fiber.StatusForbidden, "FORBIDDEN", "chapter access denied"
	case fiber.ErrNotFound:
		status, code, message = fiber.StatusNotFound, "NOT_FOUND", "chapter not found"
	}
	return c.Status(status).JSON(fiber.Map{"error": fiber.Map{"code": code, "message": message}})
}

func (h *ChapterHandler) Create(c *fiber.Ctx) error {
	workID, err := uuid.Parse(c.Params("work_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid work ID"},
		})
	}
	if err := h.authorizeWork(c, workID); err != nil {
		return chapterOwnershipError(c, err)
	}

	var req models.CreateChapterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid request body"},
		})
	}

	ch, err := h.chapterSvc.Create(c.Context(), workID, req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"chapter": ch})
}

func (h *ChapterHandler) ListByWork(c *fiber.Ctx) error {
	workID, err := uuid.Parse(c.Params("work_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid work ID"},
		})
	}
	if err := h.authorizeWork(c, workID); err != nil {
		return chapterOwnershipError(c, err)
	}

	chapters, err := h.chapterSvc.ListByWork(c.Context(), workID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"chapters": chapters})
}

func (h *ChapterHandler) GetByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid chapter ID"},
		})
	}
	if err := h.authorizeChapter(c, id); err != nil {
		return chapterOwnershipError(c, err)
	}

	ch, err := h.chapterSvc.GetByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "Chapter not found"},
		})
	}

	return c.JSON(fiber.Map{"chapter": ch})
}

func (h *ChapterHandler) Update(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid chapter ID"},
		})
	}
	if err := h.authorizeChapter(c, id); err != nil {
		return chapterOwnershipError(c, err)
	}

	var req models.UpdateChapterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid request body"},
		})
	}

	ch, err := h.chapterSvc.Update(c.Context(), id, req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
	}

	return c.JSON(fiber.Map{"chapter": ch})
}

func (h *ChapterHandler) Delete(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "Invalid chapter ID"},
		})
	}
	if err := h.authorizeChapter(c, id); err != nil {
		return chapterOwnershipError(c, err)
	}

	if err := h.chapterSvc.Delete(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()},
		})
	}

	return c.SendStatus(fiber.StatusNoContent)
}
