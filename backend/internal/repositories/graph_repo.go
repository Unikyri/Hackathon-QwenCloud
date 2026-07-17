package repositories

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/quill/backend/internal/models"
)

// identifierRe matches a valid bare Cypher identifier (label or relType).
// relType/label values are interpolated directly into Cypher strings (they
// cannot be parameterized or quoted like string-literal values), so anything
// not matching this shape is rejected outright rather than escaped.
var identifierRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ErrInvalidIdentifier is returned when a relType or label is not a valid
// bare Cypher identifier — see validCypherIdentifier.
var ErrInvalidIdentifier = errors.New("invalid cypher identifier")

// validCypherIdentifier rejects (never sanitizes) relType/label values that
// aren't safe to interpolate as a bare Cypher identifier.
func validCypherIdentifier(s string) error {
	if !identifierRe.MatchString(s) {
		return fmt.Errorf("%w: %q", ErrInvalidIdentifier, s)
	}
	return nil
}

// GraphNode represents a node returned from graph queries.
type GraphNode struct {
	ID         string                 `json:"id"`
	Labels     []string               `json:"labels"`
	Properties map[string]interface{} `json:"properties"`
}

// GraphEdge represents an edge returned from graph queries.
type GraphEdge struct {
	ID         string                 `json:"id"`
	Source     string                 `json:"source"`
	Target     string                 `json:"target"`
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
}

// The relationship-map endpoint is intentionally a focused, bounded
// neighborhood rather than an all-universe visualization. These limits keep
// the two-hop traversal and fCoSE renderer within a predictable budget.
const (
	GraphTraversalMaxHops     = 2
	GraphTraversalNodeLimit   = 96
	GraphTraversalEdgeLimit   = 160
	GraphTraversalResultLimit = 256
)

// GraphTraversalLimits describes the applied server-side limits returned with
// every neighborhood response. Hops is the normalized value actually used.
type GraphTraversalLimits struct {
	Hops        int `json:"hops"`
	MaxHops     int `json:"max_hops"`
	NodeLimit   int `json:"node_limit"`
	EdgeLimit   int `json:"edge_limit"`
	ResultLimit int `json:"result_limit"`
}

// GraphTraversalResult is the bounded response for the relationship map.
// Truncated means at least one configured server-side budget prevented the
// response from representing the whole requested neighborhood.
type GraphTraversalResult struct {
	Nodes     []GraphNode          `json:"nodes"`
	Edges     []GraphEdge          `json:"edges"`
	Truncated bool                 `json:"truncated"`
	Limits    GraphTraversalLimits `json:"limits"`
}

// NormalizeGraphTraversalHops confines public traversal depth to one or two
// hops. It is deliberately shared by the handler and repository so request
// values never reach an AGE variable-length path expression.
func NormalizeGraphTraversalHops(hops int) int {
	if hops < 1 {
		return 1
	}
	if hops > GraphTraversalMaxHops {
		return GraphTraversalMaxHops
	}
	return hops
}

// NewGraphTraversalResult creates an empty, but fully-described, bounded
// traversal response. Missing graph data must not make clients guess whether
// the map was complete or merely unavailable.
func NewGraphTraversalResult(hops int) GraphTraversalResult {
	return GraphTraversalResult{
		Nodes: []GraphNode{},
		Edges: []GraphEdge{},
		Limits: GraphTraversalLimits{
			Hops:        NormalizeGraphTraversalHops(hops),
			MaxHops:     GraphTraversalMaxHops,
			NodeLimit:   GraphTraversalNodeLimit,
			EdgeLimit:   GraphTraversalEdgeLimit,
			ResultLimit: GraphTraversalResultLimit,
		},
	}
}

// TemplateEdge is a lightweight (source, relType, target) edge tuple used
// when cloning a template graph's edges (see QueryTemplateEdgesTx).
type TemplateEdge struct {
	Source  string
	RelType string
	Target  string
}

type GraphRepo struct {
	pool *pgxpool.Pool
}

