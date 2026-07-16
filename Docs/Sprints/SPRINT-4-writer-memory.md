# Sprint 4 — Writer Memory

**Tier:** P2 · **SRS coverage:** WM-1..n, RC-1..n, EX-1..n, CS-1..2 (SRS §6)
**Prerequisite:** Sprint 0 (genre tags exist and are multiple — conditioning depends on
them), Sprint 3 recommended (structured output + cache make the promotion calls cheap and
type-safe), but not strictly blocking.

**What this is:** the system stops remembering only the *story* and starts remembering the
*writer*. This is the strategic difference between a MemoryAgent and a RAG pipeline over a
novel — it is where the innovation score lives.

**The load-bearing wall (PRD §5.1):** an **Observation** is a verifiable *fact* from
zero-LLM stylometry ("4.2 adverbs per 100 words"). A **Preference** is a *belief about
intent* ("long sentences are deliberate"). Stylometry may **only** write observations.
Promotion to preference **requires an intent signal**. Collapse this wall and the system
starts believing its own measurements are the writer's wishes.

---

## Task 4.1 — Migration `024`: the three tables plus decay history

**Files:** `backend/migrations/024_writer_memory.up.sql` / `.down.sql`

> Numbering note: `023` is consumed by the entity mention character-offset migration,
> so Writer Memory lands as `024` and the skills association (Sprint 5) follows it. The SRS wrote
> these as 021/022 before sprint order was fixed — the schemas in SRS §6.1 are the
> contract; only the numbers shift.

Schemas exactly as SRS §6.1:

1. **`writer_observations`** — facts. `user_id` FK (they belong to the **user**, not the
   universe), nullable `universe_id` (evidence source), `metric` (closed vocabulary:
   `mean_sentence_length`, `adverb_density`, `dialogue_ratio`, `lexical_richness`, …),
   `value numeric`, `sample_size int` (confidence in a fact scales with sample size),
   `computed_at`.
2. **`writer_preferences`** — beliefs. Per SRS §6.1: `statement`, `scope`
   (`universal` | `genre_bound`), `genre_tags text[]` (validated against the 20-tag
   vocabulary when scope is genre_bound), `confidence`, decay bookkeeping columns
   mirroring `entity_relevance_history`'s pattern, provenance link to the observations
   and feedback events that justified promotion.
3. **`writer_feedback_events`** — the intent signals: accepted/rejected/edited craft
   notes, explicit statements, with refs to the note and skill that produced them.

The same migration also creates `writer_preference_history`, the WM-9 time-series
snapshot table mirroring `entity_relevance_history`; it is required for the Memory
Theater decay explanation and is dropped before the three source tables on rollback.

Both `.down.sql` restore cleanly (NF-3).

**Expected result:** migrations apply and roll back; repo layer (`writer_memory_repo.go`)
with Create/List/Find following the existing three-layer shape.

---

## Task 4.2 — Passive stylometry: observations at zero LLM cost

**Files:** new `backend/internal/services/stylometry_service.go` (+ tests)

**Steps:**

1. Pure-Go text metrics over saved chapter content: sentence length distribution, adverb
   density (-ly heuristic + a small word list), dialogue ratio (quoted spans / total),
   lexical richness (type-token ratio). **No LLM calls — ever.** This service's whole
   value is that it runs constantly for free.
