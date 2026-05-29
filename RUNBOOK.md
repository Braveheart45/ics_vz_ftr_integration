# SQL Curator — Operations Runbook

Deployment, configuration, monitoring, and incident response for the SQL Curator bridge + frontend.

For application architecture and HTTP API reference, see [`README.md`](README.md). For Claude's operating contract, see the spine [`skills/sql-curator/SKILL.md`](skills/sql-curator/SKILL.md) and §1.2a below.

---

## 1. Architecture

### 1.1 Process topology

```
Browser ── HTTPS ──▶ Next.js (port 3000) ──▶ claude-bridge (port 3001)
                                                     │
                                                     │ spawn (one per request)
                                                     ▼
                                              Claude CLI (-p, stream-json)
                                                     │
                                                     ▼
                                         MCP servers: Jira • BigQuery • GitHub
```

Two processes to supervise: the Next.js server and `claude-bridge`. The bridge is a stateless HTTP/SSE proxy with in-memory session state and an in-memory metrics snapshot — no database.

### 1.2 Bridge module layout

```
mini-services/claude-bridge/
  index.js                    HTTP server + claude-session orchestration
  config.js                   Env loader (fail-fast, range-checked)
  logging.js                  pino-backed leveled logger
  metrics.js                  Counters / gauges / histograms
  request-validation.js       Schema-driven request validator
  activity.js                 Activity Feed event normalisers
  tool-helpers.js             MCP tool_result canonicaliser
  output-parsers.js           SQL / STM / clarification extractors
  release-policy.js           Release decision + validation-status helpers
  structural-checks.js        Deterministic STM ↔ SQL structural check (bridge-side)
  prompt-assembler.js         Composes the prompt from skills/ + contracts/ (the seam)
  tests/                      node --test suite
  .env.example                Annotated env-var reference
```

### 1.2a Skill architecture (the agent's brain)

The agent's operating contract is authored once under `skills/` and `contracts/` — it is **not**
restated in the bridge prompt. `prompt-assembler.js` is the single seam that reads these files and
composes the run prompt; the bridge never paraphrases skill content.

```
skills/
  sql-curator/
    SKILL.md                  Always-on orchestration spine (S01–S14) + frontmatter
    references/
      confidence-gate.md      S06 thresholds + two-tier vague-input policy
      schema-reconciliation.md S04–S05 protocol + the two mandatory rationale cards
      bigquery-idioms.md      S07a/S08/S09 detail + AS-alias mandate (the per-dialect fork unit)
      clarification.md        Clarification block shape
  validator/
    SKILL.md                  S11 validator persona
    references/
      inference-soundness.md  Task-2 rubric
contracts/
  stm.schema.json             STM row shape (matches output-parsers.js extractStm)
  validation.schema.json      validation block sections + status enum
  activity.schema.json        streaming activity block + enums (match activity.js)
  README.md                   interface + versioning + portability notes
```

Progressive disclosure is assembly-time and conditional: the spine + contracts are always
included; the dialect idioms file is selected by `dialect` (today `bigquery`). Adding a warehouse
= add `references/<dialect>-idioms.md` + a `DIALECT_IDIOMS` entry in `prompt-assembler.js`; no
spine or orchestration edits. The agent↔bridge interface (field names + enums) is locked by
`tests/contract-agreement.test.js`.

**Portability:** `prompt-assembler.js` + the process spawn are the only CLI-specific pieces. A
migration to the Claude Agent SDK replaces those two and consumes `skills/` + `contracts/`
unchanged.

### 1.3 Validation

Validation runs **inside one linear Claude session**, not as separate bridge-orchestrated layers. The flow is S01 intake → S02–S08 analysis/schema/STM/design → S09 SQL generation → S10 self-audit → **S11 validator persona** (a skeptical pass that reads `skills/validator/SKILL.md`, re-checks requirements coverage + inference soundness + SQL↔STM alignment, and corrects the SQL inline if a concrete mismatch is found) → **S12 dry-run** → **S13 Jira** → S14 ready.

SQL is emitted to the UI whenever Claude returns a fenced SQL block. The bridge attaches a warning banner when validation did not cleanly pass.

The release status is the worst of:

