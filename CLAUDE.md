# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quill — an AI-powered writing IDE for creative writers with persistent memory. As a writer drafts chapters, the backend analyzes each paragraph in the background to extract entities, detect contradictions against established lore, flag plot holes, and validate timeline consistency, pushing results to the editor live over WebSocket.

- **Backend**: Go 1.22 (Fiber v2.52.x) + PostgreSQL 16 (pgvector + Apache AGE graph extension)
- **Frontend**: React 18 + Vite + TypeScript, TipTap (editor), React Flow (graph viz), Zustand (state)
- **AI**: Qwen Cloud API (qwen-max / qwen-turbo for generation, text-embedding-v3 for embeddings), OpenAI-compatible endpoint

## Commands

### Running the stack
```bash
cp .env.example .env        # then set QWEN_API_KEY
docker compose up -d        # postgres + migrations + backend + frontend
```
- Backend only: `cd backend && go run cmd/server/main.go` (needs Postgres reachable via `DATABASE_URL`)
- Frontend only: `cd frontend && npm run dev` (Vite dev server on :3000, proxies `/api` to `localhost:8080`)
- DB only: `docker compose up postgres`
- Migrations are plain numbered `.up.sql`/`.down.sql` pairs in `backend/migrations/`, applied by `backend/scripts/run-migrations.sh` (tracked in a `schema_migrations` table). There is no migration CLI/tool — add a new sequentially-numbered pair to add schema changes.

### Backend (from `backend/`)
- Build: `go build ./...`
- Run all tests: `go test ./...`
- Run a single package: `go test ./internal/services/...`
- Run a single test: `go test ./internal/services/ -run TestName`
- Integration tests (repository/handler tests touching Postgres) require `TEST_DATABASE_URL` to be set; without it they call `t.Skip` (see `internal/testutil/db.go`). Point it at a Postgres instance with `pgvector` + `age` extensions available — `docker compose up postgres` provides one.
- `testutil.RunMigrationsUpTo` tears down and reapplies migrations per test run, and skips migration `014` automatically if the AGE extension isn't loaded on the target DB.

### Reproduction

- Full memory evaluation harness (needs Postgres + AGE, and `QWEN_API_KEY` for semantic recall/consolidation tests):  
  `TEST_DATABASE_URL=postgres://quill:quill_dev_password@localhost:5432/quill?sslmode=disable QWEN_API_KEY=your_key go test ./backend/eval/ -run TestMemoryEval -v`
- Metrics-only smoke tests (no DB):  
  `go test ./backend/eval/ -run 'TestRecall|TestPrecision|TestMRR|TestNDCG' -v`

### Frontend (from `frontend/`)
- Dev server: `npm run dev`
- Build (typecheck + build): `npm run build`
- Tests: `npm run test` (vitest run), `npm run test:watch` for watch mode
- Run a single test file: `npx vitest run src/path/to/File.test.tsx`

## Architecture

### Request flow / composition root
Everything is wired by hand in `backend/cmd/server/main.go` — no DI framework. Read it first when tracing how a feature connects end to end: repositories → services → handlers → Fiber routes. Note the two-phase init for circular deps: `ws.NewHub` is constructed with a `nil` submitter, `AnalysisService` is built (which needs the hub), then `hub.SetSubmitter(analysisSvc)` wires it back.

