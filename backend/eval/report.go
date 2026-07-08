package eval

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// QueryReport holds per-query recall metrics.
type QueryReport struct {
	ID           string
	Query        string
	RecallAt5    float64
	PrecisionAt5 float64
	MRR          float64
	NDCGAt5      float64
}

// RecallReport holds the full evaluation report.
type RecallReport struct {
	Timestamp string
	Queries   []QueryReport
}

const recallReportHeader = "# Memory Recall Evaluation Report"

// writeRecallReport writes a markdown table of recall metrics to the given path.
// If the file already contains other benchmark sections, the recall section is
// prepended so it appears first; any stale recall section is replaced.
func writeRecallReport(t *testing.T, path string, report RecallReport) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir report dir: %v", err)
	}

	var existing string
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}

	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	defer f.Close()

	if report.Timestamp == "" {
		report.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	fmt.Fprintln(f, recallReportHeader)
	fmt.Fprintf(f, "\nGenerated: %s\n\n", report.Timestamp)
	fmt.Fprintln(f, "| Query | recall@5 | precision@5 | MRR | nDCG@5 |")
	fmt.Fprintln(f, "|-------|----------|-------------|-----|--------|")
	for _, q := range report.Queries {
		fmt.Fprintf(f, "| %s | %.3f | %.3f | %.3f | %.3f |\n",
			q.Query, q.RecallAt5, q.PrecisionAt5, q.MRR, q.NDCGAt5)
	}

	if rest := stripRecallSection(existing); rest != "" {
		fmt.Fprint(f, rest)
	}
}

// stripRecallSection removes a previously-written recall report from existing
// markdown so re-running the harness does not duplicate it.
func stripRecallSection(existing string) string {
	idx := strings.Index(existing, recallReportHeader)
	if idx == -1 {
		return existing
	}
	next := strings.Index(existing[idx+len(recallReportHeader):], "\n# ")
	if next == -1 {
		return ""
	}
	return existing[idx+len(recallReportHeader)+next:]
}

// replaceSection swaps an existing markdown section (identified by header) with
// new content, preserving surrounding sections. It is used to keep results.md
// idempotent across multiple harness runs.
func replaceSection(existing, header, body string) string {
	prefix := "\n" + header
	idx := strings.Index(existing, prefix)
	if idx == -1 {
		if existing == "" {
			return header + "\n\n" + body
		}
		return existing + prefix + "\n\n" + body
	}

	before := existing[:idx]
	afterIdx := strings.Index(existing[idx+len(prefix):], "\n## ")
	var after string
	if afterIdx != -1 {
		after = existing[idx+len(prefix)+afterIdx:]
	}
	return before + prefix + "\n\n" + body + after
}

func writeReportFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir report dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}
}

// LatencyRow holds p50/p95 recall latency for a given entity count.
type LatencyRow struct {
	N     int
	P50Ms float64
	P95Ms float64
}

// appendLatencyReport appends or replaces the latency benchmark section.
func appendLatencyReport(t *testing.T, path string, rows []LatencyRow) {
	t.Helper()

	var b strings.Builder
	b.WriteString("Degraded-mode `RecallWithQuery` latency (nil embedding, k=5).\n\n")
	b.WriteString("| Entities | p50 (ms) | p95 (ms) |\n")
	b.WriteString("|----------|----------|----------|\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "| %d | %.3f | %.3f |\n", r.N, r.P50Ms, r.P95Ms)
	}

	existing := ""
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}
	writeReportFile(t, path, replaceSection(existing, "## Latency Benchmark", b.String()))
}

// ForgettingReport holds the outcome of the forgetting timeline eval.
type ForgettingReport struct {
	K                  int
	Lambda             float64
	Threshold          float64
	TotalEntities      int
	Archived           int
	ShouldArchived     int
	MustStayActive     int
	FalseNegatives     int
	FalsePositives     int
	FalseNegativeNames string
	FalsePositiveNames string
}

// appendForgettingReport appends or replaces the forgetting timeline section.
func appendForgettingReport(t *testing.T, path string, report ForgettingReport) {
	t.Helper()

	var b strings.Builder
	fmt.Fprintf(&b, "After %d decay ticks (lambda=%.2f, threshold=%.2f).\n\n", report.K, report.Lambda, report.Threshold)
	b.WriteString("| Metric | Value |\n")
	b.WriteString("|--------|-------|\n")
	fmt.Fprintf(&b, "| Total active entities | %d |\n", report.TotalEntities)
	fmt.Fprintf(&b, "| Archived entities | %d |\n", report.Archived)
	fmt.Fprintf(&b, "| Should be archived (gold) | %d |\n", report.ShouldArchived)
	fmt.Fprintf(&b, "| Must stay active (gold) | %d |\n", report.MustStayActive)
	fmt.Fprintf(&b, "| False negatives (should archive, stayed active) | %d |\n", report.FalseNegatives)
	if report.FalseNegativeNames != "" {
		fmt.Fprintf(&b, "| False negative names | %s |\n", report.FalseNegativeNames)
	}
	fmt.Fprintf(&b, "| False positives (should stay active, archived) | %d |\n", report.FalsePositives)
	if report.FalsePositiveNames != "" {
		fmt.Fprintf(&b, "| False positive names | %s |\n", report.FalsePositiveNames)
	}

	existing := ""
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}
	writeReportFile(t, path, replaceSection(existing, "## Forgetting Timeline", b.String()))
}

// ConsolidationRow holds cosine fidelity for one consolidated entity.
type ConsolidationRow struct {
	EntityName string
	Cosine     float64
}

// appendConsolidationReport appends or replaces the consolidation fidelity section.
func appendConsolidationReport(t *testing.T, path string, rows []ConsolidationRow) {
	t.Helper()

	var b strings.Builder
	b.WriteString("Cosine similarity between consolidated-memory embedding and the centroid of the source mention embeddings.\n\n")
	b.WriteString("| Entity | cosine |\n")
	b.WriteString("|--------|--------|\n")
	var sum float64
	for _, r := range rows {
		fmt.Fprintf(&b, "| %s | %.4f |\n", r.EntityName, r.Cosine)
		sum += r.Cosine
	}
	if len(rows) > 0 {
		fmt.Fprintf(&b, "\nAverage cosine: %.4f\n", sum/float64(len(rows)))
	}

	existing := ""
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
	}
	writeReportFile(t, path, replaceSection(existing, "## Consolidation Fidelity", b.String()))
}