func NewGraphRepo(pool *pgxpool.Pool) *GraphRepo {
	return &GraphRepo{pool: pool}
}

// quoteGraph quotes a graph name for inline interpolation in cypher() calls.
// AGE's cypher() expects `name` type arg; pgx `$1` sends `text` → overload miss.
// Graph names are always "universe_" + UUID (internal), no injection risk.
func quoteGraph(name string) string {
	return fmt.Sprintf("'%s'", strings.ReplaceAll(name, "'", "''"))
}

// escapeCypherString escapes single quotes and backslashes for safe
// interpolation into AGE Cypher query strings. AGE's cypher() function
// doesn't support parameterized queries inside $$ blocks, so string
// escaping is the only option.
//
// ponytail: backslash first, then quote — avoids double-escaping.
func escapeCypherString(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "'", "\\'")
	return s
}

// withAgeTx loads AGE + sets search_path on a transaction's connection,
// then runs fn, restoring the original search_path afterward. Avoids
// pool.Acquire inside a transaction — prevents deadlock when pool is
// saturated by concurrent requests, and avoids search_path poisoning (AGE's
// ag_catalog has internal tables named "entities" that shadow the public
// schema if search_path is left pointing at ag_catalog first).
func (r *GraphRepo) withAgeTx(tx pgx.Tx, fn func(conn *pgx.Conn) error) error {
	c := tx.Conn()
	ctx := context.Background()
	if _, err := c.Exec(ctx, "LOAD 'age'"); err != nil {
		return fmt.Errorf("load age: %w", err)
	}

	var prev string
	if err := c.QueryRow(ctx, "SHOW search_path").Scan(&prev); err != nil {
		return fmt.Errorf("capture search_path: %w", err)
	}
	if _, err := c.Exec(ctx, `SET search_path = ag_catalog, "$user", public`); err != nil {
		return fmt.Errorf("set search_path: %w", err)
	}

	err := fn(c)
	if _, rerr := c.Exec(ctx, `SELECT set_config('search_path', $1, false)`, prev); rerr != nil && err == nil {
		err = fmt.Errorf("restore search_path: %w", rerr)
	}
	return err
}

// withAgeConn acquires a dedicated connection, loads AGE + sets search_path,
// runs fn, restores search_path, then releases. This ensures AGE is available
// regardless of pool state, and avoids search_path poisoning of the pool
// (AGE's ag_catalog has internal tables named "entities" that shadow the
// public schema). AfterConnect in pgxpool doesn't reliably persist LOAD
// across all connections.
func (r *GraphRepo) withAgeConn(ctx context.Context, fn func(conn *pgx.Conn) error) error {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire conn: %w", err)
	}
	c := conn.Conn()
	if _, err := c.Exec(ctx, "LOAD 'age'"); err != nil {
		conn.Release()
		return fmt.Errorf("load age: %w", err)
	}

	var prev string
	if err := c.QueryRow(ctx, "SHOW search_path").Scan(&prev); err != nil {
		conn.Release()
		return fmt.Errorf("capture search_path: %w", err)
	}
	if _, err := c.Exec(ctx, `SET search_path = ag_catalog, "$user", public`); err != nil {
		conn.Release()
		return fmt.Errorf("set search_path: %w", err)
	}

	err = fn(c)
	// The traversal request may have timed out. Restore the pooled connection
	// with a fresh, bounded context rather than the expired request context so
	// ag_catalog never leaks into the next borrower.
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, rerr := c.Exec(cleanupCtx, `SELECT set_config('search_path', $1, false)`, prev); rerr != nil && err == nil {
		err = fmt.Errorf("restore search_path: %w", rerr)
	}
	conn.Release()
	return err
}

func (r *GraphRepo) CreateGraph(ctx context.Context, universeID string) error {
	graphName := "universe_" + universeID
	return r.withAgeConn(ctx, func(c *pgx.Conn) error {
		// AGE requires create_graph() before running Cypher against the graph.
		_, err := c.Exec(ctx, fmt.Sprintf(`SELECT create_graph('%s')`, graphName))
		return err
	})
}

