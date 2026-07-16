# Sprint 5 — Skills & Craft Review

**Tier:** P2 · **SRS coverage:** SF (format/loading), SS (activation/selection), CV (craft review)
**Prerequisite:** Sprint 0 (genre tags — skill suggestion filters by them), Sprint 4
(craft review must consult writer preferences for suppression; note decisions must land
as feedback events).

**Content is DONE — do not re-author it.** All 15 skill bodies and all 20 genre reference
files exist in `backend/skills/` (35 files) with final frontmatter
(`name`, `description`, `genre_tags`, `stage`). This sprint builds the machinery that
loads, selects, and applies them. Catalogue and design rationale: `Docs/SKILLS.md`.

**Two design invariants (from the PRD, non-negotiable):**
- Skills produce **margin observations**. No skill ever rewrites the author's prose.
- Selection is **agent-automatic** via progressive disclosure — the writer activates
  skills per universe; the agent picks which apply to a given review.

---

## Task 5.1 — Skill loading and registry (SF)

**Files:** new `backend/internal/services/skill_service.go` (+ tests); `backend/skills/`
mounted read-only into the container (add to `docker-compose` volume + Dockerfile COPY)

**Steps:**

1. On startup, scan `backend/skills/*/SKILL.md`, parse YAML frontmatter
   (`name`, `description`, `genre_tags`, `stage`) + body. Fail loudly on malformed
   frontmatter — the catalogue is curated, a parse error is a build bug, not user input.
2. In-memory registry: `name → {frontmatter, body, references}`. Skills are read-only
   and user-invisible as files; no DB rows for content, no reload endpoint (redeploy = reload).
3. **Genre references:** for `genre-conventions`, also index
   `backend/skills/genre-conventions/references/*.md` by tag name — the 20 files map 1:1
   onto the genre vocabulary. Validate that mapping at startup (a tag without a reference
   file, or vice versa, fails the boot — cheap drift detection).
4. `GET /skills` returns the catalogue (frontmatter only — bodies never leave the server
   whole; they go into prompts, not to the client).

**Expected result:** boot logs "15 skills loaded, 20 genre references"; a malformed
fixture skill in a test makes loading fail with a precise error.

---

## Task 5.2 — Migration `025`: universe↔skill activation (SS)

**Files:** `backend/migrations/025_universe_skills.up.sql` / `.down.sql`; universe handler/service

**Steps:**

1. `universe_skills (universe_id uuid FK, skill_name text, activated_at timestamptz,
   PRIMARY KEY (universe_id, skill_name))`. `skill_name` validated against the registry
   at write time (the registry is the closed vocabulary; no CHECK constraint since the
   list lives in files, not SQL).
2. Endpoints: `GET/PUT /universes/:id/skills` (the PUT replaces the activation set).
3. Frontend: a skills panel in universe settings — name, description, toggle. Group by
   role (editorial roles / craft / genre) per the SKILLS.md catalogue order.
4. Sensible default for new universes: activate the seven editorial-role skills +
   `genre-conventions`; craft skills opt-in. (A judge's fresh universe should produce
   reviews without configuration.)

**Expected result:** activation persists per universe; deactivated skills never fire.

---

## Task 5.3 — Agent selection via progressive disclosure (SS)

**Files:** `skill_service.go` (selection), craft-review service (Task 5.4)

**Steps:**

1. **Stage 1 — cheap selection:** one `qwen-turbo` call whose prompt contains only the
   **frontmatter descriptions** of the universe's *active* skills (this is why every
   description was written as a trigger contract) plus the review request + passage
   summary. Structured output: `{selected: [skill_name, …]}` constrained by enum to the
   active set. Cap selection at ~3 skills per review — more produces noise, and the
   skill bodies' calibration sections assume focused application.
2. **Stage 2 — load winners only:** the selected skills' full bodies go into the review
   prompt. For `genre-conventions`, attach only the reference files whose tags intersect
   the universe's `genre_tags`.
3. This is the progressive-disclosure economics: 15 descriptions ≈ a few hundred tokens
   always; full bodies (thousands) only for winners. With Sprint 3's context cache, the
   selected bodies join the stable prefix.
4. Log which skills were selected and why (the model's one-line rationale) — feeds CV
   transparency (Task 5.4) and the demo.

**Expected result:** a dialogue-heavy passage review selects `dialogue-and-voice` (and
not `worldbuilding-and-exposition`); the selection call costs turbo-tier tokens only.

---

## Task 5.4 — Craft review: on demand, margin-only (CV)

**Files:** new `backend/internal/services/craft_review_service.go`; WS protocol message
(`craft_review_result`); editor UI (selection → request → margin notes)

**Steps:**

1. **Trigger contract:** the writer selects a passage and requests a review. If they do
   not ask, the AI does nothing. There is no background craft analysis — that autonomy
   belongs to the memory pipeline (contradictions/plot holes), not to style opinions.
2. Flow: passage + context → skill selection (5.3) → review prompt = selected skill
   bodies + genre references + relevant lore recall + **active writer preferences**
   (Sprint 4) → `qwen-max` → structured output: a list of margin notes
   `{skill, quote, note, severity}`.
3. **Suppression (the Sprint 4 contract):** note categories the writer has rejected are
   suppressed before emission. The prompt also instructs against re-raising them — but
   the filter is code, not hope.
4. **Never prose (CV invariant):** notes must not contain rewritten versions of the
   author's sentences. Enforce in the prompt (the skill bodies already carry
   "What you do NOT do") **and** with a cheap output check: a note whose text overlaps
   the quote at high similarity is dropped and logged.
5. **Transparency:** the result names which skills fired and why (selection rationale
   from 5.3). This is Success Criterion 3 — "sees which skills fired and why".
6. **Feedback loop:** each note carries accept/dismiss affordances in the margin UI;
   decisions POST as `writer_feedback_events` (Sprint 4 Task 4.3 ingests them). This
   closes the loop: review → reject → learn → stop repeating.
7. Margin UI per `design.md`: notes in a right-margin rail anchored to the quoted span;
   discreet, dismissible, no modals.

**Expected result:** select a passage → notes appear in the margin, attributed to skills,
never rewriting prose; dismissing a note three times (across reviews) makes that note
category disappear — the full Sprint 4 + 5 demo loop.

---

## Task 5.5 — End-to-end proof

**Steps:**

1. E2E addition: activate skills → select passage → request review → assert margin notes
   arrive attributed to ≥1 expected skill; reject a note; repeat the review; assert the
   category is suppressed.
2. Unit: selection returns only active skills (enum constraint test); genre reference
   attachment intersects tags correctly; the prose-overlap guard drops a synthetic
   rewriting note.

---

## Definition of done

- [ ] 15 skills + 20 references load from `backend/skills/` at boot with validation; catalogue endpoint serves frontmatter only.
- [ ] Migration `025` up/down clean; per-universe activation with sane defaults.
- [ ] Two-stage selection: descriptions-only turbo call, bodies loaded for winners only, genre references filtered by universe tags.
- [ ] Review is on-demand, margin-only, skill-attributed, preference-suppressed; the no-rewrite guard is code.
- [ ] Note decisions land as feedback events; the reject-three-times loop works end to end.
- [ ] `make e2e` green, including the new review scenario.
