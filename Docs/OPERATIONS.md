# Operations and release checks

Quill ships a deliberately small, in-process observability surface. It does not
claim to provide external monitoring, alert delivery, retention, or tracing.
Counters reset on a backend restart; compare two `/api/v1/status` snapshots to
inspect a short operating window.

## Safe signals

- `GET /api/v1/health` checks PostgreSQL, AGE, pgvector, Qwen reachability,
  disk free space, and uptime. Treat a `503` as unhealthy or degraded.
- `GET /api/v1/status` returns aggregate request counts and average/max latency,
  plus bounded `graph_http`, `ws_handshake`, and `analysis_enqueue` signals. It
  contains no user IDs, route parameters, request bodies, query strings, tokens,
  API keys, or error text.
- Every HTTP response carries `X-Request-ID`. Backend events are JSON lines with
  only request ID, method, route template, status, duration, and outcome.
- `analysis_enqueue` measures only the synchronous handoff from WebSocket to the
  per-work analysis queue. It is not an end-to-end analysis duration. Existing
  `analysis_failed` WebSocket messages remain the truthful terminal failure
  signal for asynchronous analysis.

For a manual five-minute sample, calculate:

`server error rate = (new server_errors / new total) * 100`

## Triage thresholds

| Signal | Investigate when | First response |
| --- | --- | --- |
| HTTP server errors | Any increase during a demo, or 2%+ over five minutes | Capture the request ID, inspect the matching JSON event, then check `/health` before retrying. |
| Overall HTTP latency | Average 750 ms+ or max 3 s+ over five minutes | Compare graph and WebSocket sub-signals; check database/Qwen health and reduce concurrent demo actions. |
| `graph_http` | Any server error, average 1 s+, or max 3 s+ | Check AGE and pgvector in `/health`; reproduce with the focused graph endpoint before changing Cypher. |
| `ws_handshake` | Any server error or failed upgrade during a demo | Confirm `QUILL_WS_ENABLED`, origin policy, and the browser network upgrade; do not inspect message bodies or tokens. |
| `analysis_enqueue` | Any server error or average 100 ms+ | The queue boundary is unavailable or contended; pause additional submissions and use the client’s existing failure/retry state. |

## Release checks

Run the focused backend proof first, then the server build:

```bash
cd backend
go test ./internal/observability
go build ./cmd/server
```

With the stack running, verify a correlation ID is returned and the safe status
surface is readable:

```bash
curl -i http://localhost:8080/api/v1/health
curl -s http://localhost:8080/api/v1/status
```

## Current release warning

The Sprint 7 frontend build still emits Vite’s 500 kB warning for the isolated,
lazy-loaded Knowledge Graph chunk. The recorded 2026-07-17 build measured it at
585.26 kB (181.27 kB gzip), while the entry bundle remained 272.33 kB (84.93 kB
gzip). Lazy loading is proven, but the warning needs a deliberate pre-submission
review; it is not resolved by this backend observability slice. See the
[submission checklist](SUBMISSION-CHECKLIST.md) for the current build evidence.
