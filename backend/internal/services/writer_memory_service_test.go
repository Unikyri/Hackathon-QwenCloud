package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/testutil"
)

func TestWriterPreferenceScopeValidationRejectsUnknownGenre(t *testing.T) {
	if err := validatePreferenceScope("genre_bound", []string{"not-a-genre"}); err == nil {
		t.Fatal("unknown genre tags must not be promoted or persisted")
	}
	if err := validatePreferenceScope("universal", []string{"fantasy"}); err == nil {
		t.Fatal("universal preferences must not carry genre tags")
	}
	if !validBehaviouralPayload(map[string]interface{}{
		"before":      "A long sentence.",
		"after":       "A shorter sentence.",
		"observed_at": time.Now().UTC().Format(time.RFC3339),
	}, time.Now().UTC()) {
		t.Fatal("a changed paragraph observed inside the bounded window should be valid")
	}
}

func TestWriterMemoryPromotionAndThreeRejectSuppression(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "024")
	ctx := context.Background()

	userID := uuid.New()
	universeID := uuid.New()
	insertWriterMemoryOwner(t, pool, userID, universeID, []string{"fantasy"})
	repo := repositories.NewWriterMemoryRepo(pool)
	service := NewWriterMemoryService(repo, nil, 3, 0.1, 0.15)

	observation := &models.WriterObservation{
		UserID: userID, UniverseID: &universeID, Metric: MetricAdverbDensity,
		Value: 4.2, SampleSize: 1000,
	}
	if err := repo.CreateObservation(ctx, observation); err != nil {
		t.Fatalf("create observation: %v", err)
	}

	for i := 0; i < 3; i++ {
		preference, err := service.RecordFeedback(ctx, WriterFeedbackInput{
			UserID: userID, UniverseID: &universeID, Signal: "reject",
			Payload: map[string]interface{}{
				"observation_id": observation.ID.String(),
				"category":       "adverbs",
			},
		})
		if err != nil {
			t.Fatalf("record rejection %d: %v", i+1, err)
		}
		if i < 2 && preference != nil {
			t.Fatalf("preference promoted after only %d signals", i+1)
		}
		if i == 2 && preference == nil {
			t.Fatal("expected preference after three consistent intent signals")
		}
	}

	suppressed, err := service.ShouldSuppress(ctx, userID, universeID, "adverbs")
	if err != nil {
		t.Fatalf("check suppression: %v", err)
	}
	if !suppressed {
		t.Fatal("three explicit rejections must suppress the matching craft category")
	}

	if _, err := service.RecordFeedback(ctx, WriterFeedbackInput{
		UserID: userID, UniverseID: &universeID, Signal: "silent",
	}); err == nil {
		t.Fatal("silent dismissal must not be persisted as rejection")
	}

	preferences, err := service.ListPreferences(ctx, userID, true)
	if err != nil {
		t.Fatalf("list preferences with nil embedding: %v", err)
	}
	if len(preferences) != 1 {
		t.Fatalf("active preferences = %d, want 1", len(preferences))
	}
	evidence, err := service.Evidence(ctx, userID, preferences[0].ID)
	if err != nil {
		t.Fatalf("load evidence: %v", err)
	}
	if len(evidence.Observations) != 1 || len(evidence.Events) != 3 || len(evidence.History) == 0 {
		t.Fatalf("incomplete evidence trail: observations=%d events=%d history=%d", len(evidence.Observations), len(evidence.Events), len(evidence.History))
	}

	if err := service.Deactivate(ctx, userID, preferences[0].ID); err != nil {
		t.Fatalf("deactivate preference: %v", err)
	}
	suppressed, err = service.ShouldSuppress(ctx, userID, universeID, "adverbs")
	if err != nil {
		t.Fatalf("check suppression after deactivation: %v", err)
	}
	if suppressed {
		t.Fatal("deactivated preference must no longer suppress craft notes")
	}
}

func TestWriterMemoryGenreConditioning(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "024")
	ctx := context.Background()

	userID := uuid.New()
	fantasyUniverseID := uuid.New()
	horrorUniverseID := uuid.New()
	insertWriterMemoryOwner(t, pool, userID, fantasyUniverseID, []string{"fantasy"})
	insertWriterMemoryUniverse(t, pool, userID, horrorUniverseID, []string{"horror"})
	repo := repositories.NewWriterMemoryRepo(pool)

	preferences := []models.WriterPreference{
		{UserID: userID, Statement: "Uses concrete description.", Scope: "universal", GenreTags: []string{}, Confidence: 0.8, RelevanceScore: 1, Lifecycle: "active"},
		{UserID: userID, Statement: "Fantasy violence is acceptable.", Scope: "genre_bound", GenreTags: []string{"fantasy"}, Confidence: 0.9, RelevanceScore: 1, Lifecycle: "active"},
		{UserID: userID, Statement: "Horror dread is acceptable.", Scope: "genre_bound", GenreTags: []string{"horror"}, Confidence: 0.9, RelevanceScore: 1, Lifecycle: "active"},
	}
	for i := range preferences {
		if err := repo.CreatePreference(ctx, &preferences[i]); err != nil {
			t.Fatalf("create preference %d: %v", i, err)
		}
	}

	fantasy, err := repo.ListActiveForUniverse(ctx, fantasyUniverseID, 20)
	if err != nil {
		t.Fatalf("list fantasy preferences: %v", err)
	}
	if len(fantasy) != 2 || !containsPreferenceStatement(fantasy, "Fantasy violence is acceptable.") || containsPreferenceStatement(fantasy, "Horror dread is acceptable.") {
		t.Fatalf("fantasy conditioning returned unexpected preferences: %#v", fantasy)
	}

	horror, err := repo.ListActiveForUniverse(ctx, horrorUniverseID, 20)
	if err != nil {
		t.Fatalf("list horror preferences: %v", err)
	}
	if len(horror) != 2 || !containsPreferenceStatement(horror, "Horror dread is acceptable.") || containsPreferenceStatement(horror, "Fantasy violence is acceptable.") {
		t.Fatalf("horror conditioning returned unexpected preferences: %#v", horror)
	}
}

func insertWriterMemoryOwner(t *testing.T, pool *pgxpool.Pool, userID, universeID uuid.UUID, genreTags []string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, display_name)
		VALUES ($1, $2, $3, $4)
	`, userID, userID.String()+"@writer-memory.test", "hash", "Writer Memory"); err != nil {
		t.Fatalf("insert writer-memory user: %v", err)
	}
	insertWriterMemoryUniverse(t, pool, userID, universeID, genreTags)
}

func insertWriterMemoryUniverse(t *testing.T, pool *pgxpool.Pool, userID, universeID uuid.UUID, genreTags []string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO universes (id, user_id, name, description, genre_tags, is_demo_template)
		VALUES ($1, $2, $3, $4, $5, FALSE)
	`, universeID, userID, "Writer Memory Universe", "", genreTags); err != nil {
		t.Fatalf("insert writer-memory universe: %v", err)
	}
}

func containsPreferenceStatement(preferences []models.WriterPreference, statement string) bool {
	for _, preference := range preferences {
		if preference.Statement == statement {
			return true
		}
	}
	return false
}
