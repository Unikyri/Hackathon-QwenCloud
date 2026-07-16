package repositories

import (
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

// writerPreferenceRow is a tiny Scan seam for repository-level conversion
// tests. It deliberately returns a nil embedding to mirror the nullable
// vector column in writer_preferences.
type writerPreferenceRow struct {
	values []any
}

func (r writerPreferenceRow) Scan(dest ...any) error {
	for i, value := range r.values {
		target := reflect.ValueOf(dest[i])
		if target.Kind() != reflect.Pointer || target.IsNil() {
			continue
		}
		if value == nil {
			target.Elem().Set(reflect.Zero(target.Elem().Type()))
			continue
		}
		source := reflect.ValueOf(value)
		if source.Type().AssignableTo(target.Elem().Type()) {
			target.Elem().Set(source)
		}
	}
	return nil
}

func TestScanWriterPreferenceAllowsNullEmbedding(t *testing.T) {
	id, userID := uuid.New(), uuid.New()
	created := time.Now().UTC()
	item, err := scanWriterPreference(writerPreferenceRow{values: []any{
		id, userID, "Long sentences are deliberate.", "universal", []string{},
		0.8, 1.0, "active", nil, created, []uuid.UUID{}, []uuid.UUID{}, created,
	}})
	if err != nil {
		t.Fatalf("scanWriterPreference returned error for NULL embedding: %v", err)
	}
	if item.ID != id || item.UserID != userID {
		t.Fatalf("scanned identity = %s/%s, want %s/%s", item.ID, item.UserID, id, userID)
	}
	if len(item.Embedding) != 0 {
		t.Fatalf("embedding = %v, want empty for SQL NULL", item.Embedding)
	}
}
