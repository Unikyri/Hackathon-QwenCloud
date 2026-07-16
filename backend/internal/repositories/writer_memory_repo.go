package repositories

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"

	"github.com/quill/backend/internal/models"
)

// WriterMemoryRepo is the persistence boundary for Writer Memory. It owns no
// promotion or decay decisions; those remain in WriterMemoryService so the
// stylometry wall and intent-signal rules are visible in one place.
type WriterMemoryRepo struct {
	pool *pgxpool.Pool
}

func NewWriterMemoryRepo(pool *pgxpool.Pool) *WriterMemoryRepo {
	return &WriterMemoryRepo{pool: pool}
}

func (r *WriterMemoryRepo) CreateObservation(ctx context.Context, observation *models.WriterObservation) error {
	if observation.ID == uuid.Nil {
		observation.ID = uuid.New()
	}
	if observation.ComputedAt.IsZero() {
		observation.ComputedAt = time.Now().UTC()
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO writer_observations
			(id, user_id, universe_id, metric, value, sample_size, computed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, observation.ID, observation.UserID, observation.UniverseID, observation.Metric,
		observation.Value, observation.SampleSize, observation.ComputedAt)
	if err != nil {
		return fmt.Errorf("create writer observation: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) ListObservations(ctx context.Context, userID uuid.UUID, universeID *uuid.UUID, limit int) ([]models.WriterObservation, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	query := `
		SELECT id, user_id, universe_id, metric, value, sample_size, computed_at
		FROM writer_observations
		WHERE user_id = $1 AND ($2::uuid IS NULL OR universe_id = $2)
		ORDER BY computed_at DESC, id DESC
		LIMIT $3
	`
	rows, err := r.pool.Query(ctx, query, userID, universeID, limit)
	if err != nil {
		return nil, fmt.Errorf("list writer observations: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterObservation, 0)
	for rows.Next() {
		var item models.WriterObservation
		if err := rows.Scan(&item.ID, &item.UserID, &item.UniverseID, &item.Metric, &item.Value, &item.SampleSize, &item.ComputedAt); err != nil {
			return nil, fmt.Errorf("scan writer observation: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *WriterMemoryRepo) ListObservationsByIDs(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) ([]models.WriterObservation, error) {
	if len(ids) == 0 {
		return []models.WriterObservation{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, universe_id, metric, value, sample_size, computed_at
		FROM writer_observations
		WHERE user_id = $1 AND id = ANY($2)
		ORDER BY computed_at ASC, id ASC
	`, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("list writer observations by ids: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterObservation, 0, len(ids))
	for rows.Next() {
		var item models.WriterObservation
		if err := rows.Scan(&item.ID, &item.UserID, &item.UniverseID, &item.Metric, &item.Value, &item.SampleSize, &item.ComputedAt); err != nil {
			return nil, fmt.Errorf("scan writer observation by ids: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *WriterMemoryRepo) CreatePreference(ctx context.Context, preference *models.WriterPreference) error {
	if preference.ID == uuid.Nil {
		preference.ID = uuid.New()
	}
	if preference.LastReinforcedAt.IsZero() {
		preference.LastReinforcedAt = time.Now().UTC()
	}
	if preference.CreatedAt.IsZero() {
		preference.CreatedAt = time.Now().UTC()
	}
	if preference.GenreTags == nil {
		preference.GenreTags = []string{}
	}
	if preference.ObservationIDs == nil {
		preference.ObservationIDs = []uuid.UUID{}
	}
	if preference.FeedbackEventIDs == nil {
		preference.FeedbackEventIDs = []uuid.UUID{}
	}
	var embedding interface{}
	if len(preference.Embedding) > 0 {
		embedding = pgvector.NewVector(preference.Embedding)
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO writer_preferences
			(id, user_id, statement, scope, genre_tags, confidence, relevance_score,
			 lifecycle, embedding, last_reinforced_at, observation_ids,
			 feedback_event_ids, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, preference.ID, preference.UserID, preference.Statement, preference.Scope,
		preference.GenreTags, preference.Confidence, preference.RelevanceScore,
		preference.Lifecycle, embedding, preference.LastReinforcedAt,
		preference.ObservationIDs, preference.FeedbackEventIDs, preference.CreatedAt)
	if err != nil {
		return fmt.Errorf("create writer preference: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) FindPreference(ctx context.Context, userID, preferenceID uuid.UUID) (*models.WriterPreference, error) {
	row := r.pool.QueryRow(ctx, writerPreferenceSelect+` WHERE p.user_id = $1 AND p.id = $2`, userID, preferenceID)
	item, err := scanWriterPreference(row)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("writer preference not found")
	}
	if err != nil {
		return nil, fmt.Errorf("find writer preference: %w", err)
	}
	return item, nil
}

func (r *WriterMemoryRepo) ListPreferences(ctx context.Context, userID uuid.UUID, activeOnly bool, limit int) ([]models.WriterPreference, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	where := "p.user_id = $1"
	if activeOnly {
		where += " AND p.lifecycle = 'active'"
	}
	rows, err := r.pool.Query(ctx, writerPreferenceSelect+" WHERE "+where+" ORDER BY p.relevance_score * p.confidence DESC, p.created_at DESC LIMIT $2", userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list writer preferences: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterPreference, 0)
	for rows.Next() {
		item, err := scanWriterPreference(rows)
		if err != nil {
			return nil, fmt.Errorf("scan writer preference: %w", err)
		}
		result = append(result, *item)
	}
	return result, rows.Err()
}

// ListActiveForUniverse is deliberately user-scoped through the universe
// owner, allowing Writer Memory to travel across universes while keeping
// genre-bound preferences isolated to intersecting tags.
func (r *WriterMemoryRepo) ListActiveForUniverse(ctx context.Context, universeID uuid.UUID, limit int) ([]models.WriterPreference, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	query := writerPreferenceSelect + `
		JOIN universes u ON u.id = $1 AND u.user_id = p.user_id
		WHERE p.lifecycle = 'active'
		  AND (p.scope = 'universal' OR p.genre_tags && COALESCE(u.genre_tags, '{}'))
		ORDER BY p.relevance_score * p.confidence DESC, p.created_at DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, query, universeID, limit)
	if err != nil {
		return nil, fmt.Errorf("list active writer preferences for universe: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterPreference, 0)
	for rows.Next() {
		item, err := scanWriterPreference(rows)
		if err != nil {
			return nil, fmt.Errorf("scan active writer preference: %w", err)
		}
		result = append(result, *item)
	}
	return result, rows.Err()
}

// ListActiveForUniverseOwner returns the complete active profile owned by the
// universe, without genre filtering. Decay is a writer-level event: a chapter
// advance in one universe must age preferences learned in another universe as
// well. Genre filtering belongs only to recall/suppression consumers.
func (r *WriterMemoryRepo) ListActiveForUniverseOwner(ctx context.Context, universeID uuid.UUID, limit int) ([]models.WriterPreference, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := r.pool.Query(ctx, writerPreferenceSelect+`
		JOIN universes u ON u.id = $1 AND u.user_id = p.user_id
		WHERE p.lifecycle = 'active'
		ORDER BY p.relevance_score * p.confidence DESC, p.created_at DESC
		LIMIT $2
	`, universeID, limit)
	if err != nil {
		return nil, fmt.Errorf("list active writer preference owner profile: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterPreference, 0)
	for rows.Next() {
		item, err := scanWriterPreference(rows)
		if err != nil {
			return nil, fmt.Errorf("scan active writer preference owner profile: %w", err)
		}
		result = append(result, *item)
	}
	return result, rows.Err()
}

func (r *WriterMemoryRepo) UpdatePreference(ctx context.Context, preference *models.WriterPreference) error {
	var embedding interface{}
	if len(preference.Embedding) > 0 {
		embedding = pgvector.NewVector(preference.Embedding)
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE writer_preferences
		SET statement = $1, scope = $2, genre_tags = $3, confidence = $4,
		    relevance_score = $5, lifecycle = $6, embedding = $7,
		    last_reinforced_at = $8, observation_ids = $9, feedback_event_ids = $10
		WHERE id = $11 AND user_id = $12
	`, preference.Statement, preference.Scope, preference.GenreTags, preference.Confidence,
		preference.RelevanceScore, preference.Lifecycle, embedding, preference.LastReinforcedAt,
		preference.ObservationIDs, preference.FeedbackEventIDs, preference.ID, preference.UserID)
	if err != nil {
		return fmt.Errorf("update writer preference: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) DeactivatePreference(ctx context.Context, userID, preferenceID uuid.UUID) error {
	result, err := r.pool.Exec(ctx, `
		UPDATE writer_preferences SET lifecycle = 'archived', relevance_score = 0
		WHERE id = $1 AND user_id = $2
	`, preferenceID, userID)
	if err != nil {
		return fmt.Errorf("deactivate writer preference: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("writer preference not found")
	}
	return nil
}

func (r *WriterMemoryRepo) CreateFeedbackEvent(ctx context.Context, event *models.WriterFeedbackEvent) error {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	if len(event.Payload) == 0 {
		event.Payload = json.RawMessage(`{}`)
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO writer_feedback_events
			(id, user_id, universe_id, chapter_id, note_id, signal, preference_id, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
	`, event.ID, event.UserID, event.UniverseID, event.ChapterID, event.NoteID,
		event.Signal, event.PreferenceID, event.Payload, event.CreatedAt)
	if err != nil {
		return fmt.Errorf("create writer feedback event: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) AttachFeedbackPreference(ctx context.Context, userID, eventID, preferenceID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE writer_feedback_events SET preference_id = $1
		WHERE id = $2 AND user_id = $3
	`, preferenceID, eventID, userID)
	if err != nil {
		return fmt.Errorf("attach writer feedback preference: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) ListFeedbackEvents(ctx context.Context, userID uuid.UUID, preferenceID *uuid.UUID, limit int) ([]models.WriterFeedbackEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	query := `
		SELECT id, user_id, universe_id, chapter_id, note_id, signal,
		       preference_id, payload, created_at
		FROM writer_feedback_events
		WHERE user_id = $1 AND ($2::uuid IS NULL OR preference_id = $2)
		ORDER BY created_at ASC, id ASC
		LIMIT $3
	`
	rows, err := r.pool.Query(ctx, query, userID, preferenceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list writer feedback events: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterFeedbackEvent, 0)
	for rows.Next() {
		var item models.WriterFeedbackEvent
		if err := rows.Scan(&item.ID, &item.UserID, &item.UniverseID, &item.ChapterID, &item.NoteID, &item.Signal, &item.PreferenceID, &item.Payload, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan writer feedback event: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *WriterMemoryRepo) AppendPreferenceHistory(ctx context.Context, snapshot *models.WriterPreferenceHistory) error {
	if snapshot.ID == uuid.Nil {
		snapshot.ID = uuid.New()
	}
	if snapshot.RecordedAt.IsZero() {
		snapshot.RecordedAt = time.Now().UTC()
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO writer_preference_history
			(id, user_id, preference_id, relevance_score, confidence, lifecycle, recorded_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, snapshot.ID, snapshot.UserID, snapshot.PreferenceID, snapshot.RelevanceScore,
		snapshot.Confidence, snapshot.Lifecycle, snapshot.RecordedAt)
	if err != nil {
		return fmt.Errorf("append writer preference history: %w", err)
	}
	return nil
}

func (r *WriterMemoryRepo) ListPreferenceHistory(ctx context.Context, userID, preferenceID uuid.UUID, limit int) ([]models.WriterPreferenceHistory, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, preference_id, relevance_score, confidence, lifecycle, recorded_at
		FROM writer_preference_history
		WHERE user_id = $1 AND preference_id = $2
		ORDER BY recorded_at ASC, id ASC
		LIMIT $3
	`, userID, preferenceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list writer preference history: %w", err)
	}
	defer rows.Close()
	result := make([]models.WriterPreferenceHistory, 0)
	for rows.Next() {
		var item models.WriterPreferenceHistory
		if err := rows.Scan(&item.ID, &item.UserID, &item.PreferenceID, &item.RelevanceScore, &item.Confidence, &item.Lifecycle, &item.RecordedAt); err != nil {
			return nil, fmt.Errorf("scan writer preference history: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// DecayForUser applies the same exponential score update used by
// RelevanceService to active preferences and returns the post-update rows for
// history snapshots. The formula itself lives in services.applyDecay; callers
// provide the already-computed score so the repository remains policy-free.
func (r *WriterMemoryRepo) UpdateDecay(ctx context.Context, userID uuid.UUID, relevanceScore, archiveThreshold float64, lambda float64) ([]models.WriterPreference, error) {
	rows, err := r.pool.Query(ctx, writerPreferenceSelect+` WHERE p.user_id = $1 AND p.lifecycle = 'active' ORDER BY p.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list preferences for decay: %w", err)
	}
	preferences := make([]models.WriterPreference, 0)
	for rows.Next() {
		item, scanErr := scanWriterPreference(rows)
		if scanErr != nil {
			rows.Close()
			return nil, fmt.Errorf("scan preference for decay: %w", scanErr)
		}
		preferences = append(preferences, *item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read preferences for decay: %w", err)
	}
	for i := range preferences {
		if lambda != 0 {
			preferences[i].RelevanceScore *= relevanceScore
		}
		if preferences[i].RelevanceScore <= archiveThreshold {
			preferences[i].Lifecycle = "archived"
		}
		if err := r.UpdatePreference(ctx, &preferences[i]); err != nil {
			return nil, err
		}
	}
	return preferences, nil
}

const writerPreferenceSelect = `
	SELECT p.id, p.user_id, p.statement, p.scope, p.genre_tags, p.confidence,
	       p.relevance_score, p.lifecycle, COALESCE(p.embedding::text, ''), p.last_reinforced_at,
	       p.observation_ids, p.feedback_event_ids, p.created_at
	FROM writer_preferences p
`

type writerPreferenceScanner interface {
	Scan(dest ...any) error
}

func scanWriterPreference(row writerPreferenceScanner) (*models.WriterPreference, error) {
	item := &models.WriterPreference{}
	// The embedding column is nullable for preferences promoted before an
	// embedding provider was configured. Scan into a pointer so a genuine SQL
	// NULL is accepted instead of failing conversion into a string.
	var embeddingText *string
	if err := row.Scan(
		&item.ID, &item.UserID, &item.Statement, &item.Scope, &item.GenreTags,
		&item.Confidence, &item.RelevanceScore, &item.Lifecycle, &embeddingText,
		&item.LastReinforcedAt, &item.ObservationIDs, &item.FeedbackEventIDs,
		&item.CreatedAt,
	); err != nil {
		return nil, err
	}
	var embedding pgvector.Vector
	if embeddingText != nil && strings.TrimSpace(*embeddingText) != "" {
		if err := embedding.Parse(*embeddingText); err != nil {
			return nil, fmt.Errorf("parse writer preference embedding: %w", err)
		}
		item.Embedding = embedding.Slice()
	}
	return item, nil
}
