# SQL Curator — Operations Runbook

Deployment, configuration, monitoring, and incident response for the SQL Curator bridge + frontend.

For application architecture and HTTP API reference, see [`README.md`](README.md). For Claude's operating contract, see [`skills/sqlforge/SKILL.md`](skills/sqlforge/SKILL.md).

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
  structural-checks.js        L2 SQL ↔ STM checks (LLM-free)
  tests/                      node --test suite (87 unit tests)
  .env.example                Annotated env-var reference
```

### 1.3 Validation gate

Every SQL run passes through three bridge-owned layers. All three must pass for SQL to surface.

| Layer | What it checks | Verdict source | LLM in verdict? |
|---|---|---|---|
| **L1 Executional** | Does the SQL parse and resolve in BigQuery? | Raw `tool_result.is_error` from the dry-run MCP call | No |
| **L2 Structural** | Does the SQL implement what the STM declared? | Mechanical SQL ↔ STM comparison | No |
| **L3 Semantic** | Does the STM cover every acceptance criterion? | Fresh Claude session given only requirements + STM (no SQL, no history) | Yes — cold, narrowly scoped |

Claude's prose `validation.sqlChecks.status` is **discarded** and overwritten by the bridge-derived verdict before the UI sees it.

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| Node.js | 18+ (tested on 26) |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| MCP servers | Atlassian Rovo (Jira), Google Cloud BigQuery, GitHub — configured in `~/.claude.json` |

The BigQuery MCP needs read access plus the right to call `jobs.create` in dry-run mode on the target project. The Jira MCP needs comment-add and issue-transition rights — the bridge blocks Jira write tools during the main pass via `--disallowedTools` and only re-enables them in the follow-up pass.

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
| `CLAUDE_MAX_TURNS` | `25` | 1–200 | Tool-use turns per main session |
| `CLAUDE_TIMEOUT_MS` | `1200000` | 1000–3600000 | Wall-clock cap per session (20 min) |
| `CLAUDE_MAX_CONCURRENT` | `3` | 1–32 | Concurrent in-flight bridge requests |
| `MAX_HISTORY_MESSAGES` | `20` | 1–500 | Recent client messages forwarded to Claude |
| `SQL_CURATOR_MAX_REQUEST_BODY_BYTES` | `2097152` | 1024–67108864 | Max accepted request body (2 MB) |
| `SQL_CURATOR_MAX_STREAM_BUFFER_BYTES` | `8388608` | 65536–268435456 | Bounded buffer on stream accumulators (8 MB) |
| `SQL_CURATOR_REQUIRE_DRYRUN_PASS` | `true` | boolean | Strict gate; SQL withheld unless all layers pass |
| `SQL_CURATOR_L3_COVERAGE_CHECK` | `true` | boolean | Enable the L3 cold semantic-coverage session |
| `SQL_CURATOR_L3_TIMEOUT_MS` | `45000` | 5000–600000 | Cold-session timeout |
| `SQL_CURATOR_DEFER_JIRA_COMPLETION` | `true` | boolean | Two-pass Jira ordering |
| `SQL_CURATOR_JIRA_COMPLETION_TIMEOUT_MS` | `120000` | 5000–1800000 | Jira follow-up pass timeout |
| `SQL_CURATOR_JIRA_WRITE_TOOLS` | (built-in list) | comma list | Override the Jira write tools blocked during main pass |
| `SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN` | `false` | boolean | Deterministic stub for UI testing without Claude |
| `SQL_CURATOR_LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal | pino log threshold |
| `SQL_CURATOR_LOG_PRETTY` | `false` | boolean | Use `pino-pretty` single-line output for dev (requires `pino-pretty` package) |

### MCP servers

MCP servers are configured in `~/.claude.json`, not in this repo. Claude CLI owns its own tool configuration.

