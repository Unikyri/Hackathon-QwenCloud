package repositories

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/testutil"
)

func setupContradictionFixtures(t *testing.T, pool *pgxpool.Pool) (models.Universe, models.Work, models.Chapter, models.Entity) {
	t.Helper()
	ctx := context.Background()
	user := createTestUser(t, ctx, pool)

	universe := models.Universe{ID: uuid.New(), UserID: user.ID, Name: "Test Universe", GenreTags: []string{"fantasy"}}
	work := models.Work{ID: uuid.New(), UniverseID: universe.ID, Title: "Test Work", Type: "novel", OrderIndex: 1, Status: "in_progress"}
	chapter := models.Chapter{ID: uuid.New(), WorkID: work.ID, Title: "Ch1", OrderIndex: 1, Content: "content", RawText: "text", WordCount: 10, Status: "draft"}
	entity := models.Entity{ID: uuid.New(), UniverseID: universe.ID, Type: "character", Name: "Test Entity", Status: "active", RelevanceScore: 0.8}

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
	return universe, work, chapter, entity
}

func TestContradictionRepoCreate(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, _, chapter, entity := setupContradictionFixtures(t, pool)

	ctx := context.Background()
	repo := NewContradictionRepo(pool)

	c := &models.Contradiction{
		ID:                 uuid.New(),
		UniverseID:         universe.ID,
		EntityID:           &entity.ID,
		Severity:           "critical",
		Description:        "Entity is both alive and dead",
		EvidenceA:          "was alive",
		EvidenceAChapterID: &chapter.ID,
		EvidenceB:          "was dead",
		EvidenceBChapterID: &chapter.ID,
		Fingerprint:        "test-fingerprint-001",
		Status:             "open",
	}
	if err := repo.Create(ctx, c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Verify fingerprint lookup
	found, err := repo.FindByFingerprint(ctx, "test-fingerprint-001")
	if err != nil {
		t.Fatalf("FindByFingerprint: %v", err)
	}
	if found == nil {
		t.Fatal("expected contradiction to be found by fingerprint")
	}
	if found.Description != c.Description {
		t.Errorf("Description = %q, want %q", found.Description, c.Description)
	}
}

func TestContradictionRepoFindByFingerprintNotExist(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	_, _, _, _ = setupContradictionFixtures(t, pool) // ensure tables exist

	ctx := context.Background()
	repo := NewContradictionRepo(pool)

	found, err := repo.FindByFingerprint(ctx, "nonexistent-fingerprint")
	if err != nil {
		t.Fatalf("FindByFingerprint: %v", err)
	}
	if found != nil {
		t.Error("expected nil for nonexistent fingerprint")
	}
}

func TestContradictionRepoListByUniverse(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, _, chapter, entity := setupContradictionFixtures(t, pool)

	ctx := context.Background()
	repo := NewContradictionRepo(pool)

	c1 := &models.Contradiction{
		ID:                 uuid.New(),
		UniverseID:         universe.ID,
		EntityID:           &entity.ID,
		Severity:           "critical",
		Description:        "First contradiction",
		EvidenceA:          "A1",
		EvidenceAChapterID: &chapter.ID,
		EvidenceB:          "B1",
		EvidenceBChapterID: &chapter.ID,
		Fingerprint:        "fp-list-1",
		Status:             "open",
	}
	if err := repo.Create(ctx, c1); err != nil {
		t.Fatalf("Create c1: %v", err)
	}

	c2 := &models.Contradiction{
		ID:          uuid.New(),
		UniverseID:  universe.ID,
		Severity:    "major",
		Description: "Second contradiction",
		Fingerprint: "fp-list-2",
		Status:      "open",
	}
	if err := repo.Create(ctx, c2); err != nil {
		t.Fatalf("Create c2: %v", err)
	}

	list, err := repo.ListByUniverse(ctx, universe.ID)
	if err != nil {
		t.Fatalf("ListByUniverse: %v", err)
	}
	if len(list) < 2 {
		t.Errorf("ListByUniverse len = %d, want >= 2", len(list))
	}
}

func TestContradictionRepoResolve(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "012")
	universe, _, chapter, entity := setupContradictionFixtures(t, pool)

	ctx := context.Background()
	repo := NewContradictionRepo(pool)

	c := &models.Contradiction{
		ID:                 uuid.New(),
		UniverseID:         universe.ID,
		EntityID:           &entity.ID,
		Severity:           "minor",
		Description:        "To resolve",
		EvidenceA:          "A",
		EvidenceAChapterID: &chapter.ID,
		EvidenceB:          "B",
		EvidenceBChapterID: &chapter.ID,
		Fingerprint:        "fp-resolve",
		Status:             "open",
	}
	if err := repo.Create(ctx, c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	now := time.Now()
	if err := repo.Resolve(ctx, c.ID, universe.ID, &now); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if err := repo.Dismiss(ctx, c.ID, uuid.New()); !errors.Is(err, ErrContradictionNotFound) {
		t.Fatalf("Dismiss with foreign universe error = %v, want ErrContradictionNotFound", err)
	}

	// Re-fetch to verify
	found, err := repo.FindByFingerprint(ctx, "fp-resolve")
	if err != nil {
		t.Fatalf("FindByFingerprint after resolve: %v", err)
	}
	if found == nil {
		t.Fatal("expected contradiction after resolve")
	}
	if found.Status != "resolved" {
		t.Errorf("Status = %q, want resolved", found.Status)
	}
	if found.ResolvedAt == nil {
		t.Error("expected ResolvedAt to be set")
	}
}
