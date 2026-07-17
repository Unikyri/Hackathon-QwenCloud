# Sprint 7 submission checklist

Use this as the final handoff checklist. Do not mark external evidence complete until it is
publicly reachable and reviewed by a human.

## Required submission evidence

- [ ] Publish the application on Qwen Cloud / Alibaba Cloud and record the public URL.
- [ ] Open that URL in an incognito browser and verify the demo remains reachable.
- [ ] Link the public source repository and its explicit license file.
- [ ] Attach an architecture diagram or a short architecture walkthrough that identifies the
  React client, Go/Fiber API, PostgreSQL/pgvector/AGE, Qwen API, and WebSocket analysis path.
- [ ] Record a demo under three minutes: clone or reset the demo universe, write/import,
  observe analysis, inspect the map, recall lore, and review an issue.
- [ ] Attach Qwen Cloud / Alibaba deployment evidence and Qwen API configuration evidence
  without exposing secrets.
- [ ] Attach OpenAI Codex / GPT-5.6 usage evidence and the required session ID. This is a
  manual submission artifact; application code and UI tests cannot create it.

## Local judge-proof evidence

- [x] `cd frontend && npm run build` passed on 2026-07-17. The current build emits a separate
  `KnowledgeGraphPage-Dz9yI3_a.js` artifact (585.26 kB; 181.27 kB gzip); the entry bundle is
  272.33 kB (84.93 kB gzip).
- [x] Playwright Sprint 7 proof passed 10/10 on desktop Chromium and Pixel 5: guided real routes,
  failure/retry feedback, keyboard focus/reduced motion, axe WCAG A/AA checks, and lazy graph
  loading.
- [ ] Review the Vite warning for the isolated graph chunk exceeding 500 kB before submission; the
  browser proof confirms lazy loading, but the warning is still present.

## Re-run before submission

```bash
cd frontend
npm run build
npm run test:e2e -- --grep 'Sprint 7'
rg --files dist/assets | rg 'KnowledgeGraphPage-.*\\.js$'
```

The Playwright runner uses Chromium and starts a local preview server. On a new machine, install
the browser first with `npx playwright install chromium`.

## Submission caveats

- Keep API keys, tokens, and private prompt material out of recordings, screenshots, and commits.
- Local browser mocks are confined to Playwright request boundaries; they are not runtime demo
  data and do not establish that a deployed backend is available.
