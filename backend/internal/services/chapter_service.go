package services

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
)

type ChapterService struct {
	pool         *pgxpool.Pool
	chapterRepo  *repositories.ChapterRepo
	workRepo     *repositories.WorkRepo
	relevSvc     *RelevanceService
	universeRepo *repositories.UniverseRepo
	stylometry   WriterObservationSink
	writerDecay  WriterMemoryDecayer
}

// WriterMemoryDecayer is the narrow chapter-advance hook for writer
// preferences. It is intentionally separate from the autosave/update path:
// only creating the next chapter advances the writer-memory clock.
type WriterMemoryDecayer interface {
	DecayForUniverse(context.Context, uuid.UUID) error
}

// SetWriterMemory wires the optional asynchronous chapter-save enrichment.
// Keeping it setter-based preserves existing constructor call sites and makes
// the hook nil-safe in unit tests.
func (s *ChapterService) SetWriterMemory(universeRepo *repositories.UniverseRepo, stylometry WriterObservationSink) {
	s.universeRepo = universeRepo
	s.stylometry = stylometry
}

func (s *ChapterService) SetWriterMemoryDecayer(decayer WriterMemoryDecayer) {
	s.writerDecay = decayer
}

func NewChapterService(pool *pgxpool.Pool, chapterRepo *repositories.ChapterRepo, workRepo *repositories.WorkRepo, relevSvc *RelevanceService) *ChapterService {
	return &ChapterService{
		pool:        pool,
		chapterRepo: chapterRepo,
		workRepo:    workRepo,
		relevSvc:    relevSvc,
	}
}

func (s *ChapterService) Create(ctx context.Context, workID uuid.UUID, input models.CreateChapterRequest) (*models.Chapter, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	maxOrder, err := s.chapterRepo.GetMaxOrderIndex(ctx, workID)
	if err != nil {
		return nil, err
	}

	c := &models.Chapter{
		ID:         uuid.New(),
		WorkID:     workID,
		Title:      input.Title,
		OrderIndex: maxOrder + 1,
		Content:    "",
		RawText:    "",
		WordCount:  0,
		Status:     "draft",
	}

	if err := s.chapterRepo.Create(ctx, tx, c); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	// Best-effort, non-blocking: chapter creation is the "chapter advance"
	// event that triggers relevance and writer-memory decay for the work's
	// universe. Update is an autosave and deliberately has no decay hook.
	if s.workRepo != nil && (s.relevSvc != nil || s.writerDecay != nil) {
		if w, err := s.workRepo.FindByID(ctx, workID); err != nil {
			log.Printf("[chapter] decay: lookup work %s: %v", workID, err)
		} else {
			if s.relevSvc != nil {
				if err := s.relevSvc.DecayAll(ctx, w.UniverseID); err != nil {
					log.Printf("[chapter] decay universe %s: %v", w.UniverseID, err)
				}
			}
			if s.writerDecay != nil {
				decayer := s.writerDecay
				universeID := w.UniverseID
				go func() {
					if err := decayer.DecayForUniverse(context.Background(), universeID); err != nil {
						log.Printf("[chapter] writer-memory decay universe %s: %v", universeID, err)
					}
				}()
			}
		}
	}

	return c, nil
}

func (s *ChapterService) GetByID(ctx context.Context, id uuid.UUID) (*models.Chapter, error) {
	return s.chapterRepo.FindByID(ctx, id)
}

func (s *ChapterService) ListByWork(ctx context.Context, workID uuid.UUID) ([]models.Chapter, error) {
	return s.chapterRepo.ListByWork(ctx, workID)
}

func (s *ChapterService) Update(ctx context.Context, id uuid.UUID, input models.UpdateChapterRequest) (*models.Chapter, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	c, err := s.chapterRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if input.Title != "" {
		c.Title = input.Title
	}
	if input.Content != "" {
		c.Content = input.Content
		c.WordCount = s.chapterRepo.CountWords(input.Content)
	}
	if input.RawText != "" {
		c.RawText = input.RawText
	}

	if err := s.chapterRepo.Update(ctx, tx, c); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	// Stylometry must never add latency to a chapter save. Resolve ownership
	// after the commit and run the observation pass on a detached context.
	if s.stylometry != nil && s.universeRepo != nil && c.Content != "" {
		chapter := *c
		go func() {
			ownerCtx := context.Background()
			u, lookupErr := s.universeRepo.FindByID(ownerCtx, chapter.UniverseID)
			if lookupErr != nil {
				log.Printf("[chapter] stylometry owner lookup %s: %v", chapter.ID, lookupErr)
				return
			}
			if _, observeErr := s.stylometry.Observe(ownerCtx, u.UserID, &chapter.UniverseID, chapter.Content); observeErr != nil {
				log.Printf("[chapter] stylometry chapter %s: %v", chapter.ID, observeErr)
			}
		}()
	}
	return c, nil
}

func (s *ChapterService) Delete(ctx context.Context, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := s.chapterRepo.Delete(ctx, tx, id); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
