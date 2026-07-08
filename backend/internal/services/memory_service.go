package services

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
)

// rrfK is the Reciprocal Rank Fusion constant (Cormack et al.'s canonical
// choice): score += 1/(rrfK+rank) per pipeline appearance, rank 1-indexed.
const rrfK = 60

// rankedEntry is one pipeline's ranked output before fusion. id is the
// dedupe/identity key: an entity UUID string for entity-keyed sources
// (graph, recency, consolidated), or a synthetic "chapterID:snippet" key for
// vector/paragraph-sourced hits (entityID stays uuid.Nil for those).
type rankedEntry struct {
	id       string
	entityID uuid.UUID
	fact     string
	source   string
}

// HybridRecallItem is a fused, ranked recall result after RRF combines one
// or more pipeline appearances for the same id.
type HybridRecallItem struct {
	ID       string
	EntityID uuid.UUID
	Fact     string
	RRFScore float64
	Sources  []string
}

// fuseRRF combines any number of independently-ranked pipelines by
// Reciprocal Rank Fusion: score[id] += 1/(rrfK+rank) summed across every
// list the id appears in, rank 1-indexed within each list. Items are
// deduped by id; the first non-empty entityID/fact seen wins. Result is
// sorted by RRFScore descending, ties broken by ID ascending for
// determinism.
func fuseRRF(lists ...[]rankedEntry) []HybridRecallItem {
	byID := make(map[string]*HybridRecallItem)
	order := make([]string, 0)

	for _, list := range lists {
		for i, e := range list {
			item, exists := byID[e.id]
			if !exists {
				item = &HybridRecallItem{ID: e.id}
				byID[e.id] = item
				order = append(order, e.id)
			}
			item.RRFScore += 1.0 / float64(rrfK+i+1)
			item.Sources = append(item.Sources, e.source)
			if item.EntityID == uuid.Nil && e.entityID != uuid.Nil {
				item.EntityID = e.entityID
			}
			if item.Fact == "" && e.fact != "" {
				item.Fact = e.fact
			}
		}
	}

	result := make([]HybridRecallItem, 0, len(order))
	for _, id := range order {
		result = append(result, *byID[id])
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].RRFScore == result[j].RRFScore {
			return result[i].ID < result[j].ID
		}
		return result[i].RRFScore > result[j].RRFScore
	})
	return result
}

// ResolvedEntity is a shared type between MemoryService, ContradictionService,
// and AnalysisService. It pairs an entity with the mention text that triggered
// the resolution.
type ResolvedEntity struct {
	Entity      models.Entity
	MentionText string
	IsNew       bool
	// PreviousStatus is the entity's status as it was in the DB before this
	// mention's data was merged in (see EntityService.ResolveOrCreate).
	// Deterministic contradiction checks must compare against this, not
	// Entity.Status, which already reflects the newly-merged value.
	PreviousStatus string
}

// graphSeedCap bounds how many vector-derived (or, in degraded mode,
// recency-ranked) entity IDs seed the graph pipeline's neighbor lookup.
const graphSeedCap = 5

// pipelineSet holds the five independently-ranked pipeline outputs produced
// by runPipelines, before RRF fusion.
type pipelineSet struct {
	Vector, Graph, Recency, Keyword, Consolidated []rankedEntry
}

// MemoryService provides contextual recall by fusing up to four
// independently-ranked pipelines (vector similarity, graph context,
// recency/keyword, consolidated memories) via Reciprocal Rank Fusion.
//
// consolidationRepo and budgetMgr are optional (nil-safe): consolidationRepo
// nil skips the consolidated-memory pipeline, budgetMgr nil skips budget
// fitting. They are wired via SetConsolidationRepo/SetBudgetMgr rather than
// the constructor so existing call sites (main.go, tests) don't need to
// change until they're ready to supply real values.
type MemoryService struct {
	graphRepo         *repositories.GraphRepo
	entityRepo        *repositories.EntityRepo
	vectorRepo        *repositories.VectorRepo
	consolidationRepo *repositories.ConsolidationRepo
	budgetMgr         *ContextBudgetManager

	// historyRepo and relevanceDeltaEpsilon back MemoryStatus (see
	// memory_status.go). Wired via SetHistoryRepo/SetRelevanceDeltaEpsilon,
	// same optional-setter pattern as consolidationRepo/budgetMgr.
	historyRepo           *repositories.EntityRelevanceHistoryRepo
	relevanceDeltaEpsilon float64
}

