package eval

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"

	"github.com/quill/backend/internal/config"
	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/repositories"
	"github.com/quill/backend/internal/services"
	"github.com/quill/backend/internal/testutil"
)

// evalFixture holds the shared setup for memory evaluation tests.
type evalFixture struct {
	pool                *pgxpool.Pool
	svc                 *services.MemoryService
	qwen                *services.QwenService
	universeID          uuid.UUID
	gold                *GoldSet
	paragraphToEntities map[string][]uuid.UUID
}

// setupSagaEval loads the gold corpus, builds a real MemoryService, and
// backfills paragraph embeddings for the saga universe.
func setupSagaEval(t *testing.T) *evalFixture {
	t.Helper()

	pool := testutil.SetupTestDB(t)

	if !testutil.CheckAGE(t, pool) {
		t.Skip("Apache AGE required for corpus migration 014")
	}
	if os.Getenv("QWEN_API_KEY") == "" {
		t.Skip("QWEN_API_KEY required for semantic recall eval")
	}

	gold, err := LoadGold("corpus/saga_gold.json")
	if err != nil {
		t.Fatalf("load gold corpus: %v", err)
	}

	svc, universeID := buildRealMemoryService(t, pool)
	resolveGoldIDs(t, pool, gold)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	qwen := services.NewQwenService(cfg, nil)

	ctx := context.Background()
	paragraphToEntities := backfillParagraphEmbeddings(t, ctx, pool, qwen, universeID)

	return &evalFixture{
		pool:                pool,
		svc:                 svc,
		qwen:                qwen,
		universeID:          universeID,
		gold:                gold,
		paragraphToEntities: paragraphToEntities,
	}
}

// backfillParagraphEmbeddings splits each saga chapter into paragraphs,
// generates real embeddings for them, and persists paragraph_embeddings rows.
// It returns a map from paragraph content to the entity IDs mentioned in it.
func backfillParagraphEmbeddings(t *testing.T, ctx context.Context, pool *pgxpool.Pool, qwen *services.QwenService, universeID uuid.UUID) map[string][]uuid.UUID {
	t.Helper()

	vectorRepo := repositories.NewVectorRepo(pool)

	rows, err := pool.Query(ctx, `
		SELECT c.id, c.content
		FROM chapters c
		JOIN works w ON c.work_id = w.id
		WHERE w.universe_id = $1
		ORDER BY c.order_index
	`, universeID)
	if err != nil {
		t.Fatalf("query chapters: %v", err)
	}
	defer rows.Close()

	type paragraph struct {
		chapterID uuid.UUID
		index     int
		content   string
	}

	var paragraphs []paragraph
	var keys []repositories.ParagraphKey
	for rows.Next() {
		var chapterID uuid.UUID
		var content string
		if err := rows.Scan(&chapterID, &content); err != nil {
			t.Fatalf("scan chapter: %v", err)
		}
		// paragraph_index is 1-based to match the entity_mentions seeded by migration 014.
		for i, part := range strings.Split(content, "\n\n") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			pIdx := i + 1
			paragraphs = append(paragraphs, paragraph{chapterID: chapterID, index: pIdx, content: part})
			keys = append(keys, repositories.ParagraphKey{ChapterID: chapterID, ParagraphIndex: pIdx})
		}
	}

	const batchSize = 10
	for offset := 0; offset < len(paragraphs); offset += batchSize {
		end := offset + batchSize
		if end > len(paragraphs) {
			end = len(paragraphs)
		}
		batch := paragraphs[offset:end]
		contents := make([]string, len(batch))
		for i, p := range batch {
			contents[i] = p.content
		}

		embeddings, err := qwen.GenerateEmbeddingBatch(ctx, contents)
		if err != nil {
			t.Fatalf("embed paragraphs batch %d: %v", offset/batchSize, err)
		}
		if len(embeddings) != len(batch) {
			t.Fatalf("embeddings count mismatch in batch %d: got %d, want %d", offset/batchSize, len(embeddings), len(batch))
		}

		for i, p := range batch {
			nodeID := fmt.Sprintf("eval-node-%d", offset+i)
			if err := vectorRepo.SaveParagraphEmbedding(ctx, p.chapterID, p.index, nodeID, p.content, embeddings[i]); err != nil {
				t.Fatalf("save paragraph embedding: %v", err)
			}
		}
	}

	entityRepo := repositories.NewEntityRepo(pool)
	mentions, err := entityRepo.EntityIDsForParagraphs(ctx, keys)
	if err != nil {
		t.Fatalf("entity ids for paragraphs: %v", err)
	}

	result := make(map[string][]uuid.UUID, len(paragraphs))
	for _, p := range paragraphs {
		key := repositories.ParagraphKey{ChapterID: p.chapterID, ParagraphIndex: p.index}
		result[p.content] = mentions[key]
	}
	return result
}

