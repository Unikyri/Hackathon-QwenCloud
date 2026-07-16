package services

import (
	"context"

	"github.com/quill/backend/internal/models"
)

// CacheControl marks a stable message prefix for DashScope's explicit
// five-minute context cache. The metadata is intentionally wire-neutral; the
// native adapter converts it into a content block with cache_control while the
// OpenAI-compatible fallback ignores it.
type CacheControl struct {
	Type string `json:"type"`
}

// LLMService is the provider-neutral contract used by Quill's domain
// services. QwenService (the OpenAI-compatible fallback) and
// DashScopeService (the native HTTP client) both implement it. Keeping the
// wire-neutral request/response types in this package means agent loops and
// callers do not need to know which provider protocol is active.
//
// The interface intentionally contains only operations with two concrete
// implementations. Provider-specific capabilities such as reranking and
// usage snapshots have their own optional interfaces and are nil-safe.
type LLMService interface {
	IngestionQwen

	Chat(ctx context.Context, model string, messages []QwenMessage) (string, error)
	CheckContradictions(ctx context.Context, candidates []ContradictionCandidate) ([]models.Contradiction, error)
	RunAgentLoop(ctx context.Context, messages []QwenMessage, tools []QwenTool, executor ToolExecutor, maxDepth int) (string, error)
	RunAgentLoopStream(ctx context.Context, messages []QwenMessage, tools []QwenTool, executor ToolExecutor, maxDepth int, onProgress func(stage string, tc *QwenToolCall)) (string, error)
	HealthCheck(ctx context.Context) error

	// ContextBudget returns the optional context-budget manager used for
	// tool-result compression and progress reporting.
	ContextBudget() *ContextBudgetManager
}

// StructuredChat is an optional provider capability used by Writer Memory's
// promotion step. Keeping it optional preserves compatibility with the small
// test doubles and third-party adapters that only implement LLMService.
type StructuredChat interface {
	ChatStructured(ctx context.Context, model string, messages []QwenMessage, format *ResponseFormat) (string, error)
}

// LLMHealthChecker is kept separate from LLMService so lightweight health
// probes do not force unrelated test doubles to implement the whole model
// surface.
type LLMHealthChecker interface {
	HealthCheck(ctx context.Context) error
}

// LLMUsageSnapshot exposes provider-reported token accounting. Implementations
// may return a zero snapshot when the provider does not expose usage details.
// The native DashScope client records input/output/cache counters here.
type LLMUsageSnapshot struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CachedTokens             int64 `json:"cached_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
	Requests                 int64 `json:"requests"`
}

type LLMUsageProvider interface {
	UsageSnapshot() LLMUsageSnapshot
}

// RerankResult is one provider-ranked document index. Index refers to the
// document position supplied to Reranker.Rerank, while Score is the native
// relevance score used only for explain/debug surfaces.
type RerankResult struct {
	Index int
	Score float64
}

// Reranker is optional: native DashScope implements it, while the OpenAI
// compatible fallback leaves it unset so Recall remains bit-for-bit RRF.
type Reranker interface {
	Rerank(ctx context.Context, query string, documents []string, topN int) ([]RerankResult, error)
}

// ContextBudget makes the existing QwenService budget manager available
// through the shared contract without exposing provider internals to callers.
func (s *QwenService) ContextBudget() *ContextBudgetManager {
	if s == nil {
		return nil
	}
	return s.budgetMgr
}

func contextBudgetOf(s LLMService) *ContextBudgetManager {
	if s == nil {
		return nil
	}
	return s.ContextBudget()
}