func (r *GraphRepo) CreateNode(ctx context.Context, graphName, label string, properties map[string]interface{}) error {
	if err := validCypherIdentifier(label); err != nil {
		return err
	}
	return r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ CREATE (n:%s {entity_id: '%s', name: '%s', status: '%s', relevance_score: %v}) RETURN n $$) AS (n agtype)`,
			quoteGraph(graphName), label,
			escapeCypherString(fmt.Sprint(properties["entity_id"])),
			escapeCypherString(fmt.Sprint(properties["name"])),
			escapeCypherString(fmt.Sprint(properties["status"])),
			properties["relevance_score"])
		_, err := c.Exec(ctx, query)
		return err
	})
}

func (r *GraphRepo) CreateEdge(ctx context.Context, graphName, sourceEntityID, targetEntityID, relType string, properties map[string]interface{}) error {
	if err := validCypherIdentifier(relType); err != nil {
		return err
	}
	return r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (x {entity_id: '%s'}), (y {entity_id: '%s'}) CREATE (x)-[:%s]->(y) $$) AS (r agtype)`,
			quoteGraph(graphName),
			escapeCypherString(sourceEntityID),
			escapeCypherString(targetEntityID),
			relType)
		_, err := c.Exec(ctx, query)
		return err
	})
}

// Tx variants: use the transaction's connection instead of acquiring from pool.
// ponytail: identical cypher bodies to non-Tx originals, just different conn source.

func (r *GraphRepo) CreateGraphTx(ctx context.Context, tx pgx.Tx, universeID string) error {
	graphName := "universe_" + universeID
	return r.withAgeTx(tx, func(c *pgx.Conn) error {
		// AGE requires create_graph() before running Cypher against the graph
		// (same requirement as the non-Tx CreateGraph above).
		if _, err := c.Exec(ctx, fmt.Sprintf(`SELECT create_graph('%s')`, graphName)); err != nil {
			return err
		}
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ CREATE (g:Graph {name: '%s'}) RETURN g $$) AS (g agtype)`,
			quoteGraph(graphName), graphName)
		_, err := c.Exec(ctx, query)
		return err
	})
}

func (r *GraphRepo) CreateNodeTx(ctx context.Context, tx pgx.Tx, graphName, label string, properties map[string]interface{}) error {
	if err := validCypherIdentifier(label); err != nil {
		return err
	}
	return r.withAgeTx(tx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ CREATE (n:%s {entity_id: '%s', name: '%s', status: '%s', relevance_score: %v}) RETURN n $$) AS (n agtype)`,
			quoteGraph(graphName), label,
			escapeCypherString(fmt.Sprint(properties["entity_id"])),
			escapeCypherString(fmt.Sprint(properties["name"])),
			escapeCypherString(fmt.Sprint(properties["status"])),
			properties["relevance_score"])
		_, err := c.Exec(ctx, query)
		return err
	})
}

// QueryTemplateEdgesTx returns all (source, relType, target) edges in
// graphName, run inside the transaction's connection via withAgeTx (loads
// AGE, captures + restores search_path — no raw LOAD/SET string left
// dangling on the pooled connection).
func (r *GraphRepo) QueryTemplateEdgesTx(ctx context.Context, tx pgx.Tx, graphName string) ([]TemplateEdge, error) {
	var edges []TemplateEdge
	err := r.withAgeTx(tx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (a)-[r]->(b) WHERE a.entity_id IS NOT NULL AND b.entity_id IS NOT NULL RETURN a.entity_id, type(r), b.entity_id $$) AS (src agtype, rel agtype, tgt agtype)`,
			quoteGraph(graphName))
		rows, err := c.Query(ctx, query)
		if err != nil {
			return fmt.Errorf("query template edges: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var srcRaw, relRaw, tgtRaw *string
			if err := rows.Scan(&srcRaw, &relRaw, &tgtRaw); err != nil {
				return fmt.Errorf("scan template edge: %w", err)
			}
			if srcRaw == nil || relRaw == nil || tgtRaw == nil {
				continue
			}
			src := strings.Trim(*srcRaw, `"`)
			rel := strings.Trim(*relRaw, `"`)
			tgt := strings.Trim(*tgtRaw, `"`)
			if src == "" || rel == "" || tgt == "" {
				continue
			}
			edges = append(edges, TemplateEdge{Source: src, RelType: rel, Target: tgt})
		}
		return rows.Err()
	})
	return edges, err
}

