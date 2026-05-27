# SQL Curator

A BigQuery SQL generation tool. Takes ambiguous Jira stories, uploaded files, or free-text requirements and produces production-grade BigQuery SQL with a structured Source-to-Target Map (STM) and bridge-owned validation warnings.

**Scope is SQL generation only.** Legacy-SQL conversion, dialect translation, and rewrite tasks are out of scope and refused. Designed to keep moving when inputs are incomplete: every inference is recorded with evidence and confidence; user feedback (clarification answers, regeneration reasons) becomes context for the next pass.

For day-to-day operations, see [`RUNBOOK.md`](RUNBOOK.md). For Claude's operating contract, see [`skills/generator.md`](skills/generator.md).

---

## Architecture at a glance

```
Browser ── HTTPS ──▶ Next.js (port 3000) ──▶ claude-bridge (port 3001)
                                                     │
                                                     │ spawn
                                                     ▼
                                              Claude CLI (-p, stream-json)
                                                     │
                                                     ▼
                                         MCP servers: Jira • BigQuery • GitHub
```

The browser never talks to MCP servers directly. Every external action flows through `claude-bridge`, which orchestrates Claude CLI sessions, parses their stream-json output, emits SQL artifacts, and surfaces bridge-owned validation results.

---

## Repository layout

```
src/                              Next.js frontend (TypeScript, App Router)
  app/                            Pages and API route handlers
  components/split/               Three-pane workspace UI
  lib/                            Shared types, SSE client, target-scope rules
  stores/                         Zustand app state

mini-services/claude-bridge/      Node.js HTTP/SSE bridge
  index.js                        HTTP server + claude-session orchestration
  config.js                       Env loader, range-checked, fail-fast
  logging.js                      pino-backed leveled logger
  metrics.js                      Counters, gauges, bucketed histograms
  request-validation.js           Schema-driven request validator
  activity.js                     Activity Feed event normalisers
  tool-helpers.js                 MCP tool_result parsers
  output-parsers.js               Extractors over Claude's text output
  structural-checks.js            L2 deterministic SQL ↔ STM checks
  tests/                          node --test unit tests
  .env.example                    Every env var the bridge consumes

skills/generator.md          Claude's operating contract (loaded into
                                  every session). Specifies the canonical
                                  S01–S13 stage SOP, output contract, and
                                  the bridge validation layers.

AGENTS.md                         Coding-agent instructions for this repo
RUNBOOK.md                        Operational runbook (deployment + ops)
```

---

## Validation

The bridge validates every SQL generation through three layers. SQL is emitted to the UI whenever Claude returns a fenced SQL block. If validation fails or cannot complete, the UI shows a warning and Jira completion is skipped.

| Layer | What it checks | Verdict source | LLM in verdict? |
|---|---|---|---|
| **L1 — Executional** | Did an observed BigQuery dry-run/read return an error? | Raw `tool_result.is_error` from any main-session dry-run/read call; `not_run` when S11 stays logical-only | No |
| **L2 — Structural** | Does the SQL implement what the STM declared? Target column coverage, source table coverage, target object match, output schema vs STM types | Mechanical SQL ↔ STM comparison in [`structural-checks.js`](mini-services/claude-bridge/structural-checks.js) | No |
| **L3 — Semantic/Repair** | Does the STM cover every acceptance criterion, are confidence claims sound, and does SQL implement the STM? | Fresh Claude session given requirements, SQL, STM, inferences, decisions, and scope (no chat history or tools) | Yes — cold, independent, and allowed to return corrected SQL |

Claude's prose `validation.sqlChecks.status` is discarded and overwritten by the bridge-derived verdict before the UI sees it. The skill explicitly tells Claude this so it cannot influence validation by claiming success.

---

## Quickstart (local development)

