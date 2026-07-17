package services

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"

	"github.com/quill/backend/internal/repositories"
)

var (
	ErrDemoAuthenticationRequired = errors.New("authentication required")
	ErrDemoSessionRequired        = errors.New("demo session ID is required")
	ErrDemoSessionInvalid         = errors.New("demo session ID must be an opaque UUID")
	ErrDemoUniverseNotFound       = errors.New("demo universe not found")
)

type DemoService struct {
	pool         *pgxpool.Pool
	universeRepo *repositories.UniverseRepo
	graphRepo    *repositories.GraphRepo
}

func NewDemoService(pool *pgxpool.Pool, universeRepo *repositories.UniverseRepo, graphRepo *repositories.GraphRepo) *DemoService {
	return &DemoService{
		pool:         pool,
		universeRepo: universeRepo,
		graphRepo:    graphRepo,
	}
}

func (s *DemoService) CloneUniverse(ctx context.Context, userID uuid.UUID, sessionID string) (string, error) {
	if userID == uuid.Nil {
		return "", ErrDemoAuthenticationRequired
	}
	if err := validateDemoSessionID(sessionID); err != nil {
		return "", err
	}

	// A session identifier is browser-scoped, not an authorization boundary.
	// Reuse only a clone owned by the initiating authenticated user.
	existing, err := s.universeRepo.FindByUserAndSessionID(ctx, userID, sessionID)
	if err != nil {
		return "", fmt.Errorf("find existing demo universe: %w", err)
	}
	if existing != nil {
		return existing.ID.String(), nil
	}

	newID := uuid.NewString()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	committed := false
	defer func() {
		_ = tx.Rollback(ctx)
		if !committed && s.graphRepo != nil {
			if err := s.graphRepo.DropGraph(ctx, "universe_"+newID); err != nil {
				log.Printf("[demo] cleanup failed clone graph %s: %v", newID, err)
			}
		}
	}()

	// Get template universe
	templateID := ""
	err = tx.QueryRow(ctx, `SELECT id FROM universes WHERE is_demo_template = TRUE LIMIT 1`).Scan(&templateID)
	if err != nil {
		return "", fmt.Errorf("no demo template found: %w", err)
	}

	// Clone the universe
	_, err = tx.Exec(ctx, `
		INSERT INTO universes (id, user_id, name, description, genre_tags, session_id, is_demo_template, created_at, updated_at)
		SELECT $1, $2, name, description, genre_tags, $3, FALSE, NOW(), NOW()
		FROM universes WHERE id = $4
	`, newID, userID, sessionID, templateID)
	if err != nil {
		return "", fmt.Errorf("clone universe: %w", err)
	}

	// ── Deep-copy all dependent tables ──

	workMap := make(map[string]string)    // oldWorkID → newWorkID
	chapterMap := make(map[string]string) // oldChapterID → newChapterID
	entityMap := make(map[string]string)  // oldEntityID → newEntityID

	// 1. Works
	workRows, err := tx.Query(ctx, `SELECT id, title, type, order_index, synopsis, status FROM works WHERE universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template works: %w", err)
	}
	var works []struct {
		oldID, title, wtype, synopsis, status string
		orderIdx                              int
	}
	for workRows.Next() {
		var item struct {
			oldID, title, wtype, synopsis, status string
			orderIdx                              int
		}
		if err := workRows.Scan(&item.oldID, &item.title, &item.wtype, &item.orderIdx, &item.synopsis, &item.status); err != nil {
			workRows.Close()
			return "", fmt.Errorf("scan work: %w", err)
		}
		works = append(works, item)
	}
	workRows.Close()
	if err := workRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template works: %w", err)
	}
	for _, item := range works {
		nid := uuid.New().String()
		workMap[item.oldID] = nid
		_, err = tx.Exec(ctx, `
			INSERT INTO works (id, universe_id, title, type, order_index, synopsis, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
			nid, newID, item.title, item.wtype, item.orderIdx, item.synopsis, item.status)
		if err != nil {
			return "", fmt.Errorf("insert work: %w", err)
		}
	}

	// 2. Chapters
	chapterRows, err := tx.Query(ctx, `
		SELECT c.id, c.work_id, c.title, c.order_index, c.content, c.raw_text, c.word_count, c.status
		FROM chapters c JOIN works w ON c.work_id = w.id
		WHERE w.universe_id = $1 ORDER BY c.order_index`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template chapters: %w", err)
	}
	var chapters []struct {
		oldID, oldWorkID, title, content, rawText, status string
		orderIdx, wordCount                               int
	}
	for chapterRows.Next() {
		var item struct {
			oldID, oldWorkID, title, content, rawText, status string
			orderIdx, wordCount                               int
		}
		if err := chapterRows.Scan(&item.oldID, &item.oldWorkID, &item.title, &item.orderIdx, &item.content, &item.rawText, &item.wordCount, &item.status); err != nil {
			chapterRows.Close()
			return "", fmt.Errorf("scan chapter: %w", err)
		}
		chapters = append(chapters, item)
	}
	chapterRows.Close()
	if err := chapterRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template chapters: %w", err)
	}
	for _, item := range chapters {
		nid := uuid.New().String()
		chapterMap[item.oldID] = nid
		newWorkID := workMap[item.oldWorkID]
		_, err = tx.Exec(ctx, `
			INSERT INTO chapters (id, work_id, title, order_index, content, raw_text, word_count, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
			nid, newWorkID, item.title, item.orderIdx, item.content, item.rawText, item.wordCount, item.status)
		if err != nil {
			return "", fmt.Errorf("insert chapter: %w", err)
		}
	}

	// 3. Entities
	entityRows, err := tx.Query(ctx, `
		SELECT id, type, name, aliases, description, properties, status, relevance_score, last_mentioned_chapter_id
		FROM entities WHERE universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template entities: %w", err)
	}
	var entities []struct {
		oldID, etype, name, desc, status string
		aliases                          []string
		props                            []byte
		relevance                        float64
		lastChapterID                    *string
	}
	for entityRows.Next() {
		var item struct {
			oldID, etype, name, desc, status string
			aliases                          []string
			props                            []byte
			relevance                        float64
			lastChapterID                    *string
		}
		if err := entityRows.Scan(&item.oldID, &item.etype, &item.name, &item.aliases, &item.desc, &item.props, &item.status, &item.relevance, &item.lastChapterID); err != nil {
			entityRows.Close()
			return "", fmt.Errorf("scan entity: %w", err)
		}
		entities = append(entities, item)
	}
	entityRows.Close()
	if err := entityRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template entities: %w", err)
	}
	for _, item := range entities {
		nid := uuid.New().String()
		entityMap[item.oldID] = nid

		var newLastChapterID *string
		if item.lastChapterID != nil {
			remapped := chapterMap[*item.lastChapterID]
			newLastChapterID = &remapped
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO entities (id, universe_id, type, name, aliases, description, properties, status, relevance_score, last_mentioned_chapter_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
			nid, newID, item.etype, item.name, item.aliases, item.desc, item.props, item.status, item.relevance, newLastChapterID)
		if err != nil {
			return "", fmt.Errorf("insert entity: %w", err)
		}
	}

	// 4. Entity mentions
	mentionRows, err := tx.Query(ctx, `
		SELECT em.id, em.entity_id, em.chapter_id, em.paragraph_index, em.paragraph_node_id, em.context_snippet, em.mention_type
		FROM entity_mentions em JOIN entities e ON em.entity_id = e.id
		WHERE e.universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template mentions: %w", err)
	}
	var mentions []struct {
		oldID, oldEntityID, oldChapterID, snippet, mtype string
		nodeID                                           *string
		pIdx                                             int
	}
	for mentionRows.Next() {
		var item struct {
			oldID, oldEntityID, oldChapterID, snippet, mtype string
			nodeID                                           *string
			pIdx                                             int
		}
		if err := mentionRows.Scan(&item.oldID, &item.oldEntityID, &item.oldChapterID, &item.pIdx, &item.nodeID, &item.snippet, &item.mtype); err != nil {
			mentionRows.Close()
			return "", fmt.Errorf("scan mention: %w", err)
		}
		mentions = append(mentions, item)
	}
	mentionRows.Close()
	if err := mentionRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template mentions: %w", err)
	}
	for _, item := range mentions {
		newEntityID := entityMap[item.oldEntityID]
		newChapterID := chapterMap[item.oldChapterID]
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_mentions (id, entity_id, chapter_id, paragraph_index, paragraph_node_id, context_snippet, mention_type, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			uuid.New().String(), newEntityID, newChapterID, item.pIdx, item.nodeID, item.snippet, item.mtype)
		if err != nil {
			return "", fmt.Errorf("insert mention: %w", err)
		}
	}

	// 5. Entity embeddings (copy vector verbatim)
	embRows, err := tx.Query(ctx, `
		SELECT ee.id, ee.entity_id, ee.description_embedding
		FROM entity_embeddings ee JOIN entities e ON ee.entity_id = e.id
		WHERE e.universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template entity embeddings: %w", err)
	}
	var entityEmbeddings []struct {
		oldID, oldEntityID string
		embedding          []float32
	}
	for embRows.Next() {
		var item struct {
			oldID, oldEntityID string
			embedding          []float32
		}
		var vec pgvector.Vector
		if err := embRows.Scan(&item.oldID, &item.oldEntityID, &vec); err != nil {
			embRows.Close()
			return "", fmt.Errorf("scan entity embedding: %w", err)
		}
		item.embedding = vec.Slice()
		entityEmbeddings = append(entityEmbeddings, item)
	}
	embRows.Close()
	if err := embRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template entity embeddings: %w", err)
	}
	for _, item := range entityEmbeddings {
		newEntityID := entityMap[item.oldEntityID]
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_embeddings (id, entity_id, description_embedding, created_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW())`,
			uuid.New().String(), newEntityID, pgvector.NewVector(item.embedding))
		if err != nil {
			return "", fmt.Errorf("insert entity embedding: %w", err)
		}
	}

	// 6. Paragraph embeddings (copy vector verbatim)
	paraRows, err := tx.Query(ctx, `
		SELECT pe.id, pe.chapter_id, pe.paragraph_index, pe.paragraph_node_id, pe.content, pe.embedding
		FROM paragraph_embeddings pe JOIN chapters c ON pe.chapter_id = c.id
		JOIN works w ON c.work_id = w.id
		WHERE w.universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template paragraph embeddings: %w", err)
	}
	var paraEmbeddings []struct {
		oldID, oldChapterID, nodeID, content string
		pIdx                                 int
		embedding                            []float32
	}
	for paraRows.Next() {
		var item struct {
			oldID, oldChapterID, nodeID, content string
			pIdx                                 int
			embedding                            []float32
		}
		var vec pgvector.Vector
		if err := paraRows.Scan(&item.oldID, &item.oldChapterID, &item.pIdx, &item.nodeID, &item.content, &vec); err != nil {
			paraRows.Close()
			return "", fmt.Errorf("scan paragraph embedding: %w", err)
		}
		item.embedding = vec.Slice()
		paraEmbeddings = append(paraEmbeddings, item)
	}
	paraRows.Close()
	if err := paraRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template paragraph embeddings: %w", err)
	}
	for _, item := range paraEmbeddings {
		newChapterID := chapterMap[item.oldChapterID]
		_, err = tx.Exec(ctx, `
			INSERT INTO paragraph_embeddings (id, chapter_id, paragraph_index, paragraph_node_id, content, embedding, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
			uuid.New().String(), newChapterID, item.pIdx, item.nodeID, item.content, pgvector.NewVector(item.embedding))
		if err != nil {
			return "", fmt.Errorf("insert paragraph embedding: %w", err)
		}
	}

	// 7. Contradictions
	contraRows, err := tx.Query(ctx, `
		SELECT id, entity_id, severity, description, suggestion,
		       evidence_a, evidence_a_chapter_id, evidence_b, evidence_b_chapter_id, fingerprint, status
		FROM contradictions WHERE universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template contradictions: %w", err)
	}
	var contradictions []struct {
		oldID, severity, desc, suggestion, evidenceA, evidenceB, fingerprint, status string
		oldEntityID, evAChID, evBChID                                                *string
	}
	for contraRows.Next() {
		var item struct {
			oldID, severity, desc, suggestion, evidenceA, evidenceB, fingerprint, status string
			oldEntityID, evAChID, evBChID                                                *string
		}
		if err := contraRows.Scan(&item.oldID, &item.oldEntityID, &item.severity, &item.desc, &item.suggestion,
			&item.evidenceA, &item.evAChID, &item.evidenceB, &item.evBChID, &item.fingerprint, &item.status); err != nil {
			contraRows.Close()
			return "", fmt.Errorf("scan contradiction: %w", err)
		}
		contradictions = append(contradictions, item)
	}
	contraRows.Close()
	if err := contraRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template contradictions: %w", err)
	}
	for _, item := range contradictions {
		var newEntityID, newEvAChID, newEvBChID *string
		if item.oldEntityID != nil {
			remapped := entityMap[*item.oldEntityID]
			newEntityID = &remapped
		}
		if item.evAChID != nil {
			remapped := chapterMap[*item.evAChID]
			newEvAChID = &remapped
		}
		if item.evBChID != nil {
			remapped := chapterMap[*item.evBChID]
			newEvBChID = &remapped
		}

		// fingerprint carries a table-wide UNIQUE constraint; copying it verbatim
		// collides with the template's own row. Suffix with newID (unique per
		// clone) so the insert satisfies the constraint — same remap spirit as
		// the FK maps above, applied to a unique text column instead of an ID.
		// ponytail: string-suffix workaround, not a fingerprint-scheme redesign —
		// revisit if fingerprint dedup semantics ever need to span clones.
		newFingerprint := item.fingerprint
		if newFingerprint != "" {
			newFingerprint = newFingerprint + ":" + newID
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO contradictions (id, universe_id, entity_id, severity, description, suggestion,
			       evidence_a, evidence_a_chapter_id, evidence_b, evidence_b_chapter_id, fingerprint, status, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
			uuid.New().String(), newID, newEntityID, item.severity, item.desc, item.suggestion,
			item.evidenceA, newEvAChID, item.evidenceB, newEvBChID, newFingerprint, item.status)
		if err != nil {
			return "", fmt.Errorf("insert contradiction: %w", err)
		}
	}

	// 8. Timeline events
	tlRows, err := tx.Query(ctx, `
		SELECT id, event_entity_id, title, description, timeline_position, timeline_label,
		       chapter_id, participants
		FROM timeline_events WHERE universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template timeline events: %w", err)
	}
	var timelineEvents []struct {
		oldID, title, desc, label      string
		oldEventEntityID, oldChapterID *string
		tlPos                          *float64
		participants                   []string
	}
	for tlRows.Next() {
		var item struct {
			oldID, title, desc, label      string
			oldEventEntityID, oldChapterID *string
			tlPos                          *float64
			participants                   []string
		}
		if err := tlRows.Scan(&item.oldID, &item.oldEventEntityID, &item.title, &item.desc, &item.tlPos, &item.label, &item.oldChapterID, &item.participants); err != nil {
			tlRows.Close()
			return "", fmt.Errorf("scan timeline event: %w", err)
		}
		timelineEvents = append(timelineEvents, item)
	}
	tlRows.Close()
	if err := tlRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template timeline events: %w", err)
	}
	for _, item := range timelineEvents {
		var newEventEntityID, newChapterID *string
		if item.oldEventEntityID != nil {
			remapped := entityMap[*item.oldEventEntityID]
			newEventEntityID = &remapped
		}
		if item.oldChapterID != nil {
			remapped := chapterMap[*item.oldChapterID]
			newChapterID = &remapped
		}
		newParticipants := remapUUIDs(item.participants, entityMap)

		_, err = tx.Exec(ctx, `
			INSERT INTO timeline_events (id, universe_id, event_entity_id, title, description,
			       timeline_position, timeline_label, chapter_id, participants, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
			uuid.New().String(), newID, newEventEntityID, item.title, item.desc, item.tlPos, item.label, newChapterID, newParticipants)
		if err != nil {
			return "", fmt.Errorf("insert timeline event: %w", err)
		}
	}

	// 9. Plot holes
	phRows, err := tx.Query(ctx, `
		SELECT id, title, description, related_entity_ids, first_mentioned_chapter_id, status
		FROM plot_holes WHERE universe_id = $1`, templateID)
	if err != nil {
		return "", fmt.Errorf("query template plot holes: %w", err)
	}
	var plotHoles []struct {
		oldID, title, desc, status string
		relatedIDs                 []string
		firstChID                  *string
	}
	for phRows.Next() {
		var item struct {
			oldID, title, desc, status string
			relatedIDs                 []string
			firstChID                  *string
		}
		if err := phRows.Scan(&item.oldID, &item.title, &item.desc, &item.relatedIDs, &item.firstChID, &item.status); err != nil {
			phRows.Close()
			return "", fmt.Errorf("scan plot hole: %w", err)
		}
		plotHoles = append(plotHoles, item)
	}
	phRows.Close()
	if err := phRows.Err(); err != nil {
		return "", fmt.Errorf("iterate template plot holes: %w", err)
	}
	for _, item := range plotHoles {
		var newFirstChID *string
		if item.firstChID != nil {
			remapped := chapterMap[*item.firstChID]
			newFirstChID = &remapped
		}
		newRelatedIDs := remapUUIDs(item.relatedIDs, entityMap)

		_, err = tx.Exec(ctx, `
			INSERT INTO plot_holes (id, universe_id, title, description, related_entity_ids, first_mentioned_chapter_id, status, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			uuid.New().String(), newID, item.title, item.desc, newRelatedIDs, newFirstChID, item.status)
		if err != nil {
			return "", fmt.Errorf("insert plot hole: %w", err)
		}
	}

	// 10. AGE Graph clone
	skipped, err := s.cloneGraph(ctx, tx, templateID, newID, entityMap)
	if err != nil {
		return "", fmt.Errorf("clone graph: %w", err)
	}
	if skipped > 0 {
		log.Printf("[demo] cloneGraph skipped %d unmapped edges (template drift)", skipped)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	committed = true

	return newID, nil
}

// ResetUniverse creates a replacement clone before retiring the old one. The
// old universe remains usable if the deep copy or AGE graph clone fails.
func (s *DemoService) ResetUniverse(ctx context.Context, userID uuid.UUID, sessionID string) (string, error) {
	if userID == uuid.Nil {
		return "", ErrDemoAuthenticationRequired
	}
	if err := validateDemoSessionID(sessionID); err != nil {
		return "", err
	}

	u, err := s.universeRepo.FindByUserAndSessionID(ctx, userID, sessionID)
	if err != nil {
		return "", fmt.Errorf("find demo universe for reset: %w", err)
	}
	if u == nil {
		return "", ErrDemoUniverseNotFound
	}

	// Clone under a temporary, opaque session ID so CloneUniverse's idempotency
	// check cannot return the still-live old clone. If this fails, no mutation
	// has been made to the old universe or its graph.
	replacementSessionID := uuid.NewString()
	replacementID, err := s.CloneUniverse(ctx, userID, replacementSessionID)
	if err != nil {
		return "", fmt.Errorf("clone replacement demo universe: %w", err)
	}
	replacementUUID, err := uuid.Parse(replacementID)
	if err != nil {
		return "", fmt.Errorf("parse replacement universe ID: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.discardDemoClone(ctx, userID, replacementUUID)
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	abortReplacement := func() {
		_ = tx.Rollback(ctx)
		s.discardDemoClone(ctx, userID, replacementUUID)
	}

	// Lock the current owner/session row before replacement. A concurrent reset
	// then observes that the old row is gone and cleans up only its own temp
	// clone, never another visitor's universe.
	var oldID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM universes
		WHERE id = $1 AND user_id = $2 AND session_id = $3
		FOR UPDATE`, u.ID, userID, sessionID).Scan(&oldID)
	if err != nil {
		abortReplacement()
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrDemoUniverseNotFound
		}
		return "", fmt.Errorf("lock demo universe for reset: %w", err)
	}

	result, err := tx.Exec(ctx, `
		UPDATE universes
		SET session_id = $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3 AND session_id = $4`,
		sessionID, replacementUUID, userID, replacementSessionID)
	if err != nil {
		abortReplacement()
		return "", fmt.Errorf("activate replacement demo universe: %w", err)
	}
	if result.RowsAffected() != 1 {
		abortReplacement()
		return "", ErrDemoUniverseNotFound
	}

	// The replacement is complete before the old clone is removed. Cascades
	// clean its relational data; its AGE graph is dropped after commit.
	result, err = tx.Exec(ctx, `DELETE FROM universes WHERE id = $1 AND user_id = $2 AND session_id = $3`, oldID, userID, sessionID)
	if err != nil {
		abortReplacement()
		return "", fmt.Errorf("delete universe: %w", err)
	}
	if result.RowsAffected() != 1 {
		abortReplacement()
		return "", ErrDemoUniverseNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}

	if s.graphRepo != nil {
		if err := s.graphRepo.DropGraph(ctx, "universe_"+oldID.String()); err != nil {
			// The replacement is durable and owner-scoped. Keep reset successful
			// while surfacing an operational cleanup failure for follow-up.
			log.Printf("[demo] cleanup obsolete graph %s: %v", oldID, err)
		}
	}

	return replacementID, nil
}