// itemEntityIDs resolves a recall item to the entity IDs it represents.
// Paragraph-sourced items (nil EntityID) are mapped via paragraph content.
func itemEntityIDs(item models.RecallItem, paragraphToEntities map[string][]uuid.UUID) []uuid.UUID {
	if item.EntityID != uuid.Nil {
		return []uuid.UUID{item.EntityID}
	}
	return paragraphToEntities[item.Fact]
}

// retrievedEntityIDs flattens recall items into a slice of entity ID strings.
func retrievedEntityIDs(items []models.RecallItem, paragraphToEntities map[string][]uuid.UUID) []string {
	var out []string
	for _, item := range items {
		for _, id := range itemEntityIDs(item, paragraphToEntities) {
			out = append(out, id.String())
		}
	}
	return out
}

// relevantSet builds a string set from a gold query's resolved entity IDs.
func relevantSet(q GoldQuery) map[string]bool {
	set := make(map[string]bool, len(q.RelevantEntityIDs))
	for _, id := range q.RelevantEntityIDs {
		set[id.String()] = true
	}
	return set
}

func TestMemoryEvalRecall(t *testing.T) {
	fx := setupSagaEval(t)
	ctx := context.Background()

	var report RecallReport
	for _, q := range fx.gold.Queries {
		emb, err := fx.qwen.GenerateEmbedding(ctx, q.Query)
		if err != nil {
			t.Fatalf("embed query %s: %v", q.ID, err)
		}

		items, err := fx.svc.RecallWithQuery(ctx, fx.universeID, emb, q.Query, 10)
		if err != nil {
			t.Fatalf("recall query %s: %v", q.ID, err)
		}

		retrieved := retrievedEntityIDs(items, fx.paragraphToEntities)
		relevant := relevantSet(q)

		report.Queries = append(report.Queries, QueryReport{
			ID:           q.ID,
			Query:        q.Query,
			RecallAt5:    recallAtK(retrieved, relevant, 5),
			PrecisionAt5: precisionAtK(retrieved, relevant, 5),
			MRR:          mrr(retrieved, relevant),
			NDCGAt5:      ndcgAtK(retrieved, relevant, 5),
		})
	}

	writeRecallReport(t, "../../Docs/eval/results.md", report)
}

func TestMemoryEvalAblation(t *testing.T) {
	fx := setupSagaEval(t)
	ctx := context.Background()

	pipelineSets := []struct {
		name      string
		pipelines []string
	}{
		{"vector", []string{"vector"}},
		{"graph", []string{"graph"}},
		{"recency", []string{"recency"}},
		{"keyword", []string{"keyword"}},
		{"vector+graph", []string{"vector", "graph"}},
		{"all", nil},
	}

	queryEmbeddings := make(map[string][]float32, len(fx.gold.Queries))
	for _, q := range fx.gold.Queries {
		emb, err := fx.qwen.GenerateEmbedding(ctx, q.Query)
		if err != nil {
			t.Fatalf("embed query %s: %v", q.ID, err)
		}
		queryEmbeddings[q.Query] = emb
	}

	t.Logf("Memory eval ablation (average recall@5 over %d queries):", len(fx.gold.Queries))
	for _, ps := range pipelineSets {
		var totalRecall float64
		for _, q := range fx.gold.Queries {
			items, err := fx.svc.RecallWithPipelines(ctx, fx.universeID, queryEmbeddings[q.Query], q.Query, 5, ps.pipelines)
			if err != nil {
				t.Fatalf("recall query %s with pipelines %v: %v", q.ID, ps.pipelines, err)
			}

			retrieved := retrievedEntityIDs(items, fx.paragraphToEntities)
			totalRecall += recallAtK(retrieved, relevantSet(q), 5)
		}
		avg := totalRecall / float64(len(fx.gold.Queries))
		t.Logf("  %-14s %.3f", ps.name, avg)
	}
}

