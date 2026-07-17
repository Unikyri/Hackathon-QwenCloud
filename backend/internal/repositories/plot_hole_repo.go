package repositories

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
)

var ErrPlotHoleNotFound = errors.New("plot hole not found")

type PlotHoleRepo struct {
	pool *pgxpool.Pool
}

func NewPlotHoleRepo(pool *pgxpool.Pool) *PlotHoleRepo {
	return &PlotHoleRepo{pool: pool}
}

func (r *PlotHoleRepo) Create(ctx context.Context, ph *models.PlotHole) error {
	query := `
		INSERT INTO plot_holes (id, universe_id, title, description, related_entity_ids,
			first_mentioned_chapter_id, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
	`
	_, err := r.pool.Exec(ctx, query,
		ph.ID, ph.UniverseID, ph.Title, ph.Description, ph.RelatedEntityIDs,
		ph.FirstMentionedChapterID, ph.Status,
	)
	if err != nil {
		return fmt.Errorf("create plot hole: %w", err)
	}
	return nil
}

func (r *PlotHoleRepo) ListByUniverse(ctx context.Context, universeID uuid.UUID) ([]models.PlotHole, error) {
	query := `
		SELECT id, universe_id, title, description, related_entity_ids,
		       first_mentioned_chapter_id, status, created_at
		FROM plot_holes WHERE universe_id = $1
		ORDER BY created_at DESC
	`
	rows, err := r.pool.Query(ctx, query, universeID)
	if err != nil {
		return nil, fmt.Errorf("list plot holes: %w", err)
	}
	defer rows.Close()

	result := []models.PlotHole{}
	for rows.Next() {
		var ph models.PlotHole
		if err := rows.Scan(
			&ph.ID, &ph.UniverseID, &ph.Title, &ph.Description, &ph.RelatedEntityIDs,
			&ph.FirstMentionedChapterID, &ph.Status, &ph.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan plot hole: %w", err)
		}
		result = append(result, ph)
	}
	return result, nil
}

func (r *PlotHoleRepo) FindOpenByArc(ctx context.Context, universeID uuid.UUID, entityID uuid.UUID) ([]models.PlotHole, error) {
	query := `
		SELECT id, universe_id, title, description, related_entity_ids,
		       first_mentioned_chapter_id, status, created_at
		FROM plot_holes WHERE universe_id = $1 AND $2 = ANY(related_entity_ids) AND status = 'open'
		ORDER BY created_at DESC
	`
	rows, err := r.pool.Query(ctx, query, universeID, entityID)
	if err != nil {
		return nil, fmt.Errorf("find open plot holes by arc: %w", err)
	}
	defer rows.Close()

	result := []models.PlotHole{}
	for rows.Next() {
		var ph models.PlotHole
		if err := rows.Scan(
			&ph.ID, &ph.UniverseID, &ph.Title, &ph.Description, &ph.RelatedEntityIDs,
			&ph.FirstMentionedChapterID, &ph.Status, &ph.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan plot hole: %w", err)
		}
		result = append(result, ph)
	}
	return result, nil
}

// Resolve marks a plot hole as resolved only when it belongs to universeID.
func (r *PlotHoleRepo) Resolve(ctx context.Context, id, universeID uuid.UUID) error {
	return r.updateStatus(ctx, id, universeID, "resolved")
}

// Dismiss marks a plot hole as dismissed only when it belongs to universeID.
func (r *PlotHoleRepo) Dismiss(ctx context.Context, id, universeID uuid.UUID) error {
	return r.updateStatus(ctx, id, universeID, "dismissed")
}

func (r *PlotHoleRepo) updateStatus(ctx context.Context, id, universeID uuid.UUID, status string) error {
	result, err := r.pool.Exec(ctx,
		`UPDATE plot_holes SET status = $3 WHERE id = $1 AND universe_id = $2`,
		id, universeID, status,
	)
	if err != nil {
		return fmt.Errorf("update plot hole status: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrPlotHoleNotFound
	}
	return nil
}