// ── Helpers ──

func validateDemoSessionID(sessionID string) error {
	if sessionID == "" {
		return ErrDemoSessionRequired
	}
	parsed, err := uuid.Parse(sessionID)
	if err != nil || parsed == uuid.Nil {
		return ErrDemoSessionInvalid
	}
	return nil
}

func (s *DemoService) discardDemoClone(ctx context.Context, userID, universeID uuid.UUID) {
	result, err := s.pool.Exec(ctx, `DELETE FROM universes WHERE id = $1 AND user_id = $2`, universeID, userID)
	if err != nil {
		log.Printf("[demo] cleanup replacement universe %s: %v", universeID, err)
		return
	}
	if result.RowsAffected() != 1 {
		log.Printf("[demo] cleanup replacement universe %s: row not found", universeID)
		return
	}
	if s.graphRepo != nil {
		if err := s.graphRepo.DropGraph(ctx, "universe_"+universeID.String()); err != nil {
			log.Printf("[demo] cleanup replacement graph %s: %v", universeID, err)
		}
	}
}

// remapUUIDs replaces each UUID in ids using the given mapping.
func remapUUIDs(ids []string, m map[string]string) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = m[id]
	}
	return out
}

// cloneGraph copies all vertices and edges from the template universe's AGE graph
// into a new graph for the cloned universe, remapping entity_ids.
func (s *DemoService) cloneGraph(ctx context.Context, tx pgx.Tx, templateID, newID string, entityMap map[string]string) (int, error) {
	// 1. Create the new graph
	if err := s.graphRepo.CreateGraphTx(ctx, tx, newID); err != nil {
		return 0, fmt.Errorf("create graph: %w", err)
	}
	newGraphName := "universe_" + newID

	// 2. Create nodes: derive label from entity type
	entRows, err := tx.Query(ctx, `
		SELECT id, type, name, status, relevance_score
		FROM entities WHERE universe_id = $1`, templateID)
	if err != nil {
		return 0, fmt.Errorf("query entities for graph nodes: %w", err)
	}
	var graphNodes []struct {
		oldID, etype, name, status string
		relevance                  float64
	}
	for entRows.Next() {
		var item struct {
			oldID, etype, name, status string
			relevance                  float64
		}
		if err := entRows.Scan(&item.oldID, &item.etype, &item.name, &item.status, &item.relevance); err != nil {
			entRows.Close()
			return 0, fmt.Errorf("scan entity for node: %w", err)
		}
		graphNodes = append(graphNodes, item)
	}
	entRows.Close()
	if err := entRows.Err(); err != nil {
		return 0, fmt.Errorf("iterate entities for graph nodes: %w", err)
	}
	for _, item := range graphNodes {
		newEntityID := entityMap[item.oldID]
		props := map[string]interface{}{
			"entity_id":       newEntityID,
			"name":            item.name,
			"status":          item.status,
			"relevance_score": item.relevance,
		}
		// ponytail: use entity type as graph node label directly
		if err := s.graphRepo.CreateNodeTx(ctx, tx, newGraphName, item.etype, props); err != nil {
			return 0, fmt.Errorf("create node %s: %w", newEntityID, err)
		}
	}

	// 3. Create edges: query template graph for all relationships
	templateGraphName := "universe_" + templateID
	tmplEdges, err := s.graphRepo.QueryTemplateEdgesTx(ctx, tx, templateGraphName)
	if err != nil {
		return 0, fmt.Errorf("query graph edges: %w", err)
	}
	skipped := 0
	for _, item := range tmplEdges {
		newSrcID := entityMap[item.Source]
		newTgtID := entityMap[item.Target]
		if newSrcID == "" || newTgtID == "" {
			skipped++
			continue
		}
		if err := s.graphRepo.CreateEdgeTx(ctx, tx, newGraphName, newSrcID, newTgtID, item.RelType, nil); err != nil {
			return 0, fmt.Errorf("create edge %s-[%s]->%s: %w", newSrcID, item.RelType, newTgtID, err)
		}
	}

	return skipped, nil
}