### The analysis pipeline (core feature loop)
This is the part that spans the most files and is the most important thing to understand:
1. Frontend submits a paragraph over WebSocket (`paragraph_submit`, see `frontend/src/stores/wsStore.ts` / `useWS.ts`) or via the debounced editor.
2. `ws.Hub` (`backend/internal/ws/hub.go`) receives it and calls into `AnalysisService.SubmitParagraph`.
3. `AnalysisService` (`backend/internal/services/analysis_service.go`) runs **one goroutine per work with a sequential per-work queue** (not a worker pool) so paragraphs from the same work are analyzed in order. It fans out to `EntityService`, `ContradictionService`, `RelevanceService`, `TimelineService`, `PlotHoleService`.
4. Results are pushed back to the client via `hub.SendToUser` using typed WS messages defined in `backend/internal/ws/protocol.go` (`analysis_result`, `contradiction_alert`, `entity_discovered`, `graph_updated`, `ingestion_progress`, etc.).
5. Entities/relationships also get written into an Apache AGE graph, one graph per universe named `universe_<universeUUID>` (see `graph_repo.go`) — graph names are UUID-derived so they're injection-safe by construction, but property values interpolated into Cypher strings are escaped via `escapeCypherString` (AGE doesn't support parameterized queries inside `$$ $$` Cypher blocks — this is a known sharp edge, see `Docs/Phase5-MiniADK.md` §7).

### Mini ReAct agent (`QwenService.RunAgentLoop` + `QuillExecutor`)
Contradiction/plot-hole/timeline checks aren't single-shot prompts — they run a small tool-calling agent loop:
- `QwenService` (`backend/internal/services/qwen_service.go`) implements OpenAI-style function calling and a `RunAgentLoop` that lets the model call tools, feeds results back as `role: "tool"` messages, and loops (capped depth) until the model stops calling tools.
- `QuillExecutor` (`backend/internal/services/agent_tools.go`) is the `ToolExecutor` implementation, dispatching by tool name via a plain switch (only two tools, so no registry): `search_vector_memory` (embeds the query, does pgvector similarity search over paragraph embeddings) and `query_entity_graph` (resolves an entity name to ID, then walks the AGE graph for neighbors/relations).
- Full rationale and expected prompts for this design are in `Docs/Phase5-MiniADK.md` — read it before modifying the agent loop or adding new tools.

### Memory / relevance model
`RelevanceService` implements a decay model (`DECAY_LAMBDA`, `ARCHIVE_THRESHOLD` config) that scores entities by recency of mention, archiving background entities and reactivating them if referenced again — this is what lets `PlotHoleService` distinguish "character quietly wrote out of the story" from "character abandoned mid-arc" (see the Phase5 doc §4 for the exact heuristic).

### Data model layering
Each domain (`universe`, `work`, `chapter`, `entity`, `contradiction`, `timeline_event`, `plot_hole`, `ingestion_job`) follows the same three-layer shape: `repositories/*_repo.go` (raw pgx SQL) → `services/*_service.go` (business logic, orchestrates repos + Qwen) → `handlers/*.go` (Fiber HTTP handlers). Cross-domain reads (e.g. graph + vector + entity together) go through `MemoryService` rather than handlers reaching into multiple repos directly.

### Document ingestion
`IngestionService` is a separate async pipeline (own goroutine per job) from the live analysis queue: parses uploaded `.md`/`.txt`, splits into chapters by Markdown headers, chunks into paragraphs, runs entity extraction + embeddings + graph population, and streams `ingestion_progress` over the same WS hub.

### Frontend state
Zustand stores in `frontend/src/stores/` mirror backend domains (`authStore`, `universeStore`, `editorStore`, `graphStore`, `wsStore`). `wsStore` owns the single WebSocket connection and dispatches incoming typed messages (matching `ws/protocol.go`'s `Type*` constants) out to the other stores — check `wsStore.ts` when adding a new server→client message type, both the Go constant and the frontend switch need updating together. `lib/api.ts` is a thin fetch wrapper injecting the JWT from `localStorage`.

### Design language
`design.md` documents a strict "ancient manuscript" visual system (ink/paper palette only, serif titles, GSAP/ScrollTrigger scroll-driven animations, no modern flat-UI affordances) — consult it before touching UI components or adding colors/animations, since it constrains palette and motion choices project-wide.

## Notes
- `.env.example` is used as the template referenced in the README's quick start; when editing it keep placeholder-style values (it is committed to git).