func (r *GraphRepo) CreateEdgeTx(ctx context.Context, tx pgx.Tx, graphName, sourceEntityID, targetEntityID, relType string, properties map[string]interface{}) error {
	if err := validCypherIdentifier(relType); err != nil {
		return err
	}
	return r.withAgeTx(tx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (x {entity_id: '%s'}), (y {entity_id: '%s'}) CREATE (x)-[:%s]->(y) $$) AS (r agtype)`,
			quoteGraph(graphName),
			escapeCypherString(sourceEntityID),
			escapeCypherString(targetEntityID),
			relType)
		_, err := c.Exec(ctx, query)
		return err
	})
}

func (r *GraphRepo) UpdateNodeRelevance(ctx context.Context, graphName, entityID string, score float64) error {
	return r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n {entity_id: '%s'}) SET n.relevance_score = %v RETURN n $$) AS (n agtype)`,
			quoteGraph(graphName), escapeCypherString(entityID), score)
		_, err := c.Exec(ctx, query)
		return err
	})
}

func (r *GraphRepo) GetNeighbors(ctx context.Context, graphName, entityID string) ([]models.GraphNeighbor, error) {
	var neighbors []models.GraphNeighbor
	err := r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n {entity_id: '%s'})-[r]-(m) RETURN type(r) AS rel_type, properties(r) AS rel_props, m $$) AS (rel_type agtype, rel_props agtype, m agtype)`,
			quoteGraph(graphName), escapeCypherString(entityID))
		rows, err := c.Query(ctx, query)
		if err != nil {
			return fmt.Errorf("get neighbors: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var n models.GraphNeighbor
			if err := rows.Scan(&n.RelType, &n.RelProps, &n.Node); err != nil {
				return fmt.Errorf("scan neighbor: %w", err)
			}
			n.RelType = graphRelationshipType(&n.RelType)
			neighbors = append(neighbors, n)
		}
		return nil
	})
	return neighbors, err
}

// GetNeighborsBatch resolves 1-hop neighbors for ALL given seed entity IDs in
// a single Cypher call (spec: "Graph Pipeline Uses Batched Neighbor Lookup"),
// instead of issuing one GetNeighbors call per seed. Matches n.entity_id
// against the seed list via a Cypher IN clause, keeping the seed's entity_id
// in the RETURN so rows can be grouped back into a per-seed map.
func (r *GraphRepo) GetNeighborsBatch(ctx context.Context, graphName string, entityIDs []string) (map[string][]models.GraphNeighbor, error) {
	result := make(map[string][]models.GraphNeighbor)
	if len(entityIDs) == 0 {
		return result, nil
	}

	quoted := make([]string, len(entityIDs))
	for i, id := range entityIDs {
		quoted[i] = fmt.Sprintf("'%s'", escapeCypherString(id))
	}
	idList := strings.Join(quoted, ", ")

	err := r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n)-[r]-(m) WHERE n.entity_id IN [%s] RETURN n.entity_id AS seed_id, type(r) AS rel_type, properties(r) AS rel_props, m $$) AS (seed_id agtype, rel_type agtype, rel_props agtype, m agtype)`,
			quoteGraph(graphName), idList)
		rows, err := c.Query(ctx, query)
		if err != nil {
			return fmt.Errorf("get neighbors batch: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var seedID string
			var n models.GraphNeighbor
			if err := rows.Scan(&seedID, &n.RelType, &n.RelProps, &n.Node); err != nil {
				return fmt.Errorf("scan neighbor batch: %w", err)
			}
			seedID = strings.Trim(seedID, `"`)
			n.RelType = graphRelationshipType(&n.RelType)
			result[seedID] = append(result[seedID], n)
		}
		return nil
	})
	return result, err
}