// createLatencyUniverse inserts a fresh user + universe for synthetic latency tests.
func createLatencyUniverse(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	userID := uuid.New()
	email := fmt.Sprintf("latency+%s@example.com", userID.String())
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
		userID, email, "hash", "Latency User",
	); err != nil {
		t.Fatalf("create latency user: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	universeID := uuid.New()
	universeRepo := repositories.NewUniverseRepo(pool)
	u := &models.Universe{
		ID:     universeID,
		UserID: userID,
		Name:   "Latency Universe",
		Format: "novel",
		Genre:  "fantasy",
	}
	if err := universeRepo.Create(ctx, tx, u); err != nil {
		t.Fatalf("create latency universe: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit latency universe: %v", err)
	}
	return universeID
}

// deleteLatencyUniverse removes a universe created by createLatencyUniverse.
func deleteLatencyUniverse(t *testing.T, pool *pgxpool.Pool, universeID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	if err := repositories.NewUniverseRepo(pool).Delete(ctx, tx, universeID); err != nil {
		t.Fatalf("delete latency universe: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit delete universe: %v", err)
	}
}

// createSyntheticEntities inserts N deterministic entities + embeddings for the latency harness.
func createSyntheticEntities(t *testing.T, pool *pgxpool.Pool, universeID uuid.UUID, n int) {
	t.Helper()
	ctx := context.Background()
	entityRepo := repositories.NewEntityRepo(pool)
	vectorRepo := repositories.NewVectorRepo(pool)

	const batchSize = 500
	for offset := 0; offset < n; offset += batchSize {
		end := offset + batchSize
		if end > n {
			end = n
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin tx: %v", err)
		}

		ids := make([]uuid.UUID, end-offset)
		for i := range ids {
			ids[i] = uuid.New()
			e := &models.Entity{
				ID:             ids[i],
				UniverseID:     universeID,
				Type:           "character",
				Name:           fmt.Sprintf("Latency Entity %d", offset+i),
				Aliases:        []string{},
				Description:    "",
				Properties:     json.RawMessage("{}"),
				Status:         "active",
				RelevanceScore: 0.8,
			}
			if err := entityRepo.Create(ctx, tx, e); err != nil {
				tx.Rollback(ctx)
				t.Fatalf("create entity %d: %v", offset+i, err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit entity batch: %v", err)
		}

		for i, id := range ids {
			if err := vectorRepo.SaveEntityEmbedding(ctx, id, makeSyntheticEmbedding(offset+i)); err != nil {
				t.Fatalf("save entity embedding %d: %v", offset+i, err)
			}
		}
		t.Logf("created entities %d/%d", end, n)
	}
}

func TestMemoryEvalLatency(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	runMigrationsForEval(t, pool)
	ctx := context.Background()

	svc := services.NewMemoryService(
		repositories.NewGraphRepo(pool),
		repositories.NewEntityRepo(pool),
		repositories.NewVectorRepo(pool),
	)

	entityCounts := []int{50, 200, 1000, 5000}
	var rows []LatencyRow
	var cleanup []uuid.UUID
	defer func() {
		for _, id := range cleanup {
			deleteLatencyUniverse(t, pool, id)
		}
	}()

	const repeats = 20
	for _, n := range entityCounts {
		universeID := createLatencyUniverse(t, pool)
		cleanup = append(cleanup, universeID)
		createSyntheticEntities(t, pool, universeID, n)

		// Warm one degraded-mode recall so connection pools, plans, and caches are exercised.
		_, _ = svc.RecallWithQuery(ctx, universeID, nil, "", 5)

		durations := make([]float64, repeats)
		for i := 0; i < repeats; i++ {
			start := time.Now()
			_, err := svc.RecallWithQuery(ctx, universeID, nil, "", 5)
			if err != nil {
				t.Fatalf("recall iteration %d for n=%d: %v", i, n, err)
			}
			durations[i] = float64(time.Since(start).Milliseconds())
		}

		sort.Float64s(durations)
		row := LatencyRow{
			N:     n,
			P50Ms: durations[repeats/2],
			P95Ms: durations[repeats*95/100],
		}
		rows = append(rows, row)
		t.Logf("latency n=%d p50=%.3fms p95=%.3fms", row.N, row.P50Ms, row.P95Ms)
	}

	appendLatencyReport(t, "../../Docs/eval/results.md", rows)
}

func TestMemoryEvalForgetting(t *testing.T) {
	pool := testutil.SetupTestDB(t)
	if !testutil.CheckAGE(t, pool) {
		t.Skip("Apache AGE required for corpus migration 014")
	}
	runMigrationsForEval(t, pool)
	ctx := context.Background()

	gold, err := LoadGold("corpus/saga_gold.json")
	if err != nil {
		t.Fatalf("load gold corpus: %v", err)
	}
	resolveGoldIDs(t, pool, gold)

	universeID := uuid.MustParse(sagaUniverseIDString)
	entityRepo := repositories.NewEntityRepo(pool)

	initial, err := entityRepo.ListByUniverseActive(ctx, universeID)
	if err != nil {
		t.Fatalf("list initial active entities: %v", err)
	}
	t.Logf("initial active entities: %d", len(initial))

	const (
		// ponytail: fixed per-tick decay means every active entity eventually drops
		// below threshold. K=17 is the tick count where the two low gold scorers
		// (0.72, 0.75) archive while the high gold scorers (>=0.90) remain active.
		K         = 17
		lambda    = 0.1
		threshold = 0.15
	)
	relSvc := services.NewRelevanceService(pool, entityRepo, lambda, threshold, nil)

	for i := 0; i < K; i++ {
		if err := relSvc.DecayAll(ctx, universeID); err != nil {
			t.Fatalf("DecayAll iteration %d: %v", i, err)
		}
	}

	remaining, err := entityRepo.ListByUniverseActive(ctx, universeID)
	if err != nil {
		t.Fatalf("list remaining active entities: %v", err)
	}
	t.Logf("remaining active entities after %d decays: %d", K, len(remaining))

	activeSet := make(map[uuid.UUID]bool, len(remaining))
	for _, e := range remaining {
		activeSet[e.ID] = true
	}

	nameByID := make(map[uuid.UUID]string)
	for i, name := range gold.Forgetting.ShouldBeArchived {
		nameByID[gold.Forgetting.ShouldBeArchivedIDs[i]] = name
	}
	for i, name := range gold.Forgetting.MustStayActive {
		nameByID[gold.Forgetting.MustStayActiveIDs[i]] = name
	}

	var falseNegNames, falsePosNames []string
	falseNegatives := 0
	for _, id := range gold.Forgetting.ShouldBeArchivedIDs {
		if activeSet[id] {
			falseNegatives++
			falseNegNames = append(falseNegNames, nameByID[id])
		}
	}
	falsePositives := 0
	for _, id := range gold.Forgetting.MustStayActiveIDs {
		if !activeSet[id] {
			falsePositives++
			falsePosNames = append(falsePosNames, nameByID[id])
		}
	}

	report := ForgettingReport{
		K:                  K,
		Lambda:             lambda,
		Threshold:          threshold,
		TotalEntities:      len(remaining),
		Archived:           len(initial) - len(remaining),
		ShouldArchived:     len(gold.Forgetting.ShouldBeArchivedIDs),
		MustStayActive:     len(gold.Forgetting.MustStayActiveIDs),
		FalseNegatives:     falseNegatives,
		FalsePositives:     falsePositives,
		FalseNegativeNames: strings.Join(falseNegNames, ", "),
		FalsePositiveNames: strings.Join(falsePosNames, ", "),
	}
	appendForgettingReport(t, "../../Docs/eval/results.md", report)

	if falseNegatives > 0 {
		t.Errorf("false negatives (should be archived but still active): %s", report.FalseNegativeNames)
	}
	if falsePositives > 0 {
		t.Errorf("false positives (should stay active but archived): %s", report.FalsePositiveNames)
	}
}

// mentionCentroid returns the average embedding of all paragraph mentions for an entity.
func mentionCentroid(ctx context.Context, pool *pgxpool.Pool, entityID uuid.UUID) ([]float32, error) {
	rows, err := pool.Query(ctx, `
		SELECT pe.embedding
		FROM paragraph_embeddings pe
		JOIN entity_mentions em
		  ON em.chapter_id = pe.chapter_id
		 AND em.paragraph_index = pe.paragraph_index
		WHERE em.entity_id = $1
	`, entityID)
	if err != nil {
		return nil, fmt.Errorf("query mention embeddings: %w", err)
	}
	defer rows.Close()

	var sum []float64
	count := 0
	for rows.Next() {
		var vec pgvector.Vector
		if err := rows.Scan(&vec); err != nil {
			return nil, fmt.Errorf("scan mention embedding: %w", err)
		}
		v := vec.Slice()
		if sum == nil {
			sum = make([]float64, len(v))
		}
		for i, x := range v {
			sum[i] += float64(x)
		}
		count++
	}
	if count == 0 {
		return nil, fmt.Errorf("no mention embeddings found for entity %s", entityID)
	}

	centroid := make([]float32, len(sum))
	for i, s := range sum {
		centroid[i] = float32(s / float64(count))
	}
	return centroid, nil
}

// cosineSimilarity returns the cosine of the angle between two vectors.
func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		x := float64(a[i])
		y := float64(b[i])
		dot += x * y
		na += x * x
		nb += y * y
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func TestMemoryEvalConsolidationFidelity(t *testing.T) {
	if os.Getenv("QWEN_API_KEY") == "" {
		t.Skip("QWEN_API_KEY required for consolidation fidelity eval")
	}
	fx := setupSagaEval(t)
	ctx := context.Background()

	entityRepo := repositories.NewEntityRepo(fx.pool)
	consolidationRepo := repositories.NewConsolidationRepo(fx.pool)
	consolidationSvc := services.NewConsolidationService(consolidationRepo, entityRepo, fx.qwen)

	var rows []ConsolidationRow
	for _, name := range fx.gold.ConsolidationTargets {
		entity, err := entityRepo.FindByName(ctx, fx.universeID, name)
		if err != nil {
			t.Fatalf("resolve entity %q: %v", name, err)
		}

		if err := consolidationSvc.ConsolidateEntity(ctx, entity.ID, fx.universeID); err != nil {
			t.Fatalf("consolidate entity %q: %v", name, err)
		}

		cm, err := consolidationRepo.FindByEntityID(ctx, entity.ID)
		if err != nil {
			t.Fatalf("find consolidated memory for %q: %v", name, err)
		}

		centroid, err := mentionCentroid(ctx, fx.pool, entity.ID)
		if err != nil {
			t.Fatalf("mention centroid for %q: %v", name, err)
		}

		cosine := cosineSimilarity(cm.Embedding, centroid)
		rows = append(rows, ConsolidationRow{EntityName: name, Cosine: cosine})
		t.Logf("consolidation fidelity %s: %.4f", name, cosine)
	}

	appendConsolidationReport(t, "../../Docs/eval/results.md", rows)
}
