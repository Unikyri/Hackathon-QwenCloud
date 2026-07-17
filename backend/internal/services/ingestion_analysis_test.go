package services

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/quill/backend/internal/models"
	"github.com/quill/backend/internal/ws"
)

// TestSafeAnalyzeRecoversPanic proves the recover seam used by
// runPostIngestAnalysis contains a panic instead of letting it escape and
// crash the process. Post-ingest analysis parses untrusted LLM tool-call JSON
// and type-asserts on it; an unrecovered panic on any goroutine would take
// down every user's WebSocket, not just the ingestion job. If safeAnalyze
// failed to recover, this panic would propagate and fail (crash) the test.
func TestSafeAnalyzeRecoversPanic(t *testing.T) {
	safeAnalyze("test unit", func() {
		panic("boom from untrusted analysis")
	})
	// Reaching this line means the panic was recovered, not propagated.
}

func TestEmitContradictionAlertCarriesUniverseID(t *testing.T) {
	hub := &mockIngestionHub{}
	svc := &IngestionService{hub: hub}
	universeID := uuid.New()
	svc.emitContradictionAlert(uuid.New(), models.Contradiction{ID: uuid.New(), UniverseID: universeID})

	msgs := hub.popMessages()
	if len(msgs) != 1 || msgs[0].Type != ws.TypeContradictionAlert {
		t.Fatalf("expected one contradiction_alert, got %+v", msgs)
	}
	var payload models.ContradictionAlertPayload
	if err := json.Unmarshal(msgs[0].Payload, &payload); err != nil {
		t.Fatalf("unmarshal contradiction_alert: %v", err)
	}
	if payload.UniverseID != universeID {
		t.Errorf("contradiction_alert universe_id = %s, want %s", payload.UniverseID, universeID)
	}
}