// NewMemoryService creates a memory service with the given repos.
func NewMemoryService(graphRepo *repositories.GraphRepo, entityRepo *repositories.EntityRepo, vectorRepo *repositories.VectorRepo) *MemoryService {
	return &MemoryService{
		graphRepo:  graphRepo,
		entityRepo: entityRepo,
		vectorRepo: vectorRepo,
	}
}

// SetConsolidationRepo wires the consolidated-memory pipeline. Optional —
// nil-safe; the pipeline is skipped when unset.
func (s *MemoryService) SetConsolidationRepo(r *repositories.ConsolidationRepo) {
	s.consolidationRepo = r
}

// SetBudgetMgr wires context-budget fitting via FitToBudget/VectorTokens.
// Optional — nil-safe; budget fitting is skipped when unset.
func (s *MemoryService) SetBudgetMgr(b *ContextBudgetManager) {
	s.budgetMgr = b
}

// Recall is the caller-compatible entrypoint kept for existing callers
// (ws/hub.go, handlers/graph.go, analysis_service.go) that don't yet pass a
// queryText. It delegates to RecallWithQuery with an empty queryText, which
// is exactly the degraded/normal split those callers already rely on
// (embedding present → normal vector-seeded mode; embedding absent →
// degraded recency-seeded mode).
func (s *MemoryService) Recall(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, k int) ([]models.RecallItem, error) {
	return s.RecallWithQuery(ctx, universeID, queryEmbedding, "", k)
}

// RecallWithQuery returns up to k RecallItems for a universe, fusing vector
// similarity, graph context, recency, keyword, and consolidated-memory
// pipelines via Reciprocal Rank Fusion (see fuseRRF).
//
// Normal mode (embedding present): the vector pipeline runs first; the
// entities mentioned in its top paragraph hits seed the graph pipeline
// (capped at graphSeedCap), so graph context follows query semantics.
// Degraded mode (embedding absent AND queryText empty): vector, keyword, and
// consolidated pipelines are skipped; the graph pipeline instead seeds from
// the top graphSeedCap recency-ranked active entities.
func (s *MemoryService) RecallWithQuery(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, queryText string, k int) ([]models.RecallItem, error) {
	ps, err := s.runPipelines(ctx, universeID, queryEmbedding, queryText, k)
	if err != nil {
		return nil, err
	}

	fused := fuseRRF(ps.Vector, ps.Graph, ps.Recency, ps.Keyword, ps.Consolidated)

	if s.budgetMgr != nil {
		fused = s.fitToBudget(fused)
	}

	if k > 0 && len(fused) > k {
		fused = fused[:k]
	}

	return s.toRecallItems(fused), nil
}

// RecallWithPipelines runs only the named pipelines from the given set,
// fuses them via RRF, and returns the result. Pipeline names: "vector",
// "graph", "recency", "keyword", "consolidated". If pipelines is empty
// or nil, runs all five (equivalent to RecallWithQuery, minus budget
// fitting). Unknown pipeline names are silently ignored.
//
// ponytail: always runs all 5 pipelines via runPipelines even when only
// one is requested — acceptable for small-corpus ablation. Upgrade to
// per-pipeline execution if ablation cost becomes a concern.
func (s *MemoryService) RecallWithPipelines(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, queryText string, k int, pipelines []string) ([]models.RecallItem, error) {
	ps, err := s.runPipelines(ctx, universeID, queryEmbedding, queryText, k)
	if err != nil {
		return nil, err
	}

	all := map[string][]rankedEntry{
		"vector":       ps.Vector,
		"graph":        ps.Graph,
		"recency":      ps.Recency,
		"keyword":      ps.Keyword,
		"consolidated": ps.Consolidated,
	}

	var selected [][]rankedEntry
	if len(pipelines) == 0 {
		selected = [][]rankedEntry{ps.Vector, ps.Graph, ps.Recency, ps.Keyword, ps.Consolidated}
	} else {
		order := []string{"vector", "graph", "recency", "keyword", "consolidated"}
		for _, name := range order {
			for _, p := range pipelines {
				if p == name {
					selected = append(selected, all[name])
					break
				}
			}
		}
	}

	fused := fuseRRF(selected...)
	if k > 0 && len(fused) > k {
		fused = fused[:k]
	}
	return s.toRecallItems(fused), nil
}

