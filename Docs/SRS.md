# Quill — Software Requirements Specification (v2)

**Companion documents:** [PRD.md](./PRD.md) — product requirements and rationale · [SKILLS.md](./SKILLS.md) — skills catalogue and genre vocabulary
**Scope:** the technical contract for the v2 release. Requirements are numbered and testable.

Conventions: **MUST** / **MUST NOT** / **SHOULD** / **MAY** carry RFC-2119 force.
Every requirement carries a priority tier (P0–P3) matching PRD §9.

---

## 1. Architectural Baseline

Unchanged from v1 and assumed by everything below:

- **Composition root:** `backend/cmd/server/main.go`. Hand-wired, no DI framework.
  Two-phase init for the `ws.Hub` ↔ `AnalysisService` cycle.
- **Layering:** `repositories/*_repo.go` (pgx SQL) → `services/*_service.go` (logic) →
  `handlers/*.go` (Fiber). Cross-domain reads go through `MemoryService`.
- **Migrations:** sequentially numbered `.up.sql`/`.down.sql` pairs in `backend/migrations/`,
  applied by `backend/scripts/run-migrations.sh`. Migration **020** already exists for
  ingestion content hashes; new v2 migrations begin at **021**.
- **AGE graph:** one graph per universe (`universe_<uuid>`). All AGE access **MUST** route
  through `withAgeTx` / `withAgeConn` (search_path restoration). Identifiers from LLM output
  **MUST** pass `validCypherIdentifier`.

---

## 2. P0 — Entity Standard & Front Correctness

**Why this tier exists and why it precedes diagnosis:** entity extraction has been observed
producing ~130 entities of which the UI displays ~30, with half the type filters missing.
Until the front can faithfully display what the backend produced, end-to-end observations
are untrustworthy — a "broken analysis" report may be a broken *display*. Fix the ruler
before measuring.

### 2.1 Taxonomy migration (TX) — migration `021`

| ID | Priority | Requirement |
|---|---|---|
| **TX-1** | P0 | `Universe.Genre` (single `text`) **MUST** become `Universe.GenreTags` — a multi-valued, closed-vocabulary field (`text[]`, or a join table if referential integrity is preferred). |
| **TX-2** | P0 | The genre vocabulary **MUST** be closed and server-validated. Rejected values return `VALIDATION_ERROR`. The LLM **MUST NOT** be able to introduce a genre tag. |
| **TX-3** | P0 | `Universe.Format` **MUST** be removed. Format moves to `Work.Type`. |
| **TX-4** | P0 | `Work.Type` **MUST** be validated against the closed set `{novel, novella, short-story}`. It is currently an unvalidated free string. |
| **TX-5** | P0 | The `021` migration **MUST** carry a data migration: existing `Universe.Genre` → single-element `GenreTags`; existing `Universe.Format` → `Work.Type` for that universe's works, defaulting to `novel`. |
| **TX-6** | P0 | `021_taxonomy.down.sql` **MUST** restore the prior shape (first tag wins). |
| **TX-7** | P0 | Frontend: genre becomes a **multi-select** on universe create/edit; format becomes a **single select** on work create/edit. |

Removed formats: `screenplay`, `graphic-novel`, `poetry`, `essay`, `article` (PRD §2.2).

### 2.2 Entity taxonomy (ET) — migration `021`

Current state, verified:

- The extraction prompt (`qwen_service.go:283-288`) is the **only** definition of entity
  types in the system, and it produces: `character`, `place`, `event`, `faction`,
  `world_rule`, `plot_arc`. **`object` does not exist** — named things without agency
  (a sword, a ship) have no category and get misfiled.
- `EntitiesPage.tsx:22` filters on `object` (never produced) and `worldrule` (a
  misspelling of `world_rule` — that filter can never match a stored row).
- `graphParse.ts:24` carries a second, divergent copy of the type list.
- `entities.type` has **no CHECK constraint** (`005_create_entities.up.sql`); the DB
  accepts any string the model invents.

**Canonical vocabulary (closed, 7 types):**