2. Trigger: on chapter save (debounced/async — never in the save path's latency) and at
   the end of ingestion (corpus-wide pass).
3. Write `writer_observations` rows with `sample_size` — 500 words of evidence is not
   3 000. Never write to `writer_preferences` from here. **Enforce the wall in code**:
   the stylometry service does not even take a dependency on the preference repo.
4. Unit tests with fixture prose: known text in, expected metric values out,
   deterministic.

**Expected result:** saving a chapter produces observation rows; the service is provably
LLM-free (no client dependency in its constructor).

---

## Task 4.3 — The promotion loop: observation + intent → preference (WM)

**Files:** new `backend/internal/services/writer_memory_service.go`; hooks in the craft
review flow (Sprint 5 wires the note UI; the event ingestion contract is defined here)

**Steps:**

1. **Intent signals** (the four from PRD §5.2): explicit writer statements; repeated
   rejection of a category of note; repeated acceptance; revision behaviour after a note.
   Each lands as a `writer_feedback_events` row.
2. **Promotion rule:** a preference is created only when an observation is corroborated
   by ≥1 intent signal. The promotion call uses `qwen-max` with structured output:
   given observation(s) + event(s), produce `statement`, `scope`, `genre_tags`,
   `confidence`. Store provenance (which observation, which events).
3. **Scope classification (WM-4 — known failure point, PRD §8):** `universal` (craft
   that holds everywhere: "prefers concrete environmental description") vs `genre_bound`
   ("graphic violence is fine" — bound to the genres it was learned in). Misclassifying
   violence as universal contaminates a children's book. The classification is **visible
   and correctable by the writer** — an endpoint to flip scope/tags on a preference.
4. **Decay and reinforcement (WM-5):** repeated rejection of notes that a preference
   generates decays its confidence (reuse the event-driven exponential-decay approach of
   `RelevanceService` — same math, different table); below threshold the preference goes
   dormant. Reinforcement on acceptance. **The regression test that defines this sprint:**
   reject the same note three times → the note is no longer emitted.
5. Suppression contract for consumers: craft review (Sprint 5) queries active preferences
   and suppresses note categories the writer has rejected. `prose-economy`'s skill body
   already documents this coupling — the skill consumes it, this service provides it.

**Expected result:** a service test: seed observation + three rejection events → promotion
produces a dormant/suppressive preference → the note category stops being generated.

---

## Task 4.4 — Recall conditioning: the preference pipeline (RC)

**Files:** `backend/internal/services/memory_service.go`, `fuse_rrf.go` / `fuse_rrf_explain.go`

**Steps:**

1. Add a **sixth RRF pipeline**: active `writer_preferences` relevant to the current
   context, ranked by confidence × decay.
2. **Genre conditioning:** when recalling in a universe, genre-bound preferences filter
   by intersection of their `genre_tags` with the universe's `genre_tags` (Sprint 0's
   multi-tag field — this is why taxonomy was P0). Universal preferences always pass.
3. Nil-safe wiring, same pattern as consolidated/budget: absent ⇒ five pipelines as today.
4. Extend `RecallExplain` so preference-sourced items carry their pipeline tag — the
   Memory Theater FusionExplorer picks this up with zero extra backend work beyond the
   contribution chip.

**Expected result:** recall in a fantasy universe surfaces fantasy-bound preferences and
never surfaces preferences bound only to `horror`; the explain payload shows the
`preference` pipeline contributing.

---

## Task 4.5 — Explainability: "why do you believe that about me?" (EX)

**Files:** new handler endpoint (`GET /users/me/preferences` +
`GET /users/me/preferences/:id/evidence`), frontend panel

**Steps:**

1. The evidence endpoint returns the full trail: the preference, its confidence and decay
   history, the observations (with metric values and sample sizes) and the feedback
   events that produced it. Nothing hidden — this is the demo money-shot (PRD §5.3) and
   the audit answer for the judges.
2. Frontend: a "What Quill believes about you" panel (Memory Theater is its natural
   home): each preference with confidence bar, scope badge (universal / genre chips),
   evidence expansion, and the correction affordances (flip scope, deactivate).

**Expected result:** clicking any preference answers, with data: *what* is believed, *how
strongly*, based on *which* facts and *which* of the writer's own actions.

---

## Task 4.6 — Cold start (CS-1..2)

**Files:** ingestion hook + frontend empty states

**Steps:**

1. **Corpus bootstrap (CS-1):** ingesting an existing manuscript runs the corpus-wide
   stylometry pass (Task 4.2) — a writer who imports their novel gets observations on day
   zero, not after weeks of typing.
2. **Honest empty state (CS-2):** before any signal exists, the preferences panel says
   what it *will* learn and how — not a blank pane. (The broader first-run experience —
   what a brand-new account sees across the whole app — is still an open design item;
   this task covers only the Writer Memory panel.)

**Expected result:** demo-clone + one ingested fixture yields a populated observations
list and a comprehensible, non-empty preferences panel.

---

## Definition of done

- [x] Migration `024` up/down clean; three source tables plus the decay-history table per SRS §6.1.
- [x] Stylometry writes observations only, zero LLM (structurally: no client dependency), covered by deterministic tests.
- [x] Promotion requires an intent signal; scope classification is writer-correctable.
- [x] **The defining test passes: a note rejected three times stops being emitted (WM-5).**
- [x] Sixth recall pipeline conditioned by genre tags, nil-safe, visible in `RecallExplain`.
- [x] Evidence-trail endpoint + panel: every belief traceable to facts and writer actions.
- [x] `make e2e` still green.
