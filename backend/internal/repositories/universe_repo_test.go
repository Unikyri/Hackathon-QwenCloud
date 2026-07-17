package repositories

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/testutil"
)

func TestUniverseRepoFindByUserAndSessionIDScopesSharedSession(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	testutil.RunMigrationsUpTo(t, pool, "021")
	ctx := context.Background()
	repo := NewUniverseRepo(pool)
	sessionID := uuid.NewString()

	ownerA := createUniverseRepoTestUser(t, ctx, pool)
	ownerB := createUniverseRepoTestUser(t, ctx, pool)
	universeAID := createUniverseRepoTestUniverse(t, ctx, pool, ownerA, sessionID)
	universeBID := createUniverseRepoTestUniverse(t, ctx, pool, ownerB, sessionID)

	gotA, err := repo.FindByUserAndSessionID(ctx, ownerA, sessionID)
	if err != nil {
		t.Fatalf("find owner A session: %v", err)
	}
	if gotA == nil || gotA.ID != universeAID || gotA.UserID != ownerA {
		t.Fatalf("owner A lookup = %#v, want universe %s owned by %s", gotA, universeAID, ownerA)
	}

	gotB, err := repo.FindByUserAndSessionID(ctx, ownerB, sessionID)
	if err != nil {
		t.Fatalf("find owner B session: %v", err)
	}
	if gotB == nil || gotB.ID != universeBID || gotB.UserID != ownerB {
		t.Fatalf("owner B lookup = %#v, want universe %s owned by %s", gotB, universeBID, ownerB)
	}

	missing, err := repo.FindByUserAndSessionID(ctx, uuid.New(), sessionID)
	if err != nil {
		t.Fatalf("find missing owner session: %v", err)
	}
	if missing != nil {
		t.Fatalf("missing owner lookup = %#v, want nil", missing)
	}
}

func createUniverseRepoTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	userID := uuid.New()
	if _, err := pool.Exec(ctx,
		"INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)",
		userID, uuid.NewString()+"@test.local", "hash", "Test"); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	return userID
}

func createUniverseRepoTestUniverse(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, sessionID string) uuid.UUID {
	t.Helper()
	universeID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO universes (id, user_id, name, description, genre_tags, session_id, is_demo_template)
		VALUES ($1, $2, $3, $4, $5, $6, FALSE)
	`, universeID, userID, "Test Universe", "", []string{"fantasy"}, sessionID); err != nil {
		t.Fatalf("create test universe: %v", err)
	}
	return universeID
}