// runPipelines fans out the vector, graph, recency, keyword, and
// consolidated-memory pipelines for a recall query, honoring the same
// normal/degraded-mode seeding and nil-guard rules as RecallWithQuery (see
// its doc comment). All goroutines are joined (wg.Wait()) before returning,
// so callers observe the same happens-before guarantees RecallWithQuery
// always had.
func (s *MemoryService) runPipelines(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, queryText string, k int) (pipelineSet, error) {
	entities, err := s.entityRepo.ListByUniverseActive(ctx, universeID)
	if err != nil {
		return pipelineSet{}, fmt.Errorf("recall: list active entities: %w", err)
	}

	hasEmbedding := len(queryEmbedding) > 0
	hasText := queryText != ""
	graphName := "universe_" + universeID.String()

	sortedEntities := make([]models.Entity, len(entities))
	copy(sortedEntities, entities)
	sort.Slice(sortedEntities, func(i, j int) bool {
		return sortedEntities[i].RelevanceScore > sortedEntities[j].RelevanceScore
	})

	var (
		vectorRanked       []rankedEntry
		graphRanked        []rankedEntry
		recencyRanked      []rankedEntry
		keywordRanked      []rankedEntry
		consolidatedRanked []rankedEntry
		graphSeeds         []uuid.UUID
	)

	if hasEmbedding {
		vectorRanked, graphSeeds = s.vectorPipelineAndSeeds(ctx, universeID, queryEmbedding, k)
	} else {
		for i := 0; i < len(sortedEntities) && i < graphSeedCap; i++ {
			graphSeeds = append(graphSeeds, sortedEntities[i].ID)
		}
	}

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		graphRanked = s.graphPipeline(ctx, graphName, graphSeeds)
	}()

	for _, e := range sortedEntities {
		recencyRanked = append(recencyRanked, rankedEntry{
			id:       e.ID.String(),
			entityID: e.ID,
			fact:     fmt.Sprintf("Recently active entity: %s", e.Name),
			source:   "recency",
		})
	}

	if hasText {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hits, err := s.vectorRepo.KeywordSearch(ctx, universeID, queryText, k)
			if err != nil {
				return
			}
			for _, h := range hits {
				keywordRanked = append(keywordRanked, rankedEntry{
					id:     h.ChapterID.String() + ":" + h.Content,
					fact:   h.Content,
					source: "keyword",
				})
			}
		}()
	}

	if hasEmbedding && s.consolidationRepo != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hits, err := s.consolidationRepo.FindSimilarByEmbedding(ctx, universeID, queryEmbedding, k)
			if err != nil {
				return
			}
			for _, h := range hits {
				consolidatedRanked = append(consolidatedRanked, rankedEntry{
					id:       h.EntityID.String(),
					entityID: h.EntityID,
					fact:     h.Summary,
					source:   "consolidated",
				})
			}
		}()
	}

	wg.Wait()

	return pipelineSet{
		Vector:       vectorRanked,
		Graph:        graphRanked,
		Recency:      recencyRanked,
		Keyword:      keywordRanked,
		Consolidated: consolidatedRanked,
	}, nil
}

// toRecallItems maps fused, ranked HybridRecallItems to the API-facing
// models.RecallItem shape, joining multi-pipeline Sources with a comma.
func (s *MemoryService) toRecallItems(fused []HybridRecallItem) []models.RecallItem {
	items := make([]models.RecallItem, len(fused))
	for i, f := range fused {
		items[i] = models.RecallItem{
			ID:       f.ID,
			EntityID: f.EntityID,
			Fact:     f.Fact,
			Score:    f.RRFScore,
			Source:   strings.Join(f.Sources, ","),
		}
	}
	return items
}

