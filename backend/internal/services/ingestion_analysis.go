package services

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/ws"
)

// SetPostIngestAnalysis wires optional bounded contradiction/plot-hole
// analysis to run after a document finishes ingesting. Same nil-safe setter
// pattern as MemoryService.SetConsolidationRepo — the constructor signature
// and all existing NewIngestionService call sites are unaffected. Any nil
// dependency (or never calling this setter) means runPostIngestAnalysis is a
// no-op: analysis is silently skipped, same as pre-change behavior.
func (s *IngestionService) SetPostIngestAnalysis(contraSvc *ContradictionService, plotHoleSvc *PlotHoleService, budgetMgr *ContextBudgetManager, maxChapters int) {
	s.contraSvc = contraSvc
	s.plotHoleSvc = plotHoleSvc
	s.analysisBudgetMgr = budgetMgr
	s.analysisMaxChapters = maxChapters
}

// selectAnalysisChapters picks the last K chapters that have at least one
// resolved entity (CheckSemantic no-ops on empty entities anyway, so
// including them would just waste a slot in the cap). Last-K, not first-K:
// contradictions surface against accumulated priors, and early chapters have
// nothing yet to contradict.
func selectAnalysisChapters(chapters []ingestedChapter, k int) []ingestedChapter {
	if k <= 0 {
		return nil
	}

	withEntities := make([]ingestedChapter, 0, len(chapters))
	for _, ch := range chapters {
		if len(ch.Entities) > 0 {
			withEntities = append(withEntities, ch)
		}
	}

	if len(withEntities) <= k {
		return withEntities
	}
	return withEntities[len(withEntities)-k:]
}

// runPostIngestAnalysis runs bounded contradiction checks (and one final
// plot-hole scan) over the tail of an ingested document's chapters.
//
// This is enrichment, not part of the core ingest contract: any error here
// is logged and skipped, never flips the job to "failed" — chapters,
// entities, and embeddings are already durably persisted by the time this
// runs. It also never calls AnalysisService.SubmitParagraph — that's the
// live per-paragraph editor queue, a different (much more expensive) path.
func (s *IngestionService) runPostIngestAnalysis(ctx context.Context, universeID uuid.UUID, chapters []ingestedChapter, ownerID uuid.UUID) {
	if s.contraSvc == nil || s.plotHoleSvc == nil || s.analysisBudgetMgr == nil {
		return
	}

	selected := selectAnalysisChapters(chapters, s.analysisMaxChapters)
	if len(selected) == 0 {
		return
	}

	analysisCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// ponytail: const 2, env knob if rate limits bite.
	const concurrency = 2
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	budget := (s.analysisBudgetMgr.maxContextTokens - s.analysisBudgetMgr.responseReserve) / 2

	for _, ch := range selected {
		ch := ch
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			// CheckSemantic parses untrusted LLM tool-call JSON and does type
			// assertions; a panic there must not crash the shared process.
			safeAnalyze("chapter "+ch.ID.String(), func() {
				text := s.analysisBudgetMgr.TruncateToTokens(ch.Content, budget)
				contradictions, err := s.contraSvc.CheckSemantic(analysisCtx, universeID, ch.ID, text, ch.Entities)
				if err != nil {
					log.Printf("[ingestion] post-ingest CheckSemantic chapter %s: %v", ch.ID, err)
					return
				}
				for _, c := range contradictions {
					s.emitContradictionAlert(ownerID, c)
				}
			})
		}()
	}
	wg.Wait()

	// One plot-hole scan after all chapters, against the last analyzed
	// chapter — persistence happens inside Scan (plotHoleRepo.Create); the
	// Plot Holes page fetches over REST, no WS message needed here. Wrapped in
	// safeAnalyze because it runs on this goroutine (runWorker's) — a panic
	// here would otherwise take down the whole process.
	lastChapterID := selected[len(selected)-1].ID
	safeAnalyze("plot hole scan", func() {
		if _, err := s.plotHoleSvc.Scan(analysisCtx, universeID, lastChapterID); err != nil {
			log.Printf("[ingestion] post-ingest plot hole scan: %v", err)
		}
	})
}

// safeAnalyze runs fn under a recover guard. Post-ingest analysis parses
// untrusted LLM tool-call JSON (CheckSemantic/Scan type-assert on it); an
// unrecovered panic on any goroutine kills the entire process, taking down
// every user's WebSocket, not just this ingestion job. label identifies the
// failing unit in the log. recover only catches panics on its own goroutine,
// so every spawned goroutine must call this itself.
func safeAnalyze(label string, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[ingestion] panic in analysis %s: %v", label, r)
		}
	}()
	fn()
}

// emitContradictionAlert sends a contradiction_alert WS message — the same
// shape frontend/src/stores/wsStore.ts already handles (payload.contradiction).
func (s *IngestionService) emitContradictionAlert(userID uuid.UUID, c models.Contradiction) {
	if s.hub == nil {
		return
	}
	payload, err := json.Marshal(models.ContradictionAlertPayload{
		UniverseID:    c.UniverseID,
		Contradiction: c,
	})
	if err != nil {
		log.Printf("[ingestion] marshal contradiction_alert: %v", err)
		return
	}
	msg := models.WSMessage{Type: ws.TypeContradictionAlert, Payload: payload}
	_ = s.hub.SendToUser(userID, msg)
}
