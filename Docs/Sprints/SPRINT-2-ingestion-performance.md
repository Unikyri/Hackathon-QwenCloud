# Sprint 2 — Ingestion Performance (MAP/REDUCE)

**Tier:** P1 · **SRS coverage:** IG-1..5, TH-1..7, MT-1..3, PF-1..5
**Prerequisite:** Sprint 1 — the E2E ingestion test (EE-2) is how this sprint proves it
broke nothing, and the timed run (PF-1/2) is how it proves it worked.

**Root cause being fixed:** a 400-page novel produces ~300 chunks processed
**sequentially** at ~10s per LLM call ≈ 1 hour. Secondary defect: when extraction *was*
parallelised naively, concurrent `ResolveOrCreate` calls raced and created duplicates
("James" vs "James Holden") — a write-write race: two resolvers can't see each other's
uncommitted writes and both create.

**Architecture:** split ingestion into a stateless parallel **MAP** phase and a stateful
serial **REDUCE** phase. Parallelism where there is no shared state; a single writer where
there is.

---

## Task 2.1 — Restructure `IngestionService` into MAP / REDUCE (IG-1..3)

**Files:** `backend/internal/services/ingestion_service.go` (and its collaborators —
read the whole file first; the parse/chapter-split/chunk stages stay as they are)

**Steps:**

1. **MAP** — per-chunk **mention extraction**. Input: chunk text + chapter ref. Output:
   `[]ExtractedMention` (name, type, description, properties, offsets). Constraints:
   - **No DB writes. No entity resolution. No reads of other chunks' results.** Pure
     text → mentions. This is what makes it safe to parallelise.
   - Run with a `errgroup`-bounded worker pool over chunks; concurrency bound comes from
     the throttle (Task 2.2), not a magic number.
   - Embeddings for chunks can also happen in MAP (also stateless).
2. **REDUCE** — resolution of accumulated mentions, **single-threaded per universe**:
   - Iterate mentions in document order; resolve each via the existing chain
     (exact name → alias → fuzzy → semantic → create) in `EntityService.ResolveOrCreate`.
   - Because REDUCE is serial, the second "James Holden" mention *sees* the entity the
     first one created — the race disappears by construction (IG-4).
   - Graph writes (nodes/edges via `graph_repo.go`) and mention rows happen here too.
3. Keep the job-level goroutine structure (one goroutine per ingestion job) — MAP/REDUCE
   is *inside* a job.
4. Progress accounting changes: MAP completion is the bulk of wall time; emit progress
   from completed-chunk count (feeds Task 2.4).

**Expected result:** the pipeline compiles and passes existing service tests; a log of a
test ingest shows N parallel MAP completions followed by one serial REDUCE pass.

---

## Task 2.2 — Token-bucket throttling on TPM (TH-1..7)

**Files:** new `backend/internal/services/throttle.go` (+ test), wired into the LLM client
call path; `backend/internal/config` for the knobs; `.env.example`

**Why TPM, not goroutines:** grouping N paragraphs into one call reduces RPM but ships the
same tokens — **TPM is the binding ceiling**. A goroutine cap is a proxy; a token bucket is
the real constraint.

**Steps:**

1. Use `golang.org/x/time/rate`:
   - one limiter per model for **TPM** (`qwen-turbo`: 5M, `qwen-max`: 1M) — `WaitN(ctx, estimatedTokens)`
     before each call, estimate = prompt tokens (tokenizer already exists in
     `tokenizer.go`) + max output;
   - one limiter per model for **RPM** (600 → also enforce RPS = 10 to absorb per-second
     burst throttling).
2. **Interactive reservation (TH-3):** rate limits are account-level, shared across keys.
   Reserve a configurable share (default 30%) for interactive traffic: two buckets —
   ingestion draws from the 70% bucket, live analysis/craft review from the full budget.
   An ingestion job must never starve a writer typing.
3. **Ramp (TH-4):** start MAP concurrency low (e.g. 2) and increase on sustained success;
   Qwen returns `429-Throttling.BurstRate` when the request rate *rises* too fast, even
   under the limit.
4. **Backoff (TH-5, TH-6):** on `429`, exponential backoff with jitter; on sustained
   `429`, degrade to the fallback model rather than failing the job (config-gated, P2).
5. All knobs environment-configurable (TH-7): `LLM_TPM_TURBO`, `LLM_TPM_MAX`, `LLM_RPM`,
   `LLM_INTERACTIVE_RESERVE`, `LLM_MAX_CONCURRENCY`, `LLM_RAMP_STEP`. Add to
   `.env.example` with placeholder-style values.