| MCP | Required tools | Permissions |
|---|---|---|
| Jira | `getJiraIssue`, `searchJiraIssuesUsingJql`, `addCommentToJiraIssue`, `transitionJiraIssue` | Read + comment + transition on target project |
| BigQuery | `list_dataset_ids`, `list_table_ids`, `get_table_info`, `execute_sql_readonly` | `jobs.create` in dry-run mode on target project |
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
| `gate_layer_result` | counter | `layer` (L1/L2/L3), `status` | Per-layer verdict counts |
| `claude_sessions_spawned` | counter | `kind` (primary/retry) | Process spawn volume |
| `claude_sessions_active` | gauge | — | In-flight Claude processes |
| `claude_sessions_aborted` | counter | `reason` (client_disconnect / pre_aborted) | Disconnect tracking |
| `auto_retry_attempts` | counter | `reason` (missing_sql) | Auto-retry rate |
| `idempotency_collision` | counter | `state` (in_flight / completed) | Double-submit attempts |
| `stream_buffer_overflow` | counter | `accumulator` | Buffer-cap hits |
| `l3_coverage_outcome` | counter | `result` (timeout / no_block / parse_error) | L3 reliability |
| `requests_client_disconnect` | counter | `endpoint` | Client-side aborts mid-stream |

To transform to Prometheus exposition format, add a small adapter — `metrics.snapshot()` returns plain JSON.

### 6.3 Logging

Structured JSON to stdout (pino). Every per-request log line carries:
- `requestId` — short hex generated at HTTP entry, echoed in the `X-Request-Id` response header
- `sessionId` — first 8 chars of the client-supplied session id
- `component` — `bridge` / `request` / `claude-session` / `l3-coverage`
- `phase` — additional sub-operation tag (e.g. `l3-coverage`)

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
   # expect: tests 87 / pass 87 / fail 0
   ```

4. **End-to-end smoke** — trigger one minimal SQL run from the UI, watch Activity Feed surface:
   - L1 card (`BigQuery Dry-Run — pass` from `source: bigquery`)
   - L2 card (`SQL ↔ STM Structural Check — pass` from `source: bridge`)
   - L3 card (`Requirements Coverage — pass` from `source: bridge`)
   - SQL appears in the editor only after all three pass.

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

### 9.3 SQL never surfaces despite a passing dry-run in the UI
The Activity Feed will show which layer blocked. Most common causes:

- **L2 fail** — STM declares a target column that's missing from the SQL's outermost SELECT, or a source table the SQL doesn't reference. Fix the STM or the SQL; regenerate.
- **L3 fail** — STM is missing rows for an acceptance criterion. The cold session lists missing criteria in its activity card. Add the missing rows.
- **L1 not_run** — Claude did not invoke the dry-run tool. The skill says it must; check `journalctl` for the Claude session output to see why it skipped.

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
Two-pass Jira completion has a verification step: after the follow-up session exits, the bridge checks that `addCommentToJiraIssue` and `transitionJiraIssue` were actually invoked. If not, a `Jira Update Skipped` error card appears in the Activity Feed.

```bash
journalctl -u sql-curator-bridge | jq 'select(.component == "jira-followup")' | head
```

Confirm: Jira write tools are not in `--disallowedTools` for the follow-up; the issue is reachable; the user has comment + transition permissions.

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

[`skills/sqlforge/SKILL.md`](skills/sqlforge/SKILL.md) is the operating contract Claude reads at the start of every session. Changes take effect on the next request — no bridge restart needed.

For pid-level isolation between old and new contract behaviour during a rollout (e.g. a major SKILL change), restart the bridge after the file is in place.

---

## 12. Security notes

- The bridge binds to `127.0.0.1` by default. Do not expose it directly to the internet.
- All MCP credentials live in `~/.claude.json` under the systemd user — not in environment variables or repo files.
- `--dangerously-skip-permissions` is used to auto-approve MCP tool calls (the bridge runs headlessly). The Jira write-tool block via `--disallowedTools` is the explicit guard against premature Jira writes.
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
