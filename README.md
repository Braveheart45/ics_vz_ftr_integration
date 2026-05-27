# SQL Curator

SQL Curator is a minimalist local UI over Claude Code for BigQuery SQL generation. It accepts Jira stories, plain-text file context, and free-text requirements, then streams Claude Code progress while Claude generates:

- BigQuery SQL
- a Source-to-Target Map (STM)
- structured validation results
- Jira update results when a Jira story is supplied

The UI is a presentation shell. Requirement inference, schema reconciliation, SQL generation, validation, Jira updates, and GitHub deployment decisions stay inside Claude Code through the local bridge and native MCP connectors.

Scope is SQL generation only. Legacy SQL conversion, dialect translation, and rewrite tasks are intentionally out of scope.

For day-to-day operations, see [RUNBOOK.md](RUNBOOK.md). For Claude's runtime contract, see [skills/generator.md](skills/generator.md).

---

## Architecture

```text
Browser -> Next.js UI/API (port 3000) -> claude-bridge (port 3001)
                                             |
                                             v
                                  Claude Code CLI (-p, stream-json)
                                             |
                                             v
                         Native MCP connectors: Jira, BigQuery, GitHub
```

The browser never talks to Jira, BigQuery, GitHub, or MCP servers directly. Next.js forwards requests to `mini-services/claude-bridge`, and the bridge assembles the prompt, runs Claude Code, translates stream-json into SSE events, extracts artifacts, and normalizes fallback validation data when Claude omits structured sections.

---

## Current Workflow

Claude Code runs the app skill from [skills/generator.md](skills/generator.md) on every request. The current runtime is a single linear S01-S14 flow:

1. Intake Jira, uploaded text, and free-text context.
2. Apply the mandatory BigQuery target scope: `projectId.datasetId`.
3. Reconcile schema only inside the supplied target dataset.
4. Build the STM before writing SQL.
5. Generate BigQuery SQL from the STM.
6. Validate inside the same session using the S11 neutral validator persona from [skills/validator.md](skills/validator.md).
7. Run a mandatory BigQuery dry-run in S12.
8. For Jira-backed runs, post a Jira comment and transition the issue to `In Progress` in S13.
9. Emit SQL, STM, structured validation JSON, and `[SQL_READY]`.

If Claude needs a user decision, it emits `[CLARIFY]` plus a structured clarification block. The SQL Curator Assistant panel is reserved for those clarification prompts and user answers.

---

## Repository Layout

```text
src/                              Next.js frontend (TypeScript, App Router)
  app/                            Pages and API route handlers
  components/split/               Three-pane SQL Curator workspace
  lib/                            Shared types, SSE client, target-scope rules
  stores/                         Zustand app state

mini-services/claude-bridge/      Local Claude Code HTTP/SSE bridge
  index.js                        HTTP server and Claude session orchestration
  config.js                       Env loader with fail-fast validation
  logging.js                      pino-backed structured logging
  metrics.js                      Counters, gauges, histogram snapshots
  request-validation.js           Bridge request validation
  release-policy.js               SQL release and warning policy
  activity.js                     Activity Feed normalization
  tool-helpers.js                 MCP tool_result parsing helpers
  output-parsers.js               SQL/STM/validation/activity extractors
  tests/                          node --test unit tests

skills/
  generator.md                    Main Claude Code runtime contract
  validator.md                    S11 validator persona contract

AGENTS.md                         Coding-agent instructions
RUNBOOK.md                        Operational runbook
docs/remote-access.md             LAN/remote access notes
```

---

## Validation Contract

Generated SQL responses must include:

- one fenced `sql` block
- one fenced `stm` JSON block
- one fenced `validation` JSON block
- final sentinel `[SQL_READY]`

The validation JSON must contain:

- `requirementCoverage`
- `stmCompleteness`
- `schemaReconciliation`
- `sqlChecks`
- `jiraTransition`

The bridge now uses a single-source validation model. Claude performs validator review, dry-run, and Jira completion inline in the main session. The bridge computes the SQL warning state from the worst status across requirement coverage, STM completeness, and SQL dry-run results. SQL is still surfaced whenever a fenced SQL block exists, but warnings are attached when validation is incomplete, warning, or failed.

Jira-backed generation must report Jira comment and transition results in `jiraTransition`.

---

## Quickstart

### Prerequisites

| Requirement | Details |
| --- | --- |
| Node.js | 18+ |
| Bun | Used for install/dev workflows |
| Claude Code CLI | Install and authenticate locally with `claude login` |
| MCP connectors | Jira, BigQuery, and GitHub configured in Claude Code as needed |