| Signal | Source | Owner |
|---|---|---|
| `requirementCoverage.status` | Claude's `validation` block (S11 Task 1) | Claude |
| `stmCompleteness.status` | Claude's `validation` block (S11 Task 3) — **overridden** by the deterministic check below when that finds a concrete mismatch | Claude + Bridge |
| Deterministic STM↔SQL check | `runStructuralChecks(sql, stm)` in `structural-checks.js` — every STM target column has a matching SELECT alias; every STM source table is referenced. Downgrades a claimed `pass` it can disprove | **Bridge** |
| Deterministic dry-run | `deriveDryRunStatus(dryRunAttempts)` — reduces the raw `is_error` of every observed `execute_sql_readonly` to pass / fail / `not_run` | **Bridge** |
| Premature-Jira flag | `orderingState.jiraCommentBeforeDryRun` — a Jira write before a passing dry-run pulls the run to `warning` | **Bridge** |

The deterministic dry-run signal **overrides** Claude's prose `validation.sqlChecks.status` whenever they disagree, and forces a `not_run` warning if no `execute_sql_readonly` was observed at all. A hallucinated or skipped dry-run therefore cannot produce a clean release. `jiraTransition.status` and `schemaReconciliation.status` are reported in the UI but do **not** gate release (Jira failures are warnings by design; schema-reconciliation is informational).

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| Node.js | 18+ (tested on 26) |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| MCP servers | Atlassian Rovo (Jira), Google Cloud BigQuery, GitHub — configured in `~/.claude.json` |

The BigQuery MCP needs read access plus the right to call `jobs.create` in dry-run mode on the target project. The Jira MCP needs comment-add and issue-transition rights. All MCP tools are available throughout the single linear pass; the skill controls ordering (Jira writes only at S13, after the S12 dry-run). The bridge does not gate tools with `--disallowedTools`; instead it detects and warns when a Jira write happens before a passing dry-run.

Verify the toolchain before deploying:
```bash
claude --version
claude -p "list datasets" --verbose            # should call BQ MCP
cat ~/.claude.json | jq .mcpServers | keys
```

---

## 3. Installation

```bash
# Frontend
cd <repo-root>
bun install
npm run build                                  # production build

# Bridge
cd mini-services/claude-bridge
cp .env.example .env                           # edit if needed
npm install                                    # installs pino
```

---

## 4. Configuration

Every variable is read once at startup, validated, and frozen. Malformed values throw an aggregated error report — the bridge will not boot in a half-configured state.

The complete annotated reference lives in [`mini-services/claude-bridge/.env.example`](mini-services/claude-bridge/.env.example). The most-touched variables:

| Variable | Default | Range / values | Purpose |
|---|---|---|---|
| `BRIDGE_PORT` | `3001` | 1–65535 | HTTP listener port |
| `CLAUDE_MAX_TURNS` | `50` | 1–200 | Tool-use turns per session (the linear S01→S14 flow does ~10–18 tool calls) |
| `CLAUDE_TIMEOUT_MS` | `1200000` | 1000–3600000 | Wall-clock cap per session (20 min) |
| `CLAUDE_MAX_CONCURRENT` | `3` | 1–32 | Concurrent in-flight bridge requests |
| `MAX_HISTORY_MESSAGES` | `20` | 1–500 | Recent client messages forwarded to Claude |
| `SQL_CURATOR_MAX_REQUEST_BODY_BYTES` | `2097152` | 1024–67108864 | Max accepted request body (2 MB) |
| `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` | `8388608` | 65536–268435456 | Bounded buffer on stream accumulators (8 MB) |
| `SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN` | `false` | boolean | Deterministic stub for UI testing without Claude |
| `SQL_CURATOR_LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal | pino log threshold |
| `SQL_CURATOR_LOG_PRETTY` | `false` | boolean | Use `pino-pretty` single-line output for dev (requires `pino-pretty` package) |

### MCP servers

MCP servers are configured in `~/.claude.json`, not in this repo. Claude CLI owns its own tool configuration.

| MCP | Required tools | Permissions |
|---|---|---|
| Jira | `getJiraIssue`, `searchJiraIssuesUsingJql`, `addCommentToJiraIssue`, `transitionJiraIssue` | Read + comment + transition on target project |
| BigQuery | `list_table_ids`, `get_table_info`, `execute_sql_readonly` | `jobs.create` in dry-run mode on target project |
| GitHub | PR / push tools | Only used in `github_deploy` mode |

---

## 5. Running in production

### 5.1 systemd

```ini
# /etc/systemd/system/sql-curator-bridge.service
[Unit]
Description=SQL Curator Claude Bridge
After=network.target