| Type | Identification criterion |
|---|---|
| `character` | An agent with its own will that acts in the story — person, AI, sentient creature. If it decides, it is a character. |
| `place` | A location where scenes occur or that is referenced spatially. |
| `object` | A named thing with no will of its own (Excalibur, the *Rocinante*). Proper name + no agency = object. A ship someone pilots is an object; the pilot is a character. |
| `faction` | A group with collective identity: government, guild, crew, family, order. |
| `event` | A named occurrence with a temporal location: a war, a wedding, a catastrophe. |
| `world_rule` | A law of the universe: magic system constraint, physics, an established social norm. |
| `plot_arc` | A narrative thread spanning chapters, tracked for continuity analysis. |

| ID | Priority | Requirement |
|---|---|---|
| **ET-1** | P0 | The 7-type vocabulary above is **canonical and closed**. Every layer that names entity types **MUST** derive from it; no layer may carry its own divergent list. |
| **ET-2** | P0 | Migration `021` **MUST** add a `CHECK` constraint on `entities.type` restricted to the canonical set, with a data migration mapping any non-canonical existing values to the nearest canonical type. |
| **ET-3** | P0 | The extraction prompt **MUST** request `object` as a category, and **MUST** embed the identification criteria above so the model classifies by criterion, not intuition. When structured output lands (SO-1), the JSON Schema `enum` **MUST** carry exactly these 7 values. |
| **ET-4** | P0 | The frontend **MUST** have **one** module exporting the canonical list plus per-type display metadata (label, colour, glyph). `TYPE_FILTERS` (`EntitiesPage.tsx:22`) and `ENTITY_TYPES` (`graphParse.ts:24`) **MUST** be replaced by imports from it. |
| **ET-5** | P0 | `event` entities **MUST** continue feeding the timeline. Being an entity and appearing on the timeline are not exclusive — the timeline is a *view over* event entities, not a separate store. |

### 2.3 Entity browser (FE)

| ID | Priority | Requirement |
|---|---|---|
| **FE-1** | P0 | `TYPE_FILTERS.slice(0, 4)` (`EntitiesPage.tsx:205`) renders only 4 of 7 filter chips and silently discards the rest. **Every** canonical type **MUST** be selectable as a filter. |
| **FE-2** | P0 | Filter values **MUST** match stored values exactly (via the ET-4 shared module). The current `worldrule` chip filters against rows stored as `world_rule` and returns nothing. |
| **FE-3** | P0 | The entity list **MUST** display the total entity count and **MUST** let the user reach every entity (pagination or virtualised scroll beyond the current `limit: 200` request). "~130 extracted, ~30 visible" must be structurally impossible. |
| **FE-4** | P1 | Filter chips **SHOULD** show per-type counts, so a writer sees at a glance what the universe holds. |

### 2.4 Graph neighborhood view (GV)

The graph currently renders **every** entity in the universe at once; with real data it
degenerates into an unconnected ring. The fix is navigation, not layout tuning.

| ID | Priority | Requirement |
|---|---|---|
| **GV-1** | P0 | The graph **MUST NOT** render the full universe by default. The default view is a **focal node plus its neighborhood within 2 hops**. |
| **GV-2** | P0 | The default focal node is the **highest `relevance_score` active entity** — the decay engine already ranks importance; reuse it instead of inventing a hierarchy. |
| **GV-3** | P0 | Clicking any visible node **MUST** re-centre the neighborhood on it, so the writer walks the graph node by node. |
| **GV-4** | P0 | A search box **MUST** jump to any entity by name or alias, making it the focal node (Filip, Avasarala → their neighborhoods). |
| **GV-5** | P1 | Node emphasis (size or colour weight) **SHOULD** encode `relevance_score`; archived entities are hidden by default behind a toggle. |
| **GV-6** | P1 | A type filter over the 7 canonical types **SHOULD** narrow the visible neighborhood. |

### 2.5 Workspace layout (WS)

| ID | Priority | Requirement |
|---|---|---|
| **WS-1** | P0 | Side panels **MUST** be collapsible, so a writer can reduce the workspace to the editor plus live alerts. |
| **WS-2** | P0 | No panel may truncate its labels or icons at its default width. |
| **WS-3** | P1 | Panels **SHOULD** be resizable by dragging, with sizes persisted locally. |

---

## 3. P1 — Correctness of the Existing Core

### 3.1 Live paragraph analysis (LA)

The chain exists and is wired. It does not work. **Diagnosis precedes any rewrite.**