**Expected result:** a unit test with a fake clock proves: token budget is respected, the
interactive bucket stays available while ingestion saturates, 429s trigger backoff.

---

## Task 2.3 — Model tiering (MT-1..3)

**Files:** `backend/internal/services/qwen_service.go` call sites, config

**Steps:**

1. MAP extraction → `qwen-turbo` (5× TPM headroom, cheaper, sufficient for stateless
   extract-and-classify — the Sprint 0 criteria prompt keeps it honest).
2. Contradiction, plot-hole, craft review → `qwen-max` (few calls, hard reasoning).
3. Model per task from config: rename the tier-named vars to role-named ones —
   `QWEN_EXTRACTION_MODEL`, `QWEN_REASONING_MODEL`, `QWEN_FALLBACK_MODEL` (keeping the
   existing `QWEN_*` convention in `config.go`), not hard-coded. Values per phase: see the
   model & quota strategy table in [README.md](./README.md).

**Expected result:** extraction logs show `qwen-turbo`; analysis logs show `qwen-max`;
swapping via env needs no rebuild.

---

## Task 2.4 — Progress, ETA, live action message (PF-3..5)

**Files:** `backend/internal/services/ingestion_service.go` (progress emission),
`backend/internal/ws/protocol.go` (extend `ingestion_progress` payload),
frontend ingestion progress component + `wsStore.ts`

**Steps:**

1. Emit `ingestion_progress` at least every 2s while running (PF-3) — from MAP completed
   count, then REDUCE progress.
2. Payload gains: `action` (one live message — "Extracting entities from chapter 12…")
   and `eta_seconds`.
3. **ETA honesty (PF-4):** compute from measured chunk throughput, EWMA-smoothed; do not
   emit before ~10% complete. An ETA extrapolated from two chunks swings wildly and reads
   as a broken system.
4. Frontend (PF-5): one bar + the action message beneath it + ETA. No row of stage labels
   lighting up.

**Expected result:** during a fixture ingest, the bar moves smoothly, the message names
real chapters, and the ETA appears late and behaves monotonically enough to trust.

---

## Task 2.5 — Defence in depth: uniqueness constraint (IG-5)

**Files:** `backend/migrations/021_entity_natural_key.up.sql` / `.down.sql`

**Steps:**

1. Unique index on the entity natural key:
   `CREATE UNIQUE INDEX entities_universe_name_type_key ON entities (universe_id, lower(name), type);`
2. First de-duplicate existing rows (merge duplicates: keep the row with the longest
   description, repoint `entity_mentions`, merge aliases — write the merge as SQL in the
   migration, verified against real dev data).
3. `ResolveOrCreate` treats a unique-violation error as "someone created it first":
   re-fetch and use the winner. With serial REDUCE this should never fire — it exists so
   a **future** concurrency bug fails loudly instead of duplicating silently.

> Note: this renumbers nothing — Writer Memory's migration (SRS §6.1) follows the
> character-offset migration as `024`;
> migration numbers are allocated in sprint order from here on.

**Expected result:** the index exists; a test inserting the same (universe, name, type)
twice fails; the resolve path recovers gracefully from the violation.

---

## Task 2.6 — Prove the numbers (PF-1, PF-2, IG-4)

**Steps:**

1. Timed run: the 400-page fixture (~150k words) completes in **≤ 5 minutes p95**
   (stretch ≤ 3). The 50-page fixture in **≤ 60 seconds**. Record the numbers — an
   unmeasured improvement does not go in the submission.
2. Duplicate check: after ingest, `SELECT name, type, COUNT(*) … GROUP BY … HAVING COUNT(*) > 1`
   returns zero rows; "James" and "James Holden" resolve to one entity (the existing
   fuzzy/alias chain, now serial, must see them merge).
3. Re-run `make e2e` (EE-2 covers ingestion end-to-end).

---

## Definition of done

- [ ] MAP is stateless and parallel; REDUCE is serial per universe; the race is gone by construction and guarded by the unique index.
- [ ] Throttle: TPM token bucket + RPM/RPS + 30% interactive reservation + ramp + backoff, all env-configurable, unit-tested with a fake clock.
- [ ] Extraction on `qwen-turbo`, reasoning on `qwen-max`, both configurable.
- [ ] Progress every ≤2s, one live action message, EWMA ETA hidden until 10%.
- [ ] Measured: 400 pages ≤ 5 min, 50 pages ≤ 60 s, zero duplicate entities. `make e2e` passes.
