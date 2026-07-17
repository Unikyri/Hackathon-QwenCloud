package repositories

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/testutil"
)

func setupPlotHoleFixtures(t *testing.T, pool *pgxpool.Pool) (models.Universe, models.Chapter, models.Entity) {
	t.Helper()
	ctx := context.Background()
	user := createTestUser(t, ctx, pool)

	universe := models.Universe{ID: uuid.New(), UserID: user.ID, Name: "PH Universe", GenreTags: []string{"fantasy"}}
	work := models.Work{ID: uuid.New(), UniverseID: universe.ID, Title: "PH Work", Type: "novel", OrderIndex: 1, Status: "in_progress"}
	chapter := models.Chapter{ID: uuid.New(), WorkID: work.ID, Title: "Ch1", OrderIndex: 1, Content: "content", RawText: "text", WordCount: 10, Status: "draft"}
	entity := models.Entity{ID: uuid.New(), UniverseID: universe.ID, Type: "character", Name: "PH Entity", Status: "active", RelevanceScore: 0.8}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "INSERT INTO universes (id, user_id, name, format) VALUES ($1,$2,$3,$4)",
		universe.ID, universe.UserID, universe.Name, "novel"); err != nil {
		t.Fatalf("insert universe: %v", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO works (id, universe_id, title, type, order_index, status) VALUES ($1,$2,$3,$4,$5,$6)",
		work.ID, work.UniverseID, work.Title, work.Type, work.OrderIndex, work.Status); err != nil {
		t.Fatalf("insert work: %v", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO chapters (id, work_id, title, order_index, content, raw_text, word_count, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
		chapter.ID, chapter.WorkID, chapter.Title, chapter.OrderIndex, chapter.Content, chapter.RawText, chapter.WordCount, chapter.Status); err != nil {
		t.Fatalf("insert chapter: %v", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO entities (id, universe_id, type, name, description, status, relevance_score) VALUES ($1,$2,$3,$4,$5,$6,$7)",
		entity.ID, entity.UniverseID, entity.Type, entity.Name, "", entity.Status, entity.RelevanceScore); err != nil {
		t.Fatalf("insert entity: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return universe, chapter, entity
}

func TestPlotHoleRepoCreate(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, chapter, entity := setupPlotHoleFixtures(t, pool)

	ctx := context.Background()
	repo := NewPlotHoleRepo(pool)

	ph := &models.PlotHole{
		ID:                      uuid.New(),
		UniverseID:              universe.ID,
		Title:                   "Forgotten Arc",
		Description:             "Character X hasn't been mentioned in 10 chapters",
		RelatedEntityIDs:        []uuid.UUID{entity.ID},
		FirstMentionedChapterID: &chapter.ID,
		Status:                  "open",
	}
	if err := repo.Create(ctx, ph); err != nil {
		t.Fatalf("Create: %v", err)
	}

	list, err := repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("expected at least one plot hole in list")
	}
	found := false
	for _, p := range list {
		if p.Title == "Forgotten Arc" {
			found = true
			break
		}
	}
	if !found {
		t.Error("created plot hole not found in list")
	}
}

func TestPlotHoleRepoFindOpenByArc(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, chapter, entity := setupPlotHoleFixtures(t, pool)

	ctx := context.Background()
	repo := NewPlotHoleRepo(pool)

	ph := &models.PlotHole{
		ID:                      uuid.New(),
		UniverseID:              universe.ID,
		Title:                   "Open Arc",
		Description:             "Still open",
		RelatedEntityIDs:        []uuid.UUID{entity.ID},
		FirstMentionedChapterID: &chapter.ID,
		Status:                  "open",
	}
	if err := repo.Create(ctx, ph); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Find open by entity arc — should find the open one
	openList, err := repo.FindOpenByArc(ctx, universe.ID, entity.ID)
	if err != nil {
		t.Fatalf("FindOpenByArc: %v", err)
	}
	if len(openList) == 0 {
		t.Error("expected open plot hole for entity arc")
	}
}

func TestPlotHoleRepoListByUniverse(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, chapter, entity := setupPlotHoleFixtures(t, pool)

	ctx := context.Background()
	repo := NewPlotHoleRepo(pool)

	for i := 0; i < 3; i++ {
		ph := &models.PlotHole{
			ID:                      uuid.New(),
			UniverseID:              universe.ID,
			Title:                   "Plot Hole " + string(rune('A'+i)),
			RelatedEntityIDs:        []uuid.UUID{entity.ID},
			FirstMentionedChapterID: &chapter.ID,
			Status:                  "open",
		}
		if err := repo.Create(ctx, ph); err != nil {
			t.Fatalf("Create %d: %v", i, err)
		}
	}

	list, err := repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("ListByUniverse len = %d, want 3", len(list))
	}
}

func TestPlotHoleRepoResolveAndDismissAreScoped(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, chapter, entity := setupPlotHoleFixtures(t, pool)

	ctx := context.Background()
	repo := NewPlotHoleRepo(pool)
	hole := &models.PlotHole{
		ID:                      uuid.New(),
		UniverseID:              universe.ID,
		Title:                   "Scoped plot hole",
		RelatedEntityIDs:        []uuid.UUID{entity.ID},
		FirstMentionedChapterID: &chapter.ID,
		Status:                  "open",
	}
	if err := repo.Create(ctx, hole); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := repo.Resolve(ctx, hole.ID, uuid.New()); !errors.Is(err, ErrPlotHoleNotFound) {
		t.Fatalf("Resolve with foreign universe error = %v, want ErrPlotHoleNotFound", err)
	}
	list, err := repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse after foreign resolve: %v", err)
	}
	if len(list) != 1 || list[0].Status != "open" {
		t.Fatalf("foreign resolve mutated plot hole: %#v", list)
	}

	if err := repo.Resolve(ctx, hole.ID, universe.ID); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	list, err = repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse after resolve: %v", err)
	}
	if len(list) != 1 || list[0].Status != "resolved" {
		t.Fatalf("resolved plot hole = %#v, want resolved", list)
	}

	if err := repo.Dismiss(ctx, hole.ID, universe.ID); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}
	list, err = repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse after dismiss: %v", err)
	}
	if len(list) != 1 || list[0].Status != "dismissed" {
		t.Fatalf("dismissed plot hole = %#v, want dismissed", list)
	}
}