| ID | Priority | Requirement |
|---|---|---|
| **LA-1** | P1 | The failure **MUST** be reproduced and root-caused before code is changed. Reimplementing a wired-but-broken path is forbidden. |
| **LA-2** | P1 | `wsStore` **MUST** queue outbound messages while the socket is not `open`, and flush the queue on connect. A `paragraph_submit` **MUST NOT** be silently discarded. |
| **LA-3** | P1 | Paragraph submission **MUST** key off the **edited** paragraph, not the paragraph under the cursor at debounce expiry. `getParagraphAtCursor` (`TipTapEditor.tsx:189`) captures the caret position at fire time; if the caret moved, the wrong text is submitted. Capture the target node at edit time. |
| **LA-4** | P1 | The client **MUST** render a visible state for each analysis lifecycle stage (submitted → in progress → result / failed). A silent failure is indistinguishable from a slow success. |
| **LA-5** | P1 | The server **MUST** emit a terminal WS message for every submitted paragraph — success or failure. No submission may end in silence. |
| **LA-6** | P1 | `AnalysisService.SubmitParagraph`, `ws.Hub.handleParagraphSubmit`, and the `TipTapEditor` submit path **MUST** have test coverage. CodeGraph currently reports "no covering tests found" for all three. |

### 3.2 End-to-end verification (EE)

| ID | Priority | Requirement |
|---|---|---|
| **EE-1** | P1 | An automated E2E test **MUST** exist that: boots the stack, authenticates, creates a universe and chapter, types a paragraph, and asserts that an `analysis_result` arrives over the WebSocket with at least one extracted entity. |
| **EE-2** | P1 | An automated E2E test **MUST** ingest a fixture document and assert chapters, entities, and graph edges are created, and that `ingestion_progress` reaches a terminal state. |
| **EE-3** | P1 | The E2E suite **MUST** be runnable in one command and **MUST** be part of the definition of done. Unit and integration tests passing is **not** evidence that the assembled system works. |

---

## 4. P1 — Ingestion Performance

### 4.1 MAP / REDUCE split (IG)

| ID | Priority | Requirement |
|---|---|---|
| **IG-1** | P1 | Ingestion **MUST** be restructured into a parallel **MAP** phase and a serial **REDUCE** phase. |
| **IG-2** | P1 | **MAP** — per-chunk extraction of entity **mentions**. It **MUST** be stateless: no database writes, no entity resolution, no reads of prior chunks' results. It **MAY** run with bounded concurrency. |
| **IG-3** | P1 | **REDUCE** — resolution of mentions to entities (exact match → alias → fuzzy → semantic → create). It **MUST** execute single-threaded per universe. |
| **IG-4** | P1 | `EntityService.ResolveOrCreate` **MUST NOT** be called concurrently for the same universe. The observed "James" / "James Holden" duplication is a **write-write race**: concurrent resolvers cannot see each other's uncommitted writes and both create. Serialising REDUCE is the fix. |
| **IG-5** | P1 | As defence in depth, a **unique constraint** on the entity natural key **SHOULD** exist (migration `022`) so that a future concurrency bug fails loudly rather than duplicating silently. |

### 4.2 Throughput governance (TH)

| ID | Priority | Requirement |
|---|---|---|
| **TH-1** | P1 | Outbound LLM concurrency **MUST** be governed by a **token-rate limiter** (token bucket over **TPM**), not by a goroutine count. Grouping N paragraphs into one call reduces RPM but ships the same tokens; **TPM is the binding ceiling**. Use `golang.org/x/time/rate`. |
| **TH-2** | P1 | The limiter **MUST** also respect **RPM** (600 for both `qwen-max` and `qwen-turbo`) and **RPS = RPM/60**. Per-second bursts throttle even when the per-minute budget is unspent. |
| **TH-3** | P1 | The system **MUST** reserve a configurable share of quota (default **30%**) for **interactive** traffic. Rate limits are **account-level and shared across all API keys and workspaces**: an ingestion job **MUST NOT** starve a writer typing in the editor. Interactive requests take priority over ingestion requests. |
| **TH-4** | P1 | Concurrency **MUST** ramp smoothly rather than starting at full width. Qwen returns a distinct `429-Throttling.BurstRate` when the request rate *rises too quickly*, even below the limit. |
| **TH-5** | P1 | On `429`, the client **MUST** retry with **exponential backoff and jitter**. |
| **TH-6** | P2 | On sustained `429`, the client **SHOULD** fall back to a backup model rather than failing the job. |
| **TH-7** | P1 | Rate-limit configuration (RPM, TPM, reserved share, max concurrency, ramp) **MUST** be environment-configurable. |