// RecallExplanation is the full explain-mode response for
// /recall/explain: the fused, ranked items each carrying a per-pipeline RRF
// contribution ledger, plus the raw per-pipeline result counts and the
// context-budget report used to compute FitInBudget.
type RecallExplanation struct {
	Query         string          `json:"query"`
	PipelineSizes map[string]int  `json:"pipeline_sizes"`
	Items         []ExplainedItem `json:"items"`
	Budget        BudgetReport    `json:"budget"`
}

// RecallExplain is the explain-mode counterpart to RecallWithQuery: it fuses
// the same five pipelines via fuseRRFExplain (recording a full contribution
// ledger per item instead of collapsing straight to models.RecallItem),
// always reports all 5 PipelineSizes keys (0 for skipped/empty pipelines),
// and marks FitInBudget per item against the real budget report. When
// budgetMgr is nil, every item reports FitInBudget=true and Budget is the
// zero value — it never panics (mirrors RecallWithQuery's nil-guard).
func (s *MemoryService) RecallExplain(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, queryText string, k int) (RecallExplanation, error) {
	ps, err := s.runPipelines(ctx, universeID, queryEmbedding, queryText, k)
	if err != nil {
		return RecallExplanation{}, err
	}

	pairs := []namedPipeline{
		{Name: "vector", Entries: ps.Vector},
		{Name: "graph", Entries: ps.Graph},
		{Name: "recency", Entries: ps.Recency},
		{Name: "keyword", Entries: ps.Keyword},
		{Name: "consolidated", Entries: ps.Consolidated},
	}

	items := fuseRRFExplain(pairs)

	pipelineSizes := make(map[string]int, len(pairs))
	for _, p := range pairs {
		pipelineSizes[p.Name] = len(p.Entries)
	}

	var budget BudgetReport
	if s.budgetMgr != nil {
		ranked := make([]RankedItem, len(items))
		for i := range items {
			ranked[i] = RankedItem{Text: items[i].Fact, Score: items[i].RRFScore}
		}
		survivors, alloc := s.budgetSurvivors(ranked)
		for i := range items {
			items[i].FitInBudget = survivors[items[i].Fact]
		}
		budget = alloc.Report(s.budgetMgr.maxContextTokens)
	} else {
		for i := range items {
			items[i].FitInBudget = true
		}
	}

	if k > 0 && len(items) > k {
		items = items[:k]
	}

	return RecallExplanation{
		Query:         queryText,
		PipelineSizes: pipelineSizes,
		Items:         items,
		Budget:        budget,
	}, nil
}

// vectorPipelineAndSeeds runs the vector-similarity pipeline and derives
// graph seeds from the entities mentioned in the top-ranked paragraph hits
// (ADR-2: vector-seeded graph pipeline), preserving vector rank order and
// capping at graphSeedCap. excludeChapterID is uuid.Nil — Recall has no
// "current chapter" context to exclude, matching agent_tools.go's usage.
func (s *MemoryService) vectorPipelineAndSeeds(ctx context.Context, universeID uuid.UUID, queryEmbedding []float32, k int) ([]rankedEntry, []uuid.UUID) {
	paragraphs, err := s.vectorRepo.FindSimilarParagraphs(ctx, universeID, queryEmbedding, uuid.Nil, k)
	if err != nil || len(paragraphs) == 0 {
		return nil, nil
	}

	ranked := make([]rankedEntry, 0, len(paragraphs))
	keys := make([]repositories.ParagraphKey, 0, len(paragraphs))
	for _, p := range paragraphs {
		ranked = append(ranked, rankedEntry{
			id:     p.ChapterID.String() + ":" + p.Content,
			fact:   p.Content,
			source: "vector",
		})
		keys = append(keys, repositories.ParagraphKey{ChapterID: p.ChapterID, ParagraphIndex: p.ParagraphIndex})
	}

	mentions, err := s.entityRepo.EntityIDsForParagraphs(ctx, keys)
	if err != nil {
		return ranked, nil
	}

	seen := make(map[uuid.UUID]bool)
	var seeds []uuid.UUID
	for _, key := range keys {
		for _, eid := range mentions[key] {
			if seen[eid] {
				continue
			}
			seen[eid] = true
			seeds = append(seeds, eid)
			if len(seeds) >= graphSeedCap {
				return ranked, seeds
			}
		}
	}
	return ranked, seeds
}