// FullQuery returns all nodes and edges for a universe's graph.
func (r *GraphRepo) FullQuery(ctx context.Context, graphName string) ([]GraphNode, []GraphEdge, error) {
	var nodes []GraphNode
	var edges []GraphEdge
	err := r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m, type(r) $$) AS (n agtype, r agtype, m agtype, rel_type agtype)`,
			quoteGraph(graphName))
		rows, err := c.Query(ctx, query)
		if err != nil {
			return fmt.Errorf("full query: %w", err)
		}
		defer rows.Close()
		nodes, edges, err = collectGraphRows(rows)
		return err
	})
	return nodes, edges, err
}

// DeleteEdge removes a relationship between two nodes in the graph.
func (r *GraphRepo) DeleteEdge(ctx context.Context, graphName, sourceEntityID, targetEntityID, relType string) error {
	if err := validCypherIdentifier(relType); err != nil {
		return err
	}
	return r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (x {entity_id: '%s'})-[r:%s]->(y {entity_id: '%s'}) DELETE r $$) AS (a agtype)`,
			quoteGraph(graphName), escapeCypherString(sourceEntityID), relType, escapeCypherString(targetEntityID))
		_, err := c.Exec(ctx, query)
		return err
	})
}

// NHopTraversal is retained for internal callers that only need graph
// elements. New user-facing code must call BoundedNHopTraversal so it can
// surface partial-map metadata to the client.
func (r *GraphRepo) NHopTraversal(ctx context.Context, graphName, startEntityID string, hops int) ([]GraphNode, []GraphEdge, error) {
	result, err := r.BoundedNHopTraversal(ctx, graphName, startEntityID, hops)
	return result.Nodes, result.Edges, err
}