### Install

```bash
bun install
cd mini-services/claude-bridge
npm install
```

### Configure

Root `.env`:

```env
USE_CLAUDE_BRIDGE=true
BRIDGE_PORT=3001
```

Bridge `.env`:

```bash
cd mini-services/claude-bridge
copy .env.example .env
```

Every bridge variable is optional and has a validated default. Invalid values fail fast at bridge startup.

### Run

Start the bridge:

```bash
cd mini-services/claude-bridge
npm start
```

Start the UI from the repo root:

```bash
npm run dev
```

Open `http://localhost:3000`.

For LAN access:

```bash
npm run dev:public
```

Share `http://<your-machine-IP>:3000`.

---

## Supported Inputs

Mandatory:

- BigQuery project ID
- BigQuery target dataset ID

Optional context:

- Jira project/story number
- free-text requirements
- uploaded plain-text files

Supported file inputs are text only: TXT, CSV, JSON, MD, and SQL. PDF, DOCX, XLSX, and PPTX are not supported unless real extraction is added.

---

## HTTP API

### `POST /api/chat`

Next.js endpoint used by the UI for SQL generation. It validates target scope, then forwards the request to the bridge.

### `POST /api/generate`

Regeneration endpoint. It follows the same bridge path as `/api/chat`.

### `POST /api/deploy`

GitHub deployment endpoint. It forwards `taskType: "github_deploy"` to Claude Code. Deployment uses the native GitHub MCP connector and only happens after the user explicitly triggers deploy.

### Bridge `POST /chat`

Internal bridge endpoint called by Next.js. Response is Server-Sent Events.

Important request requirements:

- `sessionId` is required.
- `messages` must contain at least one message.
- `taskType` must be `sql_generation` or `github_deploy`.
- `bqProjectId` and `bqDatasetId` are mandatory.
- `uploadedFiles` are limited to 16 entries and text content.

### Bridge `GET /health`

Reports bridge readiness, Claude CLI availability, active sessions, recent errors, offline dry-run mode, and validator skill loading.

### Bridge `GET /metrics`

Returns JSON counters, gauges, and histogram snapshots for request volume, request durations, validation statuses, stream buffer overflows, idempotency collisions, aborts, and retry attempts.

### Bridge `DELETE /session/:id`

Clears a stored local bridge session.

---

## Bridge Configuration

Common bridge variables from [mini-services/claude-bridge/.env.example](mini-services/claude-bridge/.env.example):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `3001` | Bridge HTTP listener port |
| `CLAUDE_MAX_TURNS` | `50` | Tool-use turn budget for the linear S01-S14 flow |
| `CLAUDE_TIMEOUT_MS` | `1200000` | Wall-clock session cap in ms |
| `CLAUDE_MAX_CONCURRENT` | `3` | Concurrent in-flight bridge requests |
| `MAX_HISTORY_MESSAGES` | `20` | Recent chat messages forwarded to Claude |
| `SQL_CURATOR_MAX_REQUEST_BODY_BYTES` | `2097152` | Max accepted request body size |
| `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` | `8388608` | Max buffered Claude stream bytes before abort |
| `SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN` | `false` | Deterministic local stub mode for UI testing |
| `SQL_CURATOR_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal` |

Use offline dry-run only for local UI validation without Claude Code:

```bash
set SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN=true
```

---

## Validation Commands

Run these after relevant code changes:

```bash
npm.cmd run lint
npm.cmd run build
node --check mini-services\claude-bridge\index.js
```

Bridge unit tests:

```bash
cd mini-services/claude-bridge
npm test
```

---

## Operating Notes

- Logging is structured JSON through pino. Request logs include request/session context.
- Client disconnects abort the spawned Claude process tree.
- Graceful shutdown reaps tracked child processes on SIGTERM, SIGINT, and SIGHUP.
- Idempotency keys are supported on the bridge `/chat` endpoint to reject duplicate in-flight or recently completed submissions.
- Stream accumulators are bounded by `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES`.
- Bridge activity text should describe user-facing findings, not raw MCP tool names.

---

## Contributing

- Keep business logic out of the UI.
- Keep `skills/generator.md` focused on Claude runtime behavior.
- Do not add external APIs, custom Jira/BigQuery/GitHub connectors, cloud services, or backend orchestration for this POC.
- Preserve mandatory BigQuery project and dataset collection.
- Follow [AGENTS.md](AGENTS.md) for coding-agent instructions.