### 4.3 Model tiering (MT)

| ID | Priority | Requirement |
|---|---|---|
| **MT-1** | P1 | Entity extraction (MAP) **MUST** use **`qwen-turbo`** — 5M TPM, 5× the headroom of `qwen-max`, cheaper, and sufficient for a stateless extract-names-and-types task. |
| **MT-2** | P1 | Contradiction detection, plot-hole detection, and craft review **MUST** use **`qwen-max`** — few calls, hard reasoning. |
| **MT-3** | P2 | Model choice per task **MUST** be configurable, not hard-coded. |

### 4.4 Performance targets (PF)

| ID | Priority | Requirement |
|---|---|---|
| **PF-1** | P1 | A ~400-page novel (~150k words) **MUST** complete ingestion in **≤ 5 minutes (p95)**. Stretch: ≤ 3 minutes. |
| **PF-2** | P1 | A ~50-page document **MUST** complete in **≤ 60 seconds**. |
| **PF-3** | P1 | Ingestion **MUST** emit `ingestion_progress` at least every 2 seconds while running. |
| **PF-4** | P2 | Ingestion **MUST** report an **ETA**, computed from measured throughput. The ETA **MUST NOT** be displayed before ~10% of chunks are complete, and **MUST** be smoothed (e.g. EWMA). An ETA extrapolated from two chunks swings wildly and reads as a broken system. |
| **PF-5** | P2 | The progress UI **MUST** show one bar plus **one live action message** ("Extracting entities from chapter 12…"), not a row of stage labels lighting up. |

---

## 5. P2 — Native DashScope Client

### 5.1 Protocol (DS)

| ID | Priority | Requirement |
|---|---|---|
| **DS-1** | P2 | A new `DashScopeService` **MUST** speak the **native DashScope HTTP protocol**: `POST {base}/api/v1/services/aigc/text-generation/generation`, request shape `{model, input:{messages}, parameters:{…}}`, response shape `{output:{choices[]}, usage:{input_tokens, output_tokens}}`. |
| **DS-2** | P2 | It **MUST** be hand-written in Go. **There is no Go DashScope SDK** — SDKs exist only for Python and Java (`Docs/QwenDocs/api-reference/preparation/02-install-sdk.md`). A Python sidecar is rejected: it would place a second runtime in the analysis hot path. |
| **DS-3** | P2 | It **MUST** support the existing tool-calling contract so `RunAgentLoop` (`qwen_service.go`) and `QuillExecutor` (`agent_tools.go`) work unchanged against it. |
| **DS-4** | P2 | It **MUST** parse and surface `usage.input_tokens` / `usage.output_tokens`, including **cached-token counts**, so cache effectiveness is measurable. |
| **DS-5** | P2 | Migration **MUST** be incremental and reversible: a config flag selects the OpenAI-compatible client or the DashScope client, so a regression can be rolled back without a redeploy. |
| **DS-6** | P2 | Base URL, model IDs, and timeouts **MUST** be environment-configurable. |

### 5.2 Context cache (CC)

| ID | Priority | Requirement |
|---|---|---|
| **CC-1** | P2 | Prompts for live analysis and craft review **MUST** be structured with a **stable prefix** (system instructions + active skill body + universe lore + entity context) followed by the variable suffix (the paragraph). Cache hits require prefix stability — prompt assembly **MUST NOT** reorder or reformat the prefix between calls. |
| **CC-2** | P2 | The stable prefix **MUST** be marked for **explicit context cache** (10% of standard input price, guaranteed hit for 5 minutes). |
| **CC-3** | P2 | Cache hit rate **MUST** be logged and exposed as a metric. An unverified optimisation is not an optimisation. |
| **CC-4** | P2 | Context cache **MUST NOT** be combined with Batch on the same request — the discounts are mutually exclusive. |

### 5.3 Structured output (SO)

