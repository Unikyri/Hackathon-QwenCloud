package eval

import "math"

// recallAtK = |relevant retrieved in top-k| / |total relevant|.
func recallAtK(retrieved []string, relevant map[string]bool, k int) float64 {
	if len(relevant) == 0 || k <= 0 {
		return 0
	}
	hits := 0
	for i, id := range retrieved {
		if i >= k {
			break
		}
		if relevant[id] {
			hits++
		}
	}
	return float64(hits) / float64(len(relevant))
}

// precisionAtK = |relevant in top-k| / k.
func precisionAtK(retrieved []string, relevant map[string]bool, k int) float64 {
	if k <= 0 {
		return 0
	}
	hits := 0
	for i, id := range retrieved {
		if i >= k {
			break
		}
		if relevant[id] {
			hits++
		}
	}
	return float64(hits) / float64(k)
}

// mrr = 1/rank of first relevant, 0 if none.
func mrr(retrieved []string, relevant map[string]bool) float64 {
	for i, id := range retrieved {
		if relevant[id] {
			return 1.0 / float64(i+1)
		}
	}
	return 0
}

// ndcgAtK with binary relevance (0/1) and IDCG normalization.
func ndcgAtK(retrieved []string, relevant map[string]bool, k int) float64 {
	if k <= 0 || len(relevant) == 0 {
		return 0
	}
	dcg := 0.0
	for i, id := range retrieved {
		if i >= k {
			break
		}
		if relevant[id] {
			dcg += 1.0 / math.Log2(float64(i+2))
		}
	}
	ideal := len(relevant)
	if ideal > k {
		ideal = k
	}
	idcg := 0.0
	for i := 0; i < ideal; i++ {
		idcg += 1.0 / math.Log2(float64(i+2))
	}
	if idcg == 0 {
		return 0
	}
	return dcg / idcg
}
