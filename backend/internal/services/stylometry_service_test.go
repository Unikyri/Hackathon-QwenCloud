package services

import (
	"math"
	"testing"
)

func TestStylometryAnalyzeIsDeterministic(t *testing.T) {
	text := `Alice walked slowly. "Bob ran quickly." Alice smiled.`
	svc := NewStylometryService(nil)
	got := svc.Analyze(text)
	if got.WordCount != 8 {
		t.Fatalf("word count = %d, want 8", got.WordCount)
	}
	if got.SentenceCount != 3 {
		t.Fatalf("sentence count = %d, want 3", got.SentenceCount)
	}
	if want := 8.0 / 3.0; math.Abs(got.MeanSentenceLength-want) > 1e-9 {
		t.Errorf("mean sentence length = %v, want %v", got.MeanSentenceLength, want)
	}
	if want := 25.0; math.Abs(got.AdverbDensity-want) > 1e-9 {
		t.Errorf("adverb density = %v, want %v", got.AdverbDensity, want)
	}
	if want := 0.375; math.Abs(got.DialogueRatio-want) > 1e-9 {
		t.Errorf("dialogue ratio = %v, want %v", got.DialogueRatio, want)
	}
	if want := 0.875; math.Abs(got.LexicalRichness-want) > 1e-9 {
		t.Errorf("lexical richness = %v, want %v", got.LexicalRichness, want)
	}
	if again := svc.Analyze(text); again != got {
		t.Fatalf("same input produced different metrics: %#v vs %#v", got, again)
	}
}

func TestStylometryEmptyText(t *testing.T) {
	got := NewStylometryService(nil).Analyze(" \n\t ")
	if got != (StylometryMetrics{}) {
		t.Fatalf("empty text metrics = %#v, want zero value", got)
	}
}

func TestStylometryDoesNotDependOnLLMOrPreferences(t *testing.T) {
	// The constructor accepts only WriterMemoryRepo, and a nil repo still
	// computes metrics. This compile/runtime guard protects the zero-LLM wall.
	if got := NewStylometryService(nil).Analyze("One sentence."); got.WordCount != 2 {
		t.Fatalf("word count = %d, want 2", got.WordCount)
	}
}