| ID | Priority | Requirement |
|---|---|---|
| **SO-1** | P2 | Entity extraction **MUST** use **JSON Schema structured output**. The entity `type` field **MUST** be a schema `enum`, making an out-of-vocabulary type (e.g. a place classified as a character) structurally impossible. |
| **SO-2** | P2 | Relationship extraction **MUST** likewise constrain relationship types by enum. This composes with the existing `validCypherIdentifier` guard in `graph_repo.go`; it does not replace it. |
| **SO-3** | P2 | Schema violations **MUST** be logged with the offending payload, not silently dropped. |

### 5.4 Rerank (RR)

| ID | Priority | Requirement |
|---|---|---|
| **RR-1** | P2 | A rerank stage **MUST** be added **after** RRF fusion in `MemoryService.Recall`. RRF fuses **by rank position** and is semantically blind; a reranker reads the query and the content. |
| **RR-2** | P2 | Rerank **MUST** be optional and nil-safe, matching the existing pattern of `SetConsolidationRepo` / `SetBudgetMgr`. |
| **RR-3** | P2 | The improvement **MUST** be measured with the existing harness (`backend/eval/`, `TestMemoryEval`) — Recall@k, MRR, nDCG before and after. **A claimed improvement without a number does not go in the submission.** |
| **RR-4** | P2 | `RecallExplain` (`fuse_rrf_explain.go`) **MUST** be extended to expose the rerank delta per item, so the Memory Theater can show what rerank changed. |

### 5.5 Thinking mode (TK)

| ID | Priority | Requirement |
|---|---|---|
| **TK-1** | P3 | Contradiction and plot-hole detection **SHOULD** enable thinking mode. |
| **TK-2** | P3 | Reasoning content **MUST NOT** be persisted as user-visible analysis output; it is diagnostic. |

### 5.6 Batch (BA)

| ID | Priority | Requirement |
|---|---|---|
| **BA-1** | P3 | Batch **MAY** be used for **consolidation** and corpus-wide stylometry re-analysis. |
| **BA-2** | P0 | Batch **MUST NOT** be used for document ingestion or live analysis. Its SLA is *"usually within 24 hours"*, which is incompatible with a live progress bar and a 3-minute demo. |

---

## 6. P2 — Writer Memory

### 6.1 Data model — migration `024`

Three source tables plus a decay-history table. The split between measurable
observations and inferred intent is load-bearing (PRD §5.1).

**`writer_observations`** — verifiable facts about how the writer writes.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | Observations belong to the **user**, not the universe. |
| `universe_id` | uuid FK, nullable | The universe the evidence came from (nullable for corpus-wide). |
| `metric` | text | e.g. `mean_sentence_length`, `adverb_density`, `dialogue_ratio`, `lexical_richness`. Closed vocabulary. |
| `value` | numeric | |
| `sample_size` | int | Words or sentences measured. Confidence in a fact scales with sample size. |
| `computed_at` | timestamptz | |

**`writer_preferences`** — beliefs about the writer's intent.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `statement` | text | e.g. "Long sentences are deliberate." |
| `scope` | text | `universal` (a craft capability, travels everywhere) or `genre_bound`. |
| `genre_tags` | text[] | Non-empty iff `scope = genre_bound`. The conditioning key. |
| `confidence` | real | 0..1. |
| `relevance_score` | real | Decays. Mirrors the entity relevance model. |
| `lifecycle` | text | `active` / `archived`, mirroring entity lifecycle. |
| `embedding` | vector | For semantic recall. |
| `last_reinforced_at` | timestamptz | Drives decay. |
| `created_at` | timestamptz | |