### Prerequisites
| Requirement | Details |
|---|---|
| Node.js | 18+ (tested on 26) |
| Bun | [bun.sh](https://bun.sh) — package manager and dev server |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| MCP servers | Atlassian Rovo (Jira), Google Cloud BigQuery, GitHub — configured in `~/.claude.json` |

### Frontend
```bash
bun install
npm run dev                       # http://localhost:3000
```

### Bridge
```bash
cd mini-services/claude-bridge
cp .env.example .env              # edit if needed; all values have defaults
npm install                       # installs pino
npm run dev                       # bun --hot index.js → http://localhost:3001
# or
npm start                         # node index.js
```

### Tests
```bash
cd mini-services/claude-bridge
npm test                          # node --test, no external services
```

---

## HTTP API

### `POST /chat`
Start an SQL-generation run. Response is Server-Sent Events.

**Headers**
- `Content-Type: application/json` (required)
- `Idempotency-Key: <8–128 chars [A-Za-z0-9_-]>` (optional) — within a 10-minute TTL, repeats are rejected with `409 REQUEST_IN_FLIGHT` or `REQUEST_ALREADY_COMPLETED`.

**Body** — see [`request-validation.js`](mini-services/claude-bridge/request-validation.js) for the validated schema and error codes.

**Error envelope** — every 4xx/5xx returns:
```json
{ "error": { "code": "BQ_PROJECT_FORMAT", "message": "...", "field": "bqProjectId" } }
```

### `GET /health`
Layered status. Returns 200 when Claude CLI is reachable, 503 otherwise. Reports `ready` / `claude_not_found` / `degraded_capacity` / `recent_errors`. Full schema in [`RUNBOOK.md`](RUNBOOK.md#health-endpoint).

### `GET /metrics`
JSON snapshot of counters, gauges, and bucketed-histogram timings. Notable series:

- `requests_total{endpoint,taskType}` — incoming volume
- `request_duration_ms{endpoint}` — histogram, buckets 50ms → 5min
- `validation_layer_result{layer,status}` — L1 / L2 / L3 pass-fail-warning counts
- `claude_sessions_aborted{reason}` — `client_disconnect` / `pre_aborted`
- `auto_retry_attempts{reason}`, `idempotency_collision{state}`, `stream_buffer_overflow{accumulator}`

### `DELETE /session/:id`
Clears the in-memory session map for a given id.

---

## Configuration

Everything is environment-driven and validated at startup. Malformed values throw with an aggregated error report instead of letting the bridge boot in a half-configured state.

See [`.env.example`](mini-services/claude-bridge/.env.example) for the complete annotated list. The most-touched variables:

| Variable | Default | Purpose |
|---|---|---|
| `BRIDGE_PORT` | `3001` | HTTP listener port |
| `CLAUDE_MAX_TURNS` | `25` | Tool-use turns per main session |
| `CLAUDE_TIMEOUT_MS` | `1200000` | Wall-clock cap per session (20 min) |
| `CLAUDE_MAX_CONCURRENT` | `3` | Concurrent in-flight bridge requests |
| `SQL_CURATOR_L3_COVERAGE_CHECK` | `true` | Enable the L3 cold semantic-coverage session |
| `SQL_CURATOR_L3_TIMEOUT_MS` | `45000` | Cold-session timeout (ms) |
| `SQL_CURATOR_DEFER_JIRA_COMPLETION` | `true` | Two-pass Jira ordering — comment + transition run after validation passes |
| `SQL_CURATOR_LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `SQL_CURATOR_LOG_PRETTY` | `false` | Switch to `pino-pretty` single-line output for dev |
| `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` | `8388608` | Bounded buffer on stream accumulators (overflow aborts the session) |

---

## Operational concerns

- **Logging** — pino-backed structured JSON to stdout. Every per-request log line carries `requestId`, `sessionId`, `component`, and `phase`. The bridge echoes `requestId` in the `X-Request-Id` response header. Grep one run end-to-end with `requestId=<id>`.
- **Client disconnect** — bridge watches `req.on('close')` and aborts the spawned Claude tree via `AbortController`. Windows uses `taskkill /T` to take down the MCP subtree; POSIX uses SIGTERM → SIGKILL escalation. A disconnect during an in-flight run does not orphan the child process.
- **Graceful shutdown** — SIGTERM / SIGINT / SIGHUP all run `gracefulShutdown` which reaps every tracked child before exit. `process.on('exit')` is a final-line-of-defence sweep. `uncaughtException` logs fatal, reaps children, and exits non-zero so a supervisor restarts cleanly.
- **Idempotency** — clients submitting an `Idempotency-Key` header get protection against double-submit. Within a 10-minute TTL, the same key returns 409 instead of spawning a duplicate Claude session.
- **Bounded buffers** — stream accumulators capped at `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` (default 8 MB). A runaway MCP response that exceeds the cap aborts the session with an explicit error card instead of OOMing the bridge.

Full deployment, monitoring, and rollback procedures: [`RUNBOOK.md`](RUNBOOK.md).

---

## LAN access for colleagues

```bash
npm run dev:public
```

Bind the UI to all network interfaces so colleagues on the same network can connect. Share `http://<your-machine-IP>:3000`. Each user must have Claude Code CLI installed and authenticated with their own account.

---

## Contributing

- Run `npm test` in `mini-services/claude-bridge/` before committing.
- TypeScript checks: `node node_modules/typescript/bin/tsc --noEmit` from the repo root.
- Frontend changes that affect the UI: start the dev server and verify in a browser.
- Follow the commit message style in `git log` — short imperative title, structured body explaining the why.
- See [`AGENTS.md`](AGENTS.md) for coding-agent specific instructions.