// graphPipeline resolves 1-hop neighbors for all seeds via a single batched
// GetNeighborsBatch call (spec: "Graph Pipeline Uses Batched Neighbor
// Lookup" — not one GetNeighbors call per seed) and ranks the union by
// co-citation count (neighbors reachable from more than one seed rank
// higher).
func (s *MemoryService) graphPipeline(ctx context.Context, graphName string, seeds []uuid.UUID) []rankedEntry {
	coCitation := make(map[uuid.UUID]int)
	order := make([]uuid.UUID, 0)

	if len(seeds) == 0 {
		return nil
	}

	seedIDs := make([]string, len(seeds))
	for i, seed := range seeds {
		seedIDs[i] = seed.String()
	}

	neighborsBySeed, err := s.graphRepo.GetNeighborsBatch(ctx, graphName, seedIDs)
	if err != nil {
		return nil
	}

	for _, seedID := range seedIDs {
		for _, n := range neighborsBySeed[seedID] {
			nid, ok := extractEntityIDFromNode(n.Node)
			if !ok {
				continue
			}
			if _, exists := coCitation[nid]; !exists {
				order = append(order, nid)
			}
			coCitation[nid]++
		}
	}

	sort.Slice(order, func(i, j int) bool { return coCitation[order[i]] > coCitation[order[j]] })

	entries := make([]rankedEntry, 0, len(order))
	for _, nid := range order {
		entries = append(entries, rankedEntry{
			id:       nid.String(),
			entityID: nid,
			fact:     "Related entity",
			source:   "graph",
		})
	}
	return entries
}

// extractEntityIDFromNode pulls the entity_id property out of an AGE agtype
// node string via plain substring search — the same sharp-edge tolerant
// approach as repositories.extractProp (AGE nodes serialize to JSON-ish
// text, not structured Go values).
func extractEntityIDFromNode(nodeStr string) (uuid.UUID, bool) {
	const key = `"entity_id": "`
	idx := strings.Index(nodeStr, key)
	if idx < 0 {
		return uuid.Nil, false
	}
	start := idx + len(key)
	end := strings.Index(nodeStr[start:], `"`)
	if end < 0 {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(nodeStr[start : start+end])
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

// budgetSurvivors computes which items (keyed by RankedItem.Text) survive the
// BudgetAllocation.VectorTokens slice of the context budget, and returns the
// allocation used. It is the single home of the budget-fit recipe shared by
// fitToBudget (which DROPS non-survivors from the recall path) and
// RecallExplain (which FLAGS them via FitInBudget), so the two can never drift
// (ADR-4: assumes near-unique facts per call). Callers guarantee budgetMgr != nil.
func (s *MemoryService) budgetSurvivors(ranked []RankedItem) (map[string]bool, BudgetAllocation) {
	alloc := s.budgetMgr.ComputeBudget(0, 0)
	fitted, _, _ := s.budgetMgr.FitToBudget(ranked, alloc.VectorTokens)
	survivors := make(map[string]bool, len(fitted))
	for _, f := range fitted {
		survivors[f.Text] = true
	}
	return survivors, alloc
}

// fitToBudget drops fused items that don't fit the VectorTokens budget,
// preserving the fused (RRF) order of the survivors — deterministic on score
// ties, unlike re-emitting the internally re-sorted fitted list.
func (s *MemoryService) fitToBudget(fused []HybridRecallItem) []HybridRecallItem {
	ranked := make([]RankedItem, len(fused))
	for i := range fused {
		ranked[i] = RankedItem{Text: fused[i].Fact, Score: fused[i].RRFScore}
	}

	survivors, _ := s.budgetSurvivors(ranked)

	result := make([]HybridRecallItem, 0, len(fused))
	for i := range fused {
		if survivors[fused[i].Fact] {
			result = append(result, fused[i])
		}
	}
	return result
}
