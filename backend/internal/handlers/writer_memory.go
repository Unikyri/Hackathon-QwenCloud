package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/middleware"
	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
)

// WriterMemoryHandler exposes the authenticated preference/evidence surface.
// Every lookup is scoped by the user ID installed by AuthMiddleware.
type WriterMemoryHandler struct {
	service   *services.WriterMemoryService
	ownerRepo interface {
		FindByID(context.Context, uuid.UUID) (*models.Universe, error)
	}
	chapterRepo interface {
		FindByID(context.Context, uuid.UUID) (*models.Chapter, error)
	}
}

func NewWriterMemoryHandler(service *services.WriterMemoryService) *WriterMemoryHandler {
	return &WriterMemoryHandler{service: service}
}

func (h *WriterMemoryHandler) SetOwnershipRepos(ownerRepo *repositories.UniverseRepo, chapterRepo *repositories.ChapterRepo) {
	h.ownerRepo = ownerRepo
	h.chapterRepo = chapterRepo
}

func (h *WriterMemoryHandler) ListPreferences(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return writerMemoryUnauthorized(c)
	}
	preferences, err := h.service.ListPreferences(c.Context(), userID, true)
	if err != nil {
		return writerMemoryError(c, err)
	}
	observations, err := h.service.ListObservations(c.Context(), userID, nil)
	if err != nil {
		return writerMemoryError(c, err)
	}
	return c.JSON(fiber.Map{"preferences": preferences, "observations": observations})
}

func (h *WriterMemoryHandler) Evidence(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return writerMemoryUnauthorized(c)
	}
	preferenceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return writerMemoryBadRequest(c, "invalid preference id")
	}
	evidence, err := h.service.Evidence(c.Context(), userID, preferenceID)
	if err != nil {
		return writerMemoryDomainError(c, err)
	}
	return c.JSON(evidence)
}

func (h *WriterMemoryHandler) Correct(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return writerMemoryUnauthorized(c)
	}
	preferenceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return writerMemoryBadRequest(c, "invalid preference id")
	}
	var req struct {
		Scope     string   `json:"scope"`
		GenreTags []string `json:"genre_tags"`
	}
	if err := c.BodyParser(&req); err != nil {
		return writerMemoryBadRequest(c, "invalid request body")
	}
	preference, err := h.service.Correct(c.Context(), userID, preferenceID, strings.TrimSpace(req.Scope), req.GenreTags)
	if err != nil {
		return writerMemoryDomainError(c, err)
	}
	return c.JSON(fiber.Map{"preference": preference})
}

func (h *WriterMemoryHandler) Deactivate(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return writerMemoryUnauthorized(c)
	}
	preferenceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return writerMemoryBadRequest(c, "invalid preference id")
	}
	if err := h.service.Deactivate(c.Context(), userID, preferenceID); err != nil {
		return writerMemoryDomainError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *WriterMemoryHandler) Feedback(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return writerMemoryUnauthorized(c)
	}
	var req struct {
		UniverseID   string                 `json:"universe_id"`
		ChapterID    string                 `json:"chapter_id"`
		NoteID       string                 `json:"note_id"`
		PreferenceID string                 `json:"preference_id"`
		Signal       string                 `json:"signal"`
		Payload      map[string]interface{} `json:"payload"`
	}
	if err := c.BodyParser(&req); err != nil {
		return writerMemoryBadRequest(c, "invalid request body")
	}
	input := services.WriterFeedbackInput{UserID: userID, Signal: req.Signal, Payload: req.Payload}
	var err error
	if input.UniverseID, err = optionalWriterUUID(req.UniverseID); err != nil {
		return writerMemoryBadRequest(c, "invalid universe_id in feedback request")
	}
	if input.ChapterID, err = optionalWriterUUID(req.ChapterID); err != nil {
		return writerMemoryBadRequest(c, "invalid chapter_id in feedback request")
	}
	if input.NoteID, err = optionalWriterUUID(req.NoteID); err != nil {
		return writerMemoryBadRequest(c, "invalid note_id in feedback request")
	}
	if input.PreferenceID, err = optionalWriterUUID(req.PreferenceID); err != nil {
		return writerMemoryBadRequest(c, "invalid preference_id in feedback request")
	}
	if err := h.authorizeFeedback(c, &input); err != nil {
		return writerMemoryDomainError(c, err)
	}
	preference, err := h.service.RecordFeedback(c.Context(), input)
	if err != nil {
		return writerMemoryDomainError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"preference": preference})
}

// Marshal helper used by tests and future WS adapters to ensure payloads stay
// JSON objects; kept private so handlers do not leak a second DTO hierarchy.
func marshalWriterPayload(payload map[string]interface{}) json.RawMessage {
	data, _ := json.Marshal(payload)
	return data
}

func writerMemoryUnauthorized(c *fiber.Ctx) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": fiber.Map{"code": "UNAUTHORIZED", "message": "authentication required"}})
}

func writerMemoryBadRequest(c *fiber.Ctx, message string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_ERROR", "message": message}})
}

func writerMemoryError(c *fiber.Ctx, err error) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": fiber.Map{"code": "INTERNAL_ERROR", "message": err.Error()}})
}

func writerMemoryDomainError(c *fiber.Ctx, err error) error {
	if errors.Is(err, fiber.ErrForbidden) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": fiber.Map{"code": "FORBIDDEN", "message": "resource access denied"}})
	}
	if errors.Is(err, fiber.ErrNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "resource not found"}})
	}
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": err.Error()}})
	}
	if errors.Is(err, services.ErrInvalidWriterFeedback) {
		return writerMemoryBadRequest(c, err.Error())
	}
	if errors.Is(err, services.ErrInvalidWriterPreference) {
		return writerMemoryBadRequest(c, err.Error())
	}
	if errors.Is(err, services.ErrWriterPreferenceNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "writer preference not found"}})
	}
	return writerMemoryError(c, err)
}

func (h *WriterMemoryHandler) authorizeFeedback(c *fiber.Ctx, input *services.WriterFeedbackInput) error {
	if input.UniverseID != nil && h.ownerRepo != nil {
		universe, err := h.ownerRepo.FindByID(c.Context(), *input.UniverseID)
		if err != nil {
			return fiber.ErrNotFound
		}
		if universe.UserID != middleware.GetUserID(c) {
			return fiber.ErrForbidden
		}
	}
	if input.ChapterID != nil && h.chapterRepo != nil {
		chapter, err := h.chapterRepo.FindByID(c.Context(), *input.ChapterID)
		if err != nil {
			return fiber.ErrNotFound
		}
		if input.UniverseID != nil && *input.UniverseID != chapter.UniverseID {
			return errors.New("chapter does not belong to universe")
		}
		if input.UniverseID == nil {
			input.UniverseID = &chapter.UniverseID
		}
		if h.ownerRepo != nil {
			universe, ownerErr := h.ownerRepo.FindByID(c.Context(), chapter.UniverseID)
			if ownerErr != nil {
				return fiber.ErrNotFound
			}
			if universe.UserID != middleware.GetUserID(c) {
				return fiber.ErrForbidden
			}
		}
	}
	return nil
}

func optionalWriterUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}
