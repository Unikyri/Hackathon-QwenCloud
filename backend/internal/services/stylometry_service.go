package services

import (
	"context"
	"regexp"
	"strings"
	"unicode"

	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
)

const (
	MetricMeanSentenceLength = "mean_sentence_length"
	MetricAdverbDensity      = "adverb_density"
	MetricDialogueRatio      = "dialogue_ratio"
	MetricLexicalRichness    = "lexical_richness"
)

var stylometryTokenRE = regexp.MustCompile(`(?i)[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?`)

// StylometryMetrics is the deterministic, zero-LLM output of Analyze.
// Values are intentionally plain numbers so tests and future offline
// re-analysis can reproduce them byte-for-byte from the same text.
type StylometryMetrics struct {
	MeanSentenceLength float64
	AdverbDensity      float64
	DialogueRatio      float64
	LexicalRichness    float64
	WordCount          int
	SentenceCount      int
}

// WriterObservationSink is the narrow contract consumed by chapter saves.
// Keeping the hook observation-only makes the load-bearing wall explicit:
// callers can write measurable facts, but cannot promote or mutate writer
// preferences through stylometry.
type WriterObservationSink interface {
	Observe(context.Context, uuid.UUID, *uuid.UUID, string) ([]models.WriterObservation, error)
}

// WriterCorpusObservationSink is the ingestion-specific extension. It is a
// separate interface so a chapter save cannot accidentally gain a corpus-level
// operation (and tests can provide the smallest seam they need).
type WriterCorpusObservationSink interface {
	ObserveCorpus(context.Context, uuid.UUID, uuid.UUID, []string) ([]models.WriterObservation, error)
}

// StylometryService owns passive observations only. It deliberately receives
// no LLMService and no preference repository: this constructor is the code
// boundary enforcing the Observation/Preference load-bearing wall.
type StylometryService struct {
	observationRepo interface {
		CreateObservation(context.Context, *models.WriterObservation) error
	}
}

var _ WriterObservationSink = (*StylometryService)(nil)
var _ WriterCorpusObservationSink = (*StylometryService)(nil)

func NewStylometryService(observationRepo interface {
	CreateObservation(context.Context, *models.WriterObservation) error
}) *StylometryService {
	return &StylometryService{observationRepo: observationRepo}
}

// Analyze computes all supported metrics without network, model, clock, or
// database access. Empty/whitespace text yields zero-valued metrics.
func (s *StylometryService) Analyze(text string) StylometryMetrics {
	words := stylometryTokenRE.FindAllString(text, -1)
	wordCount := len(words)
	sentences := sentenceWordCounts(text)
	metrics := StylometryMetrics{WordCount: wordCount, SentenceCount: len(sentences)}
	if wordCount == 0 {
		return metrics
	}

	totalSentenceWords := 0
	for _, count := range sentences {
		totalSentenceWords += count
	}
	if len(sentences) > 0 {
		metrics.MeanSentenceLength = float64(totalSentenceWords) / float64(len(sentences))
	}

	adverbs := 0
	unique := make(map[string]struct{}, wordCount)
	for _, word := range words {
		lower := strings.ToLower(strings.TrimRightFunc(word, unicode.IsPunct))
		unique[lower] = struct{}{}
		if isAdverb(lower) {
			adverbs++
		}
	}
	metrics.AdverbDensity = float64(adverbs) * 100 / float64(wordCount)
	metrics.LexicalRichness = float64(len(unique)) / float64(wordCount)
	metrics.DialogueRatio = dialogueWordRatio(text, wordCount)
	return metrics
}

// Observe writes four observations and nothing else. In particular, it never
// calls a promotion method and has no preference dependency to call.
func (s *StylometryService) Observe(ctx context.Context, userID uuid.UUID, universeID *uuid.UUID, text string) ([]models.WriterObservation, error) {
	if s == nil || s.observationRepo == nil || userID == uuid.Nil || strings.TrimSpace(text) == "" {
		return []models.WriterObservation{}, nil
	}
	metrics := s.Analyze(text)
	observations := []models.WriterObservation{
		{UserID: userID, UniverseID: universeID, Metric: MetricMeanSentenceLength, Value: metrics.MeanSentenceLength, SampleSize: metrics.SentenceCount},
		{UserID: userID, UniverseID: universeID, Metric: MetricAdverbDensity, Value: metrics.AdverbDensity, SampleSize: metrics.WordCount},
		{UserID: userID, UniverseID: universeID, Metric: MetricDialogueRatio, Value: metrics.DialogueRatio, SampleSize: metrics.WordCount},
		{UserID: userID, UniverseID: universeID, Metric: MetricLexicalRichness, Value: metrics.LexicalRichness, SampleSize: metrics.WordCount},
	}
	for i := range observations {
		if err := s.observationRepo.CreateObservation(ctx, &observations[i]); err != nil {
			return observations[:i], err
		}
	}
	return observations, nil
}

// ObserveCorpus is the ingestion cold-start hook. It intentionally analyses
// the complete manuscript as one sample rather than one row per chunk, so a
// large upload produces a corpus-level baseline on day one.
func (s *StylometryService) ObserveCorpus(ctx context.Context, userID, universeID uuid.UUID, chapterTexts []string) ([]models.WriterObservation, error) {
	text := strings.TrimSpace(strings.Join(chapterTexts, "\n\n"))
	return s.Observe(ctx, userID, &universeID, text)
}

func isAdverb(word string) bool {
	if strings.HasSuffix(word, "ly") && len(word) > 3 {
		return true
	}
	switch word {
	case "very", "quite", "rather", "too", "just", "really", "almost", "often", "never", "always", "sometimes", "perhaps", "maybe":
		return true
	default:
		return false
	}
}

func sentenceWordCounts(text string) []int {
	counts := make([]int, 0)
	start := 0
	for i, r := range text {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		segment := text[start : i+len(string(r))]
		if count := len(stylometryTokenRE.FindAllString(segment, -1)); count > 0 {
			counts = append(counts, count)
		}
		start = i + len(string(r))
	}
	if start < len(text) {
		if count := len(stylometryTokenRE.FindAllString(text[start:], -1)); count > 0 {
			counts = append(counts, count)
		}
	}
	return counts
}

func dialogueWordRatio(text string, totalWords int) float64 {
	if totalWords == 0 {
		return 0
	}
	inside := false
	dialogueWords := 0
	segmentStart := 0
	for i, r := range text {
		if r != '"' && r != '“' && r != '”' {
			continue
		}
		if inside {
			dialogueWords += len(stylometryTokenRE.FindAllString(text[segmentStart:i], -1))
		}
		inside = !inside
		segmentStart = i + len(string(r))
	}
	return float64(dialogueWords) / float64(totalWords)
}