**`writer_feedback_events`** — the raw evidence trail.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id`, `universe_id`, `chapter_id` | uuid FK | |
| `note_id` | uuid | The craft note this responds to. |
| `signal` | text | `accept` / `reject` / `behavioural_accept`. **Never `silent`** — see WM-6. |
| `preference_id` | uuid FK, nullable | The preference this event reinforced or contradicted. |
| `payload` | jsonb | Note text, paragraph before/after, skill that fired. |
| `created_at` | timestamptz | |

### 6.2 Behaviour (WM)

| ID | Priority | Requirement |
|---|---|---|
| **WM-1** | P2 | Passive stylometry **MUST** run with **zero LLM calls** — pure text analysis in Go. |
| **WM-2** | P2 | Stylometry **MUST** write **only** to `writer_observations`. It **MUST NOT** create or modify a `writer_preferences` row under any circumstance. This is the wall that prevents the system from fossilising the writer's vices by mistaking *what he does* for *what he wants*. |
| **WM-3** | P2 | An observation is **promoted** to a preference only when corroborated by an **intent signal** (`accept`, `reject`, or `behavioural_accept`). The promotion threshold **MUST** be configurable (default: 3 consistent signals). |
| **WM-4** | P2 | On promotion, the model **MUST** classify `scope` as `universal` or `genre_bound`, and, if genre-bound, attach the `genre_tags` it applies to. **This is a known failure point** (PRD §8): classifying "graphic violence" as a universal craft capability would contaminate a children's book. The classification **MUST** be visible and correctable by the writer. |
| **WM-5** | P2 | A promoted preference **MUST** suppress future craft notes that contradict it. If the writer rejected "split this long sentence" three times, the system **stops flagging long sentences**. This is the definition of *increasingly accurate decisions across sessions* — it is the point of the whole subsystem. |
| **WM-6** | P2 | A **silently dismissed** note **MUST NOT** be recorded as a rejection. Silence is noise, not intent. It is *absence of reinforcement* and is handled by decay alone. **No new code.** Treating silence as rejection is the fastest way to poison a profile. |
| **WM-7** | P2 | `behavioural_accept` **MUST** be inferred by comparing the paragraph before and after a note, within a bounded time window. False positives (the writer was rewriting anyway) **MUST** be weighted below an explicit `accept`. |
| **WM-8** | P2 | Preferences **MUST** decay using the **existing** `RelevanceService` engine (`DECAY_LAMBDA`, `ARCHIVE_THRESHOLD`), and **MUST** reactivate on reinforcement — the same mechanism entities use. No parallel decay implementation may be introduced. |
| **WM-9** | P2 | Preference decay/reactivation **MUST** append to a history table, mirroring `entity_relevance_history` (019), so the writer's profile can be plotted over time in the Memory Theater. |

### 6.3 Recall conditioning (RC)

| ID | Priority | Requirement |
|---|---|---|
| **RC-1** | P2 | Writer preferences **MUST** enter recall as an additional **RRF pipeline** in `MemoryService.RecallWithPipelines`, alongside vector / graph / recency / keyword / consolidated. |
| **RC-2** | P2 | The writer-preference pipeline **MUST** be **conditioned by the target universe's genre tags**: `universal`-scoped preferences always qualify; `genre_bound` preferences qualify only when their `genre_tags` intersect the universe's. |
| **RC-3** | P2 | Preferences **MUST** cross universes. A new universe **MUST NOT** start from an empty writer profile. |
| **RC-4** | P2 | `RecallExplain` **MUST** expose the writer-preference pipeline's contribution, like the other five. |
| **RC-5** | P2 | Writer preferences **MUST** participate in the existing `ContextBudgetManager` knapsack. They compete for the context window on equal terms with story memory — they are not exempt from the budget. |

### 6.4 Explainability (EX)

| ID | Priority | Requirement |
|---|---|---|
| **EX-1** | P2 | An endpoint **MUST** answer *"why do you believe this about me?"* for any preference: returning the originating observations, every feedback event, the resulting confidence, and the promotion decision. |
| **EX-2** | P2 | The writer **MUST** be able to **delete** or **override** a preference. It is a belief about them; they are the authority on it. |
| **EX-3** | P2 | Deleting a preference **MUST NOT** delete its feedback events — the evidence remains, the conclusion is retracted. |

### 6.5 Cold start (CS)

| ID | Priority | Requirement |
|---|---|---|
| **CS-1** | P2 | On ingestion of a writer's existing manuscripts, stylometry **MUST** produce observations for the whole corpus. A writer who uploads three manuscripts **MUST** have a profile on day one, without a single feedback event. |
| **CS-2** | P2 | A writer starting from nothing **MUST** be fully functional with an empty profile. The system **MUST NOT** invent preferences it has no evidence for. |

---

## 7. P2 — Skills

### 7.1 Format (SF)

| ID | Priority | Requirement |
|---|---|---|
| **SF-1** | P2 | A Skill is a Markdown file with YAML frontmatter: `name`, `description`, `genre_tags`, `stage`, and an instruction body. |
| **SF-2** | P2 | `description` is written **for the agent**, stating *when to use this skill*. It is the agent's selection criterion, not human documentation. Descriptions **SHOULD** lean slightly pushy — the observed failure mode is **under**-triggering. |
| **SF-3** | P2 | Skills are **read-only** at runtime. There is no user-facing edit path. |
| **SF-4** | P2 | Skills are versioned in the repository and loaded at boot. |
| **SF-5** | P2 | The catalogue is **15 skills**, defined in [SKILLS.md](./SKILLS.md): 7 editorial roles, 7 craft skills, and `genre-conventions`. |
| **SF-6** | P2 | `genre-conventions` **MUST** carry 20 reference files (one per genre tag) and **MUST** load only the files matching the universe's genre tags. Loading all twenty would defeat progressive disclosure. |
| **SF-7** | P2 | The genre vocabulary is the **20 closed tags** in [SKILLS.md §2](./SKILLS.md). |
| **SF-8** | P2 | `prose-economy` **MUST** consult active Writer Memory preferences and suppress notes that contradict a promoted preference (WM-5). It is the primary source of feedback signals and the primary beneficiary of them. |
| **SF-9** | — | There is deliberately **no continuity/consistency skill.** That is the memory pipeline's job. |

### 7.2 Activation and selection (SS)

| ID | Priority | Requirement |
|---|---|---|
| **SS-1** | P2 | Skills are activated at the **universe** level. Migration `025` adds the universe↔skill association. |
| **SS-2** | P2 | On universe creation, the system **SHOULD** pre-suggest skills whose `genre_tags` intersect the universe's genre tags. |
| **SS-3** | P2 | When a craft review is requested, the **agent MUST select** which of the active skills apply to the passage, by reasoning over the `description` fields alone. |
| **SS-4** | P2 | Selection **MUST** use **progressive disclosure**: only the `description` lines enter the selection prompt; only the selected skill's **full body** is then loaded into the review prompt. This is the token optimisation; loading every active skill body would defeat it. |
| **SS-5** | P2 | The response **MUST** report which skills fired, so the UI can show it. |
| **SS-6** | — | Per-chapter skill overrides are **out of scope**. |

### 7.3 Craft review (CV)

| ID | Priority | Requirement |
|---|---|---|
| **CV-1** | P2 | Craft review is invoked **only** by explicit user action over a selected range (paragraph, block, or chapter). There **MUST NOT** be an idle-triggered or automatic craft review. |
| **CV-2** | P2 | Output **MUST** be margin observations anchored to text ranges. |
| **CV-3** | P2 | The system **MUST NOT** rewrite the author's prose. No diff of "how I would have written it", no generated replacement paragraph. |
| **CV-4** | P2 | Each note **MUST** be attributable to the skill that produced it. |
| **CV-5** | P2 | Each note **MUST** carry accept / reject affordances, which emit `writer_feedback_events` (§5.1). |
| **CV-6** | P2 | Notes **MUST** be suppressed when they contradict an active promoted preference (WM-5). |

---

## 8. P3 — Editor

### 8.1 Entity highlighting (EH)

| ID | Priority | Requirement |
|---|---|---|
| **EH-1** | P3 | Known entity names and aliases **MUST** be highlighted client-side, with **zero LLM calls**. A local match against the known-entity set is sufficient; the AI already did its work at extraction time. |
| **EH-2** | P3 | Highlight colour **MUST** be consistent per entity — an alias highlights in the same colour as its canonical entity. |
| **EH-3** | P3 | Highlighting **MUST NOT** measurably degrade typing latency. |
| **EH-4** | P3 | Clicking a highlight **MUST** open that entity's context. |

### 8.2 Entity candidates (EC)

| ID | Priority | Requirement |
|---|---|---|
| **EC-1** | P3 | Extraction **MUST** produce **candidates**, not committed entities. The AI proposes; the human confirms. |
| **EC-2** | P3 | Candidates **MUST** surface as a discreet underline with an inline affordance. **No modals, no pop-ups.** |
| **EC-3** | P3 | Bulk ingestion **MUST** gate by **confidence**: above threshold → auto-accept; below → **review tray**. |
| **EC-4** | P3 | The **review tray MUST** exist. It is the destination of the low-confidence bucket the gate creates; without it, confidence-gating is unimplementable — the system would either discard memory or auto-accept everything, and the gate would be decorative. |
| **EC-5** | P3 | The confidence threshold **MUST** be configurable. |
| **EC-6** | P3 | Tray decisions **MUST** be recorded as learning signals. |

### 8.3 Import fidelity and durability (ID)

| ID | Priority | Requirement |
|---|---|---|
| **ID-1** | P3 | Ingested chapters **MUST** preserve paragraph structure, italics, and scene breaks, and **MUST** load into the editor as formatted content — not the current plain-text dump. |
| **ID-2** | P3 | Autosave **MUST** retry on failure with backoff. |
| **ID-3** | P3 | The editor **MUST** show an honest save state: saving / saved / **failed**. A silent save failure is a data-loss event with a green checkmark. |
| **ID-4** | P3 | Unsaved content **MUST** survive a page reload (local persistence). **Quill is the source of truth; losing a chapter kills the product.** |
| **ID-5** | P3 | **Markdown export MUST** exist per chapter and per work. Without export, the product is a trap and no serious author will adopt it. |
| **ID-6** | — | DOCX export is roadmap. PDF export is rejected. |

---

## 9. P3 — Quill as an MCP Server

| ID | Priority | Requirement |
|---|---|---|
| **MC-1** | P3 | Quill **MUST** expose an MCP server surfacing the memory subsystem. |
| **MC-2** | P3 | It **MUST** reuse the existing tool implementations from `agent_tools.go` (`search_vector_memory`, `query_entity_graph`) plus `MemoryService.Recall`. **No new retrieval logic.** These tools already run in production against the internal agent. |
| **MC-3** | P3 | Tools **MUST** be scoped to a universe the authenticated user owns. Cross-tenant reads are a security failure. |
| **MC-4** | P3 | Authentication **MUST NOT** be weaker than the HTTP API's. |
| **MC-5** | P3 | Notion MCP consumption (worldbuilding-bible ingestion) is P3. OAuth per user is the cost driver. |
| **MC-6** | P3 | Wikipedia MCP consumption is P3 and **MUST** degrade gracefully: if the server is unreachable, the craft review completes **without** it. It is the only external network dependency in the system and **MUST NOT** be able to fail a review. |

---

## 10. Non-Functional Requirements

| ID | Priority | Requirement |
|---|---|---|
| **NF-1** | P0 | No AGE-touching code may run raw `LOAD 'age'` / `SET search_path` on a pooled connection. All access routes through `withAgeTx` / `withAgeConn`. |
| **NF-2** | P0 | All LLM-derived identifiers used in Cypher **MUST** pass `validCypherIdentifier`. Structured output (SO-1/SO-2) narrows the input; it does not remove the guard. |
| **NF-3** | P0 | Every new migration **MUST** ship a working `.down.sql`. |
| **NF-4** | P2 | Token usage per operation **MUST** be logged (input, output, cached) so cost claims are measurable rather than asserted. |
| **NF-5** | P2 | The API key **MUST** be read from the environment and **MUST NOT** be logged. |
| **NF-6** | P2 | An ingestion job failure **MUST** be recorded with its cause and surfaced to the user. Silent failure is forbidden. |
| **NF-7** | P3 | All new UI **MUST** follow `design.md` (manuscript-modern palette, inline SVG, no charting library). |

---

## 11. Verification Plan

| Claim | How it is proven |
|---|---|
| No entity has a non-canonical type | **ET-2** — the `CHECK` constraint makes the claim structural; a repo test asserts an invalid type is rejected. |
| The UI shows everything the backend extracted | **FE-1/FE-3** — a component test asserts all 7 filter chips render and the displayed total equals the API total. |
| Live analysis works | **EE-1** — E2E test, not a unit test. |
| Ingestion is fast | **PF-1/PF-2** — timed run against a real 400-page fixture. |
| No duplicate entities | Concurrency test over the MAP/REDUCE pipeline + the uniqueness constraint (IG-5). |
| Rerank improves recall | **RR-3** — Recall@k / MRR / nDCG, before and after, from `backend/eval/`. |
| Context cache saves tokens | **CC-3** — logged cache-hit rate and token counts, before and after. |
| The agent gets more accurate | **WM-5** — a test that rejects a note three times and asserts the note is no longer emitted. |
| Memory is auditable | **EX-1** — the evidence trail endpoint returns observations, events, and confidence. |

**Nothing in the submission may claim an improvement that is not backed by one of these numbers.**