[Service]
Type=simple
User=sql-curator
WorkingDirectory=/opt/sql-curator/mini-services/claude-bridge
EnvironmentFile=/opt/sql-curator/mini-services/claude-bridge/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
# Ensure the runtime user can read ~/.claude.json
Environment=HOME=/home/sql-curator

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sql-curator-bridge
sudo systemctl status sql-curator-bridge
journalctl -u sql-curator-bridge -f                    # logs are JSON, pipe to jq if needed
```

The bridge exits non-zero on `uncaughtException`. systemd `Restart=on-failure` will bring it back. Active SSE streams are dropped — clients receive `done {success:false}` and can re-submit.

### 5.2 Docker

```dockerfile
FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY mini-services/claude-bridge/package.json mini-services/claude-bridge/package-lock.json* ./
RUN npm ci --omit=dev
COPY mini-services/claude-bridge/ ./
EXPOSE 3001
CMD ["node", "index.js"]
```

```bash
docker run -d --name sql-curator-bridge \
  -p 3001:3001 \
  --env-file mini-services/claude-bridge/.env \
  -v ~/.claude.json:/root/.claude.json:ro \
  sql-curator-bridge:latest
```

The container mounts the host's `~/.claude.json` read-only so MCP server credentials stay outside the image.

---

## 6. Health, metrics, and observability

### 6.1 `GET /health`

Layered status. Returns 200 when Claude CLI is reachable, 503 otherwise.

Status values:
- `ready` — claude detected, capacity available, no recent errors
- `claude_not_found` — bridge is up but `which claude` would fail (503)
- `degraded_capacity` — `activeRequests >= CLAUDE_MAX_CONCURRENT`
- `recent_errors` — `bridgeState.lastError` within the last 60s

```bash
curl -s http://127.0.0.1:3001/health | jq
```

Expected fields: `status`, `claude.binPath`, `claude.detected`, `capacity.{activeRequests,maxConcurrent,queueDepth,atCeiling}`, `sessions.active`, `features.*`, `lastError`, `port`, `uptimeSec`.

### 6.2 `GET /metrics`

JSON snapshot of counters, gauges, and bucketed histograms. Scrape this at ~30s intervals from your monitoring stack.

Key series:

| Series | Type | Labels | Purpose |
|---|---|---|---|
| `requests_total` | counter | `endpoint`, `taskType` | Incoming volume |
| `requests_succeeded` / `requests_failed` / `requests_completed_with_issue` | counter | `endpoint` | Outcome breakdown |
| `request_duration_ms` | histogram | `endpoint` | End-to-end latency, buckets 50ms → 5min |
| `validation_status` | counter | `source` (stm/requirements/sql_dryrun/jira), `status` | Per-section validation outcomes |
| `dry_run_disagreement` | counter | `claude`, `bridge` | Times Claude's self-reported dry-run disagreed with the bridge's observed verdict |
| `claude_sessions_spawned` | counter | `kind` (primary/retry) | Process spawn volume |
| `claude_sessions_active` | gauge | — | In-flight Claude processes |
| `claude_sessions_aborted` | counter | `reason` (client_disconnect / pre_aborted) | Disconnect tracking |
| `auto_retry_attempts` | counter | `reason` (missing_sql / max_turns) | Auto-retry rate |
| `idempotency_collision` | counter | `state` (in_flight / completed) | Double-submit attempts |
| `stream_buffer_overflow` | counter | `accumulator` | Buffer-cap hits |
| `requests_client_disconnect` | counter | `endpoint` | Client-side aborts mid-stream |

To transform to Prometheus exposition format, add a small adapter — `metrics.snapshot()` returns plain JSON.

### 6.3 Logging

Structured JSON to stdout (pino). Every per-request log line carries:
- `requestId` — short hex generated at HTTP entry, echoed in the `X-Request-Id` response header
- `sessionId` — first 8 chars of the client-supplied session id
- `component` — `bridge` / `request` / `claude-session`
- `phase` — additional sub-operation tag

Grep one run end-to-end with `requestId=<id>`:
```bash
journalctl -u sql-curator-bridge | jq 'select(.requestId == "abc12345")'
```

In dev, set `SQL_CURATOR_LOG_PRETTY=true` and install `pino-pretty` for single-line colorised output.

---

## 7. Operational safety nets

The bridge is hardened against several common failure modes. The mechanism is listed alongside the defence so operators know what to expect.

| Concern | Mechanism |
|---|---|
| Client disconnects mid-stream | `req.on('close')` → `AbortController` → Claude tree killed via `taskkill /T` (Windows) or SIGTERM→SIGKILL escalation (POSIX). Tracked in `claude_sessions_aborted{reason="client_disconnect"}`. |
| Runaway MCP response | Stream accumulators capped at `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES`. Overflow aborts the session with an explicit Activity Feed error. Tracked in `stream_buffer_overflow`. |
| Double-submission (refresh / double-click / retry) | `Idempotency-Key` header tracked with a 10-minute TTL. Collisions return 409 with the original `requestId`. |
| Bridge crash | systemd `Restart=on-failure` brings the process back. `uncaughtException` reaps child processes before exit; `process.on('exit')` is a final-line-of-defence sweep. |
| Orphaned Claude processes | `spawnedProcs` Set tracked at module level; reaped on SIGTERM/SIGINT/SIGHUP/exit/uncaughtException. On Windows, `taskkill /T` kills the whole MCP server subtree. |
| Misconfigured environment | `config.js` validates ranges at startup with an aggregated error report. The bridge will not boot in a half-configured state. |
| Stack trace leaks | All HTTP errors funnel through `sendError(res, status, code, message, extra)` returning `{error: {code, message, ...}}`. No stack traces leave the bridge. |
| Malformed request payload | Schema-driven validator (`request-validation.js`) with stable error codes and field paths. |

---

## 8. Deployment checklist

After deploying a new version:

1. **Health**
   ```bash
   curl -s http://127.0.0.1:3001/health | jq -r .status
   # expect: ready
   ```

2. **Metrics endpoint live**
   ```bash
   curl -s http://127.0.0.1:3001/metrics | jq .counters
   ```

3. **Unit tests pass on the host**
   ```bash
   cd /opt/sql-curator/mini-services/claude-bridge
   npm test
   # expect: tests 85 / pass 85 / fail 0
   ```

4. **End-to-end smoke** — trigger one minimal SQL run from the UI, watch Activity Feed surface the single linear pass:
   - Intake → Analysis → Schema (with candidate-table rationale cards) → Mapping & SQL Generation
   - A validator-persona card (`source: claude`) reporting requirements coverage + SQL↔STM alignment
   - A dry-run result; the bridge attaches a warning banner if the dry-run failed or was skipped
   - A Jira card (`comment posted, status → In Progress`) for Jira-backed runs
   - SQL appears in the editor; a warning banner is shown when validation did not cleanly pass.

5. **Logs are JSON**
   ```bash
   journalctl -u sql-curator-bridge --since "5 minutes ago" | head -1 | jq .
   # should parse cleanly
   ```

---

## 9. Troubleshooting

### 9.1 Bridge will not start
Symptom: systemd reports `Active: failed`; logs show `claude-bridge configuration invalid`.

Action: read the error block — it lists every malformed env var. Fix all of them at once (the validator aggregates errors deliberately). `journalctl -u sql-curator-bridge -n 50`.

### 9.2 `/health` returns 503 with `claude_not_found`
The bridge is up but the Claude CLI is missing from PATH for the systemd user.

```bash
sudo -u sql-curator bash -lc 'which claude'
sudo -u sql-curator bash -lc 'claude --version'
```

If missing, install globally as the runtime user and ensure `npm bin -g` is on its PATH.

### 9.3 SQL surfaced with a validation warning
SQL always surfaces when a fenced SQL block exists; the banner explains why it was not marked clean. Most common causes:

- **Dry-run skipped (`not_run`)** — Claude never invoked `execute_sql_readonly` at S12. The bridge forces a warning and a `Mandatory Dry-Run Was Skipped` card. Re-run, or dry-run the SQL manually before use.
- **Dry-run fail** — the last observed `execute_sql_readonly` returned an error. A `Dry-Run Verdict Corrected by Bridge` card appears if Claude had claimed pass. Fix the SQL and regenerate.
- **`stmCompleteness` fail** — Claude's S11 validator persona found a target column missing from the SELECT, a source table not referenced, or a materially wrong transformation. The validator card lists the specific mismatch.
- **`requirementCoverage` fail** — an acceptance criterion has no covering STM row. The validator card lists the uncovered criteria.
- **`Jira Written Before Validation`** — a Jira write was observed before a passing dry-run; the run is pulled to warning even if everything else passed.

### 9.4 `degraded_capacity` on `/health`
All concurrency slots taken. Either:
- Genuine load — raise `CLAUDE_MAX_CONCURRENT` (each slot = 1 Claude process, consider memory)
- Wedged sessions — check `claude_sessions_active` gauge; if it stays high without traffic, restart the bridge and investigate why cleanup is not running

### 9.5 Client disconnect counter rising
`metrics.snapshot().counters` shows `requests_client_disconnect` rising. Possible causes:
- Frontend timeout shorter than Claude session — frontends should not impose timeouts shorter than `CLAUDE_TIMEOUT_MS`
- Network issues between browser and Next.js — check load balancer settings (some terminate idle SSE streams)
- Users navigating away mid-run — benign

### 9.6 `stream_buffer_overflow` event
A Claude session exceeded the 8 MB accumulator cap. Almost always means an MCP tool returned an oversized payload. Check the Activity Feed for the abort card and Claude session logs for the offending tool call. Raise `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` only if the response is legitimately large.

### 9.7 Jira comment did not post
Jira completion (S13) runs inline at the end of the single pass. If `addCommentToJiraIssue` / `transitionJiraIssue` were not invoked, `validation.jiraTransition.status` is reported as `not_run`/`warning` and the Jira card reflects it.

```bash
journalctl -u sql-curator-bridge | jq 'select(.component == "claude-session")' | head
```

Confirm: the issue is reachable and the user has comment + transition permissions. Note a Jira write seen *before* a passing dry-run triggers a `Jira Written Before Validation` warning — the comment may not reflect the validated SQL.

### 9.8 Session-related issues
```bash
# Clear a specific session
curl -X DELETE http://127.0.0.1:3001/session/SESSION_ID
```

Sessions auto-expire after 30 minutes of inactivity. Use the UI's "New Session" button to reset client-side state.

---

## 10. Rollback

The bridge is stateless except for the in-memory sessions and metrics snapshot. A `git revert` plus a bridge restart is sufficient.

```bash
sudo systemctl stop sql-curator-bridge
cd /opt/sql-curator
git revert <bad-sha>
cd mini-services/claude-bridge && npm install && npm test
sudo systemctl start sql-curator-bridge
curl -s http://127.0.0.1:3001/health | jq .status
```

Active SSE streams are closed during the restart; clients receive `done {success:false}` and re-submit.

---

## 11. Updating the skill

The operating contract lives in `skills/` + `contracts/` and is composed by `prompt-assembler.js`. **The assembler caches every skill/contract file at bridge startup**, so editing a skill or contract requires a **bridge restart** to take effect (this changed when the brain moved out of per-request inlining). Edit the spine for orchestration/control-flow, a `references/` file for stage detail, or a `contracts/*.schema.json` for an artifact shape — then restart the bridge.

When changing a contract field/enum, update all four in lockstep: the schema in `contracts/`, the parser in the bridge, the skill reference prose, and `tests/contract-agreement.test.js` (which fails if they drift).

---

## 12. Security notes

- The bridge binds to `127.0.0.1` by default. Do not expose it directly to the internet.
- All MCP credentials live in `~/.claude.json` under the systemd user — not in environment variables or repo files.
- `--dangerously-skip-permissions` is used to auto-approve MCP tool calls (the bridge runs headlessly). All MCP tools — including Jira writes — are therefore available for the entire pass; there is **no** `--disallowedTools` gate. Ordering (Jira writes only at S13, after a passing dry-run) is enforced by the skill, not the tool layer. A premature Jira write is detected and surfaced as a warning **after the fact** — it is not prevented. If your deployment cannot tolerate a Jira write against unvalidated SQL, that residual risk must be accepted or mitigated out of band.
- Request bodies are capped at `SQL_CURATOR_MAX_REQUEST_BODY_BYTES`. Stream accumulators capped at `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES`. No user input is `eval`'d.
- HTTP errors return structured envelopes (`{error: {code, message, ...}}`) with no stack traces.

---

## 13. Quick reference

| Action | Command |
|---|---|
| Start bridge (systemd) | `sudo systemctl start sql-curator-bridge` |
| Tail JSON logs | `journalctl -u sql-curator-bridge -f \| jq` |
| Health check | `curl -s http://127.0.0.1:3001/health \| jq` |
| Metrics scrape | `curl -s http://127.0.0.1:3001/metrics \| jq` |
| Filter logs by run | `journalctl -u sql-curator-bridge \| jq 'select(.requestId == "abc12345")'` |
| Clear session | `curl -X DELETE http://127.0.0.1:3001/session/<id>` |
| Unit tests | `cd mini-services/claude-bridge && npm test` |
| Type-check frontend | `node node_modules/typescript/bin/tsc --noEmit` |
