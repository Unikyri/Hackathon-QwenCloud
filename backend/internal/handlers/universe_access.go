package handlers

import (
	"context"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/middleware"
	"github.com/quill/backend/internal/models"
)

// universeOwnerResolver is the narrow ownership lookup needed by handlers
// that operate on universe-scoped resources.
type universeOwnerResolver interface {
	FindByID(ctx context.Context, id uuid.UUID) (*models.Universe, error)
}

// authorizeUniverse verifies that the authenticated user owns universeID.
// A nil resolver preserves focused handler construction in tests; production
// wiring always provides the universe repository.
func authorizeUniverse(c *fiber.Ctx, ownerRepo universeOwnerResolver, universeID uuid.UUID) error {
	if ownerRepo == nil {
		return nil
	}
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return fiber.ErrUnauthorized
	}
	universe, err := ownerRepo.FindByID(c.Context(), universeID)
	if err != nil || universe == nil {
		return fiber.ErrNotFound
	}
	if universe.UserID != userID {
		return fiber.ErrForbidden
	}
	return nil
}

func universeAccessError(c *fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	code := "INTERNAL_ERROR"
	message := err.Error()
	switch err {
	case fiber.ErrUnauthorized:
		status, code, message = fiber.StatusUnauthorized, "UNAUTHORIZED", "authentication required"
	case fiber.ErrForbidden:
		status, code, message = fiber.StatusForbidden, "FORBIDDEN", "universe access denied"
	case fiber.ErrNotFound:
		status, code, message = fiber.StatusNotFound, "NOT_FOUND", "universe not found"
	}
	return c.Status(status).JSON(fiber.Map{"error": fiber.Map{"code": code, "message": message}})
}
