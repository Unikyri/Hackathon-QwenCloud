package eval

import (
	"testing"
)

func TestRecallAtK(t *testing.T) {
	retrieved := []string{"A", "B", "C", "D"}
	relevant := map[string]bool{"A": true, "C": true}

	// recall@2 = 1/2 (A only in top-2)
	if got := recallAtK(retrieved, relevant, 2); got != 0.5 {
		t.Errorf("recall@2 = %v, want 0.5", got)
	}
	// recall@4 = 2/2 = 1.0
	if got := recallAtK(retrieved, relevant, 4); got != 1.0 {
		t.Errorf("recall@4 = %v, want 1.0", got)
	}
	// empty retrieved
	if got := recallAtK([]string{}, relevant, 5); got != 0 {
		t.Errorf("recall@k on empty retrieved = %v, want 0", got)
	}
	// empty relevant
	if got := recallAtK(retrieved, map[string]bool{}, 3); got != 0 {
		t.Errorf("recall@k on empty relevant = %v, want 0", got)
	}
	// k=0
	if got := recallAtK(retrieved, relevant, 0); got != 0 {
		t.Errorf("recall@0 = %v, want 0", got)
	}
}

func TestPrecisionAtK(t *testing.T) {
	retrieved := []string{"A", "B", "C", "D"}
	relevant := map[string]bool{"A": true, "C": true}

	if got := precisionAtK(retrieved, relevant, 2); got != 0.5 {
		t.Errorf("precision@2 = %v, want 0.5", got)
	}
	if got := precisionAtK(retrieved, relevant, 0); got != 0 {
		t.Errorf("precision@0 = %v, want 0", got)
	}
}

func TestMRR(t *testing.T) {
	retrieved := []string{"A", "B", "C", "D"}
	relevant := map[string]bool{"A": true, "C": true}

	if got := mrr(retrieved, relevant); got != 1.0 {
		t.Errorf("mrr = %v, want 1.0", got)
	}

	// A is not relevant, B is
	if got := mrr([]string{"X", "A", "B"}, relevant); got != 0.5 {
		t.Errorf("mrr = %v, want 0.5", got)
	}

	// none relevant
	if got := mrr(retrieved, map[string]bool{"Z": true}); got != 0 {
		t.Errorf("mrr no relevant = %v, want 0", got)
	}
}

func TestNDCGAtK(t *testing.T) {
	retrieved := []string{"A", "B", "C", "D"}
	relevant := map[string]bool{"A": true, "C": true}

	// ndcg@4: DCG = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
	// IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.6309 = 1.6309
	// nDCG = 1.5 / 1.6309 ≈ 0.9197
	got := ndcgAtK(retrieved, relevant, 4)
	if got < 0.919 || got > 0.920 {
		t.Errorf("ndcg@4 = %v, want ~0.9197", got)
	}

	// k=0
	if got := ndcgAtK(retrieved, relevant, 0); got != 0 {
		t.Errorf("ndcg@0 = %v, want 0", got)
	}

	// empty relevant
	if got := ndcgAtK(retrieved, map[string]bool{}, 4); got != 0 {
		t.Errorf("ndcg empty relevant = %v, want 0", got)
	}
}