// BoundedNHopTraversal performs a true one- or two-hop traversal without a
// variable-length path expansion. It reads direct edges first, then expands
// only the retained direct neighbors once. Each phase has a one-row lookahead
// so Truncated is true whenever the result budget clips the neighborhood.
func (r *GraphRepo) BoundedNHopTraversal(ctx context.Context, graphName, startEntityID string, hops int) (GraphTraversalResult, error) {
	result := NewGraphTraversalResult(hops)
	collector := newBoundedGraphCollector(result.Limits.NodeLimit, result.Limits.EdgeLimit)

	err := r.withAgeConn(ctx, func(c *pgx.Conn) error {
		// OPTIONAL MATCH keeps an isolated focal entity in the response while
		// avoiding a user-controlled `[*1..hops]` path expansion.
		directQuery := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n {entity_id: '%s'}) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m, type(r) LIMIT %d $$) AS (n agtype, r agtype, m agtype, rel_type agtype)`,
			quoteGraph(graphName), escapeCypherString(startEntityID), result.Limits.ResultLimit+1)
		directRows, directTruncated, err := queryGraphRows(ctx, c, directQuery, result.Limits.ResultLimit)
		if err != nil {
			return fmt.Errorf("direct graph traversal: %w", err)
		}

		collector.addRows(directRows)
		result.Truncated = directTruncated || collector.truncated
		if result.Limits.Hops == 1 || result.Truncated {
			return nil
		}

		seedIDs := retainedDirectNeighborIDs(directRows, startEntityID, collector)
		if len(seedIDs) == 0 {
			return nil
		}

		remainingResults := result.Limits.ResultLimit - len(directRows)
		// When the direct phase exactly consumes the result budget, issue a
		// one-row lookahead for the second phase. That preserves a truthful
		// truncation signal without adding unbounded work.
		secondQueryLimit := remainingResults + 1
		secondQuery := fmt.Sprintf(`SELECT * FROM cypher(%s, $$ MATCH (n)-[r]-(m) WHERE n.entity_id IN %s AND m.entity_id <> '%s' WITH DISTINCT r RETURN startNode(r), r, endNode(r), type(r) LIMIT %d $$) AS (n agtype, r agtype, m agtype, rel_type agtype)`,
			quoteGraph(graphName), cypherStringList(seedIDs), escapeCypherString(startEntityID), secondQueryLimit)
		secondRows, secondTruncated, err := queryGraphRows(ctx, c, secondQuery, remainingResults)
		if err != nil {
			return fmt.Errorf("second-hop graph traversal: %w", err)
		}

		collector.addRows(secondRows)
		result.Truncated = secondTruncated || collector.truncated
		return nil
	})

	result.Nodes, result.Edges = collector.nodesAndEdges()
	result.Truncated = result.Truncated || collector.truncated
	return result, err
}

// DropGraph drops the graph entirely (nodes, edges, and its label tables in
// ag_catalog) via ag_catalog.drop_graph with cascade. A graph that doesn't
// exist is not an error. Graph names are UUID-derived ("universe_<uuid>"),
// injection-safe by construction like the rest of this repo.
func (r *GraphRepo) DropGraph(ctx context.Context, graphName string) error {
	err := r.withAgeConn(ctx, func(c *pgx.Conn) error {
		query := fmt.Sprintf(`SELECT ag_catalog.drop_graph(%s, true)`, quoteGraph(graphName))
		_, err := c.Exec(ctx, query)
		return err
	})
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		return nil
	}
	return err
}

type graphRow struct {
	node             *string
	relationship     *string
	target           *string
	relationshipType *string
}

// queryGraphRows reads at most maxRows graph rows and consumes a one-row
// lookahead supplied by the caller's Cypher LIMIT. The bool is true only when
// a row was deliberately excluded by the result budget.
func queryGraphRows(ctx context.Context, conn *pgx.Conn, query string, maxRows int) ([]graphRow, bool, error) {
	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	graphRows := make([]graphRow, 0, maxRows)
	truncated := false
	for rows.Next() {
		var row graphRow
		if err := rows.Scan(&row.node, &row.relationship, &row.target, &row.relationshipType); err != nil {
			return nil, false, fmt.Errorf("scan graph row: %w", err)
		}
		if len(graphRows) >= maxRows {
			truncated = true
			continue
		}
		graphRows = append(graphRows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read graph rows: %w", err)
	}
	return graphRows, truncated, nil
}

type boundedGraphCollector struct {
	nodes     map[string]GraphNode
	edges     map[string]GraphEdge
	nodeLimit int
	edgeLimit int
	truncated bool
}

func newBoundedGraphCollector(nodeLimit, edgeLimit int) *boundedGraphCollector {
	return &boundedGraphCollector{
		nodes:     make(map[string]GraphNode),
		edges:     make(map[string]GraphEdge),
		nodeLimit: nodeLimit,
		edgeLimit: edgeLimit,
	}
}

func (c *boundedGraphCollector) addRows(rows []graphRow) {
	for _, row := range rows {
		c.addRow(row)
	}
}

func (c *boundedGraphCollector) addRow(row graphRow) {
	node, hasNode := graphNodeFromRaw(row.node)
	target, hasTarget := graphNodeFromRaw(row.target)
	if row.relationship == nil {
		if hasNode {
			c.addNode(node)
		}
		if hasTarget {
			c.addNode(target)
		}
		return
	}

	if !hasNode || !hasTarget {
		// A malformed AGE edge has no safe renderer endpoint. Keep any valid
		// standalone node, but do not invent source or target IDs.
		if hasNode {
			c.addNode(node)
		}
		if hasTarget {
			c.addNode(target)
		}
		return
	}

	edge := GraphEdge{
		ID:         *row.relationship,
		Source:     node.ID,
		Target:     target.ID,
		Type:       graphRelationshipType(row.relationshipType),
		Properties: map[string]interface{}{"raw": *row.relationship},
	}
	if _, exists := c.edges[edge.ID]; exists {
		return
	}
	if c.edgeLimit > 0 && len(c.edges) >= c.edgeLimit {
		c.truncated = true
		return
	}
	if !c.canAddEdgeEndpoints(node, target) {
		c.truncated = true
		return
	}

	c.nodes[node.ID] = node
	c.nodes[target.ID] = target
	c.edges[edge.ID] = edge
}

func (c *boundedGraphCollector) addNode(node GraphNode) bool {
	if _, exists := c.nodes[node.ID]; exists {
		return true
	}
	if c.nodeLimit > 0 && len(c.nodes) >= c.nodeLimit {
		c.truncated = true
		return false
	}
	c.nodes[node.ID] = node
	return true
}

func (c *boundedGraphCollector) canAddEdgeEndpoints(nodes ...GraphNode) bool {
	if c.nodeLimit == 0 {
		return true
	}
	missing := make(map[string]struct{})
	for _, node := range nodes {
		if _, exists := c.nodes[node.ID]; !exists {
			missing[node.ID] = struct{}{}
		}
	}
	return len(c.nodes)+len(missing) <= c.nodeLimit
}

func (c *boundedGraphCollector) hasNode(id string) bool {
	_, exists := c.nodes[id]
	return exists
}

func (c *boundedGraphCollector) nodesAndEdges() ([]GraphNode, []GraphEdge) {
	nodes := make([]GraphNode, 0, len(c.nodes))
	for _, node := range c.nodes {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })

	edges := make([]GraphEdge, 0, len(c.edges))
	for _, edge := range c.edges {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	return nodes, edges
}

func graphNodeFromRaw(raw *string) (GraphNode, bool) {
	if raw == nil {
		return GraphNode{}, false
	}
	id := extractProp(*raw, "entity_id")
	if id == "" {
		return GraphNode{}, false
	}
	return GraphNode{ID: id, Properties: map[string]interface{}{"raw": *raw}}, true
}

func retainedDirectNeighborIDs(rows []graphRow, focalID string, collector *boundedGraphCollector) []string {
	seedSet := make(map[string]struct{})
	for _, row := range rows {
		if row.relationship == nil {
			continue
		}
		neighbor, ok := graphNodeFromRaw(row.target)
		if !ok || neighbor.ID == focalID || !collector.hasNode(neighbor.ID) {
			continue
		}
		seedSet[neighbor.ID] = struct{}{}
	}

	seedIDs := make([]string, 0, len(seedSet))
	for id := range seedSet {
		seedIDs = append(seedIDs, id)
	}
	sort.Strings(seedIDs)
	return seedIDs
}

func cypherStringList(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, "'"+escapeCypherString(value)+"'")
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

// collectGraphRows extracts nodes and edges from unbounded AGE queries used by
// non-map repository methods. The public relationship map uses the bounded
// collector above instead.
func collectGraphRows(rows pgx.Rows) ([]GraphNode, []GraphEdge, error) {
	collector := newBoundedGraphCollector(0, 0)
	for rows.Next() {
		var row graphRow
		if err := rows.Scan(&row.node, &row.relationship, &row.target, &row.relationshipType); err != nil {
			return nil, nil, fmt.Errorf("scan row: %w", err)
		}
		collector.addRow(row)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("read graph rows: %w", err)
	}
	nodes, edges := collector.nodesAndEdges()
	return nodes, edges, nil
}

func graphRelationshipType(relTypeStr *string) string {
	if relTypeStr == nil {
		return ""
	}
	return strings.Trim(strings.TrimSpace(*relTypeStr), `"`)
}

// extractProp pulls a value from a raw agtype string.
func extractProp(agtypeStr, key string) string {
	search := fmt.Sprintf(`"%s": "`, key)
	idx := strings.Index(agtypeStr, search)
	if idx < 0 {
		return ""
	}
	start := idx + len(search)
	end := strings.Index(agtypeStr[start:], `"`)
	if end < 0 {
		return ""
	}
	return agtypeStr[start : start+end]
}
