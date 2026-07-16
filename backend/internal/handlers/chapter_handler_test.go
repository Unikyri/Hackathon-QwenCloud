package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
)

type chapterHandlerUniverseResolver struct {
	universe *models.Universe
}

func (r chapterHandlerUniverseResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Universe, error) {
	return r.universe, nil
}

type chapterHandlerWorkResolver struct {
	work *models.Work
}

func (r chapterHandlerWorkResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Work, error) {
	return r.work, nil
}

type chapterHandlerChapterResolver struct {
	chapter *models.Chapter
}

func (r chapterHandlerChapterResolver) FindByID(_ context.Context, _ uuid.UUID) (*models.Chapter, error) {
	return r.chapter, nil
}

func TestChapterHandlerRejectsForeignResources(t *testing.T) {
	callerID := uuid.New()
	foreignOwnerID := uuid.New()
	universeID := uuid.New()
	workID := uuid.New()
	chapterID := uuid.New()

	h := &ChapterHandler{
		ownerRepo:   chapterHandlerUniverseResolver{universe: &models.Universe{ID: universeID, UserID: foreignOwnerID}},
		workRepo:    chapterHandlerWorkResolver{work: &models.Work{ID: workID, UniverseID: universeID}},
		chapterRepo: chapterHandlerChapterResolver{chapter: &models.Chapter{ID: chapterID, WorkID: workID, UniverseID: universeID}},
		chapterSvc:  nil,
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", callerID)
		return c.Next()
	})
	app.Post("/works/:work_id/chapters", h.Create)
	app.Get("/works/:work_id/chapters", h.ListByWork)
	app.Get("/chapters/:id", h.GetByID)
	app.Put("/chapters/:id", h.Update)
	app.Delete("/chapters/:id", h.Delete)

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/works/" + workID.String() + "/chapters", `{"title":"owned?"}`},
		{http.MethodGet, "/works/" + workID.String() + "/chapters", ""},
		{http.MethodGet, "/chapters/" + chapterID.String(), ""},
		{http.MethodPut, "/chapters/" + chapterID.String(), `{"content":"private"}`},
		{http.MethodDelete, "/chapters/" + chapterID.String(), ""},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test %s %s: %v", tc.method, tc.path, err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s status = %d, want 403", tc.method, tc.path, resp.StatusCode)
		}
	}
}
