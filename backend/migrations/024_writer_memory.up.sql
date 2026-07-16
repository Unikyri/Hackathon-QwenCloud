-- Writer Memory keeps measurable observations separate from inferred intent.
-- Observations belong to the user and may optionally retain their source
-- universe. Preferences travel across universes and carry their own decay
-- state. Feedback is retained independently so retracting a preference never
-- erases the evidence that led to it.

CREATE TABLE writer_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    universe_id UUID REFERENCES universes(id) ON DELETE SET NULL,
    metric TEXT NOT NULL CHECK (metric IN (
        'mean_sentence_length',
        'adverb_density',
        'dialogue_ratio',
        'lexical_richness'
    )),
    value NUMERIC NOT NULL,
    sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_writer_observations_user_computed
    ON writer_observations (user_id, computed_at DESC);
CREATE INDEX idx_writer_observations_user_metric
    ON writer_observations (user_id, metric, computed_at DESC);

CREATE TABLE writer_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('universal', 'genre_bound')),
    genre_tags TEXT[] NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    relevance_score REAL NOT NULL DEFAULT 1.0 CHECK (relevance_score >= 0 AND relevance_score <= 1),
    lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'archived')),
    embedding vector(1024),
    last_reinforced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observation_ids UUID[] NOT NULL DEFAULT '{}',
    feedback_event_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((scope = 'universal' AND cardinality(genre_tags) = 0)
        OR (scope = 'genre_bound' AND cardinality(genre_tags) > 0))
);

CREATE INDEX idx_writer_preferences_user_lifecycle
    ON writer_preferences (user_id, lifecycle, relevance_score DESC);
CREATE INDEX idx_writer_preferences_embedding_hnsw
    ON writer_preferences USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

CREATE TABLE writer_feedback_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    universe_id UUID REFERENCES universes(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
    note_id UUID,
    signal TEXT NOT NULL CHECK (signal IN ('accept', 'reject', 'behavioural_accept')),
    preference_id UUID REFERENCES writer_preferences(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_writer_feedback_events_user_created
    ON writer_feedback_events (user_id, created_at DESC);
CREATE INDEX idx_writer_feedback_events_preference
    ON writer_feedback_events (preference_id, created_at DESC);

-- WM-9: preference decay/reactivation history mirrors entity_relevance_history.
-- user_id is retained so the evidence trail survives a preference deactivation.
CREATE TABLE writer_preference_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_id UUID REFERENCES writer_preferences(id) ON DELETE SET NULL,
    relevance_score REAL NOT NULL,
    confidence REAL NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_writer_preference_history_preference_recorded
    ON writer_preference_history (preference_id, recorded_at);
