package handlers

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/middleware"
	"github.com/quill/backend/internal/services"
)

type demoService interface {
	CloneUniverse(ctx context.Context, userID uuid.UUID, sessionID string) (string, error)
	ResetUniverse(ctx context.Context, userID uuid.UUID, sessionID string) (string, error)
}

type DemoHandler struct {
	demoSvc demoService
}

func NewDemoHandler(demoSvc demoService) *DemoHandler {
	return &DemoHandler{demoSvc: demoSvc}
}

func (h *DemoHandler) Clone(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return demoError(c, services.ErrDemoAuthenticationRequired)
	}

	sessionID := c.Get("X-Session-ID")
	if sessionID == "" {
		return demoError(c, services.ErrDemoSessionRequired)
	}
	parsedSessionID, err := uuid.Parse(sessionID)
	if err != nil || parsedSessionID == uuid.Nil {
		return demoError(c, services.ErrDemoSessionInvalid)
	}

	universeID, err := h.demoSvc.CloneUniverse(c.Context(), userID, sessionID)
	if err != nil {
		return demoError(c, err)
	}

	return c.JSON(fiber.Map{
		"status":      "success",
		"universe_id": universeID,
		"message":     "Demo universe cloned successfully",
	})
}

func (h *DemoHandler) Reset(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return demoError(c, services.ErrDemoAuthenticationRequired)
	}

	sessionID := c.Get("X-Session-ID")
	if sessionID == "" {
		return demoError(c, services.ErrDemoSessionRequired)
	}
	parsedSessionID, err := uuid.Parse(sessionID)
	if err != nil || parsedSessionID == uuid.Nil {
		return demoError(c, services.ErrDemoSessionInvalid)
	}

	universeID, err := h.demoSvc.ResetUniverse(c.Context(), userID, sessionID)
	if err != nil {
		return demoError(c, err)
	}

	return c.JSON(fiber.Map{
		"status":      "success",
		"universe_id": universeID,
		"message":     "Demo data reset successfully",
	})
}

func demoError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, services.ErrDemoAuthenticationRequired):
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": fiber.Map{"code": "UNAUTHORIZED", "message": "authentication required"},
		})
	case errors.Is(err, services.ErrDemoSessionRequired):
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "X-Session-ID header required"},
		})
	case errors.Is(err, services.ErrDemoSessionInvalid):
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{"code": "VALIDATION_ERROR", "message": "X-Session-ID must be an opaque UUID"},
		})
	case errors.Is(err, services.ErrDemoUniverseNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{"code": "NOT_FOUND", "message": "demo universe not found"},
		})
	default:
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{"code": "INTERNAL_ERROR", "message": "unable to process demo request"},
		})
	}
}
