# SQL Curator — Operations Runbook

## AI-Powered SQL Generation & Legacy Conversion Agent
### Claude Code CLI Integration (Local, API-Free Architecture)

---

## 1. Architecture Overview

### 1.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                       SQL Curator Frontend                          │
│            (Next.js 16 — React 19 + TypeScript + Tailwind)          │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐ │
│  │    LEFT PANEL        │  │         RIGHT PANEL                  │ │
│  │  ┌────────────────┐  │  │  ┌────────────────────────────────┐  │ │
│  │  │  SQL Editor     │  │  │  │  Task Type Selector            │  │ │
│  │  │  (flex grow)   │  │  │  ├────────────────────────────────┤  │ │
│  │  ├────────────────┤  │  │  │  Jira Project + Story Number   │  │ │
│  │  │  STM Viewer    │  │  │  │  BigQuery Project (mandatory)  │  │ │
│  │  │  (collapsible) │  │  │  │  File Upload + Context Input   │  │ │
│  │  └────────────────┘  │  │  ├────────────────────────────────┤  │ │
│  └──────────────────────┘  │  │  "Submit & Generate" Button    │  │ │
│                             │  ├────────────────────────────────┤  │ │
│                             │  │  Activity Feed                 │  │ │
│                             │  │  • Pipeline Tracker (compact)  │  │ │
│                             │  │  • Findings / Decisions /      │  │ │
│                             │  │    Inferences / Validations    │  │ │
│                             │  │  • Per-stage grouped cards     │  │ │
│                             │  ├────────────────────────────────┤  │ │
│                             │  │  SQL Curator Assistant         │  │ │
│                             │  │  (Clarification Q&A)           │  │ │
│                             │  │  • Persistent Q&A history      │  │ │
│                             │  │  • Option chips + free text    │  │ │
│                             │  └────────────────────────────────┘  │ │
│                             └──────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ POST /api/chat  (SSE stream)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js API Routes                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  /api/chat (route.ts)                                       │   │
│  │  ┌─────────────────────┐   ┌─────────────────────────────┐ │   │
│  │  │  USE_CLAUDE_BRIDGE   │   │  Built-in Agent             │ │   │
│  │  │  = true              │   │  (z-ai-web-dev-sdk)         │ │   │
│  │  │  ↓                   │   │  Fallback when bridge off   │ │   │
│  │  │  → claude-bridge.js  │   │                             │ │   │
│  │  └─────────────────────┘   └─────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────┐   ┌─────────────────────────────────────┐ │
│  │  /api/generate      │   │  /api/sql/validate  /api/sql/analyze│ │
│  │  (Regenerate)       │   │                                     │ │
│  └─────────────────────┘   └─────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ (when bridge mode)
                            │ POST /chat?XTransformPort=3001
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  claude-bridge (Mini-Service)                       │
│                  Port 3001 — Node.js HTTP Server                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Session Manager                                             │   │
│  │  • Per-session conversation context                           │   │
│  │  • Conversation ID resumption (--resume flag)                 │   │
│  │  • 30-min idle TTL, auto-cleanup                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  JSON-Lines Parser                                           │   │
│  │  • tool_use → SSE tool_call + status                         │   │
│  │  • tool_result → SSE tool_result                             │   │
│  │  • content_block_delta → accumulate text                      │   │
│  │  • result → capture conversation_id                           │   │
│  │  • clarification detection → SSE clarification event          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Concurrency Limiter                                         │   │
│  │  • Max 3 concurrent Claude CLI processes                     │   │
│  │  • 3-minute timeout per request                              │   │
│  │  • Auto SIGTERM → SIGKILL on timeout                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ spawn claude -p - --output-format stream-json
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Claude Code CLI (Local)                             │
│                                                                     │
│  Config: ~/.claude.json                                             │
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐    │
│  │  Jira MCP      │  │  BigQuery MCP  │  │  GitHub MCP        │    │
│  │  Server        │  │  Server        │  │  Server            │    │
│  │                │  │                │  │                    │    │
│  │  • Fetch       │  │  • List        │  │  • Create PR       │    │
│  │    stories     │  │    datasets    │  │  • Push files      │    │
│  │  • Read        │  │  • Get table   │  │                    │    │
│  │    comments    │  │    schemas     │  │                    │    │
│  └────────────────┘  └────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **AI Backend** | Claude Code CLI (local) | No API keys needed. MCP connectors give native access to Jira, BigQuery, GitHub |
| **Communication** | HTTP + SSE streaming | Real-time progress updates to UI. SSE is simpler than WebSocket for this use case |
| **Bridge Pattern** | Separate Node.js mini-service | Isolation from Next.js process. Independent scaling, crash recovery |
| **Conversation Context** | In-memory session store + `--resume` flag | Claude maintains context across multi-turn interactions |
| **Activity Feed** | Inline `activity` JSON blocks in Claude output | Live per-stage findings streamed as cards; no plumbing language visible |
| **Two-pass Jira** | Main run blocks Jira writes via `--disallowedTools`; follow-up pass runs after gate | Guarantees comment + transition happen only after dry-run passes |
| **Strict validation gate** | `sqlChecks.status` must be `pass` or SQL is withheld | Prevents unvalidated SQL from reaching the editor |
| **Clarification history** | Persistent store of all Q&A per session | Architect can review every question, option selection, and context across rounds |
| **Stage regression guard** | Zustand `setStage` refuses to move pipeline backwards | Stray tool-pair status events cannot re-activate completed stages |
| **Semantic tool translation** | Bridge maps tool_use + tool_result pairs to architect-readable findings | No MCP plumbing language reaches the Activity Feed |
| **Fallback** | Built-in agent (z-ai-web-dev-sdk) | Works without Claude CLI for basic testing. Requires real credentials for Jira/BQ/GitHub APIs |

### 1.3 Confirmation: API-Free Architecture

**The backend is designed to connect the frontend UI directly to the local Claude Code CLI. It does NOT rely on external APIs.**

- **No Anthropic API key required** — Claude Code CLI authenticates directly via Claude Pro/Max subscription
- **No external API calls** — All Jira/BigQuery/GitHub interactions happen through Claude's native MCP connectors
- **No cloud dependency** — Everything runs locally on the developer's machine
- **MCP configuration** — Tools are configured in `~/.claude.json`, not in the application

---

## 2. Prerequisites

### 2.1 Claude Code CLI

```bash
# Install Claude Code CLI globally
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Authenticate (one-time)
claude auth login
```

**Reference:** https://docs.anthropic.com/en/docs/claude-code/overview

### 2.2 MCP Server Configuration

Create or update `~/.claude.json` with MCP server definitions:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-jira"],
      "env": {
        "JIRA_API_TOKEN": "your-jira-api-token",
        "JIRA_BASE_URL": "https://your-domain.atlassian.net"
      }
    },
    "bigquery": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-bigquery"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your-github-token"
      }
    }
  }
}
```

**Reference:** https://modelcontextprotocol.io/docs/develop/connect-local-servers

### 2.3 Verify MCP Connectivity

```bash
# Test Claude CLI with MCP tools
claude -p "List my Jira projects" --verbose

# Test BigQuery
claude -p "List datasets in my BigQuery project" --verbose

# Verify streaming JSON output format
claude -p "Say hello" --output-format stream-json
```

---

## 3. Installation & Startup

### 3.1 Environment Setup

```bash
# Clone the repository
cd sql-curator

# Install dependencies
bun install

# Copy environment template
cp .env.example .env.local

# Edit .env.local — set USE_CLAUDE_BRIDGE=true
# (This is already the default in .env.example)
```

### 3.2 Start All Services

You need to start **two** services:

```bash
# Terminal 1: Start the Claude Bridge (port 3001)
cd mini-services/claude-bridge
bun run dev

# Terminal 2: Start the Next.js application (port 3000)
cd /path/to/sql-curator
bun run dev
```

### 3.3 Startup Verification

```bash
# Check bridge health
curl http://127.0.0.1:3001/health

# Expected response:
# {
#   "status": "ready",
#   "claude": "claude",
#   "activeRequests": 0,
#   "maxConcurrent": 3,
#   "activeSessions": 0,
#   "port": 3001,
#   "uptime": 12,
#   "mode": "claude_cli"
# }

# Check Next.js dev server
curl http://localhost:3000
```

### 3.4 Running Without Claude CLI (Direct Mode)

If Claude Code CLI is not installed, the application falls back to a built-in agent that uses the `z-ai-web-dev-sdk` with direct API clients. To force this:

```bash
# In .env.local:
USE_CLAUDE_BRIDGE=false
```

> **Note:** Direct mode requires real API credentials configured in environment variables (JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN, GCP_PROJECT_ID, GCP_ACCESS_TOKEN). Without Claude CLI, there is no MCP-based tool access. Configure credentials in `.env.local`.

---

## 4. Bidirectional Interaction

### 4.1 How It Works

SQL Curator supports **fully bidirectional interaction** between the user and Claude Code:

```
User Input ──────────→ Claude Code ──────────→ SQL Output
                         │   ↑
                         │   │
              (Asks clarifying question)
                         │   │
              (User responds via chat)  ←───┘
                         │
              (Generates refined SQL)
```

### 4.2 Interaction Flow

1. **Initial Request:** User fills in Jira/BQ/Context fields and clicks "Submit & Generate"
2. **Claude Processes:** Claude CLI uses MCP tools to fetch Jira story, explore BQ schemas
3. **Two possible outcomes:**
   - **SQL Generated:** Claude produces SQL → displayed in editor → pipeline reaches "Ready"
   - **Clarification Needed:** Claude asks a follow-up question → orange "needs information" banner appears

4. **User Responds:** Type in the chat panel input bar → press Enter or click Send
5. **Context Preserved:** Full conversation history is sent with each request. Claude sees all previous messages.
6. **Iterate:** Process continues until Claude generates SQL or the user is satisfied

### 4.3 Clarification State

When Claude needs more information, the UI shows:

- **Orange banner** in the chat panel: "Claude needs more information"
- **Dynamic placeholder** in input bar: "Respond to Claude's question..."
- **Agent state** changes to `awaiting_clarification`
- User's response clears the clarification state and resumes processing

### 4.4 Structured Response Methods

Users can respond to Claude in three ways:

| Method | How | When |
|--------|-----|------|
| **Form fields** | Jira project, story number, BQ project, file upload, context text | Initial request |
| **Chat follow-up** | Text input at bottom of chat panel | During/after processing |
| **Regenerate** | Click refresh button in SQL editor toolbar | After SQL is generated |

### 4.5 Conversation Resumption

The bridge maintains per-session state:
- **Session ID:** UUID generated on page load, shared across all requests
- **Message History:** Last 20 messages stored in memory
- **Claude Conversation ID:** Captured from Claude CLI `--resume` for native context continuation
- **Session Cleanup:** Sessions expire after 30 minutes of inactivity

---

## 5. Data Flow & SSE Events

### 5.1 Event Types

The bridge emits the following SSE events:

| Event | Data | UI Effect |
|-------|------|-----------|
| `status` | `{ stage, message }` | Pipeline tracker advances (regression-guarded — never moves backwards) |
| `activity_event` | `{ stage, type, status, title, summary, details[], confidence, evidence[], source }` | New card added to Activity Feed live during run |
| `message` | `{ content }` | Full assistant message displayed in SQL Curator Assistant pane |
| `sql` | `{ sql, fileName }` | SQL editor populated; only emitted when `sqlChecks.status === 'pass'` |
| `stm` | `{ stmArtifact }` | STM artifact stored; table viewer and download buttons activate |
| `validation` | `{ validationSummary }` | 5 structured section cards appended to Activity Feed |
| `clarification` | `{ message, options[], allowFreeText, explanation, details }` | Clarification card shown in SQL Curator Assistant; history entry created |
| `error` | `{ message }` | Error card shown in Assistant pane; pipeline stage marked failed at current stage |
| `done` | `{ success }` | Streaming stops, agent state finalized |

### 5.2 Pipeline Stages

```
idle → intake → analysis → schema_resolution → sql_generation → validation → ready
  │       │         │              │                  │              │         │
  │  User    Claude     Fetch Jira    List BQ         Generate     Dry-run    SQL
  │  submits  connects   story        datasets        SQL          SQL       ready
  │
  └─ Or: awaiting_clarification (Claude asked a question)
```

### 5.3 Request/Response Example

**Request (POST /api/chat):**
```json
{
  "sessionId": "a1b2c3d4-...",
  "taskType": "sql_generation",
  "jiraInput": { "project": "PROJ", "storyNumber": "1234" },
  "bqProjectId": "my-analytics-prod",
  "contextText": "Include date partitioning",
  "messages": [
    { "role": "user", "content": "[Jira] Project: PROJ, Story: 1234\n\n[BigQuery] Project: my-analytics-prod\n\nInclude date partitioning" }
  ]
}
```

**SSE Stream Response:**
```
event: status
data: {"stage":"intake","message":"Connecting to Claude Code...","timestamp":...}

event: status
data: {"stage":"analysis","message":"Claude is analyzing your request...","timestamp":...}

event: tool_call
data: {"tool":"jira_get_issue","args":{"issueKey":"PROJ-1234"},"timestamp":...}

event: tool_result
data: {"tool":"jira_get_issue","success":true,"summary":"Fetched: PROJ-1234 — Build daily revenue report","timestamp":...}

event: tool_call
data: {"tool":"bigquery_list_datasets","args":{"projectId":"my-analytics-prod"},"timestamp":...}

event: tool_result
data: {"tool":"bigquery_list_datasets","success":true,"summary":"Found 5 datasets: raw_data, staging, analytics, reporting, ml_features","timestamp":...}

event: status
data: {"stage":"sql_generation","message":"Generating SQL...","timestamp":...}

event: message
data: {"content":"## Analysis\nBased on Jira story PROJ-1234, I've designed...\n\n```sql\nSELECT ...","timestamp":...}

event: sql
data: {"sql":"SELECT date, SUM(revenue) ...","fileName":"generated_sql_1234.sql","timestamp":...}

event: done
data: {"success":true,"timestamp":...}
```

---

## 6. Configuration Reference

### 6.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CLAUDE_BRIDGE` | `true` | Route requests through claude-bridge.js |
| `BRIDGE_PORT` | `3001` | Port for the claude-bridge mini-service |
| `CLAUDE_MAX_CONCURRENT` | `3` | Max concurrent Claude CLI processes |
| `CLAUDE_MAX_TURNS` | `25` | Max agent turns per request |
| `CLAUDE_TIMEOUT_MS` | `180000` | Request timeout (3 minutes) |
| `MAX_HISTORY_MESSAGES` | `20` | Max messages per session history |
| `SQL_CURATOR_REQUIRE_DRYRUN_PASS` | `true` | If `true`, SQL is withheld from the UI unless `sqlChecks.status === 'pass'` |
| `SQL_CURATOR_DEFER_JIRA_COMPLETION` | `true` | If `true`, Jira comment + transition run in a separate follow-up Claude pass after the gate clears |
| `SQL_CURATOR_JIRA_COMPLETION_TIMEOUT_MS` | `120000` | Timeout for the Jira follow-up pass (2 minutes) |

### 6.2 MCP Server Configuration

MCP servers are configured in `~/.claude.json` (NOT in the application). This is by design — Claude Code CLI manages its own tool configuration.

| MCP Server | Required Tools | Environment Variables |
|------------|---------------|----------------------|
| **Jira** | `jira_get_issue`, `jira_search`, `jira_add_comment` | `JIRA_API_TOKEN`, `JIRA_BASE_URL` |
| **BigQuery** | `bigquery_list_datasets`, `bigquery_get_table_schema`, `bigquery_query` | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` |
| **GitHub** | `github_create_pr`, `github_push_file` | `GITHUB_TOKEN` |

---

## 7. Production Architecture Details

### 7.1 Activity Feed — Live Streaming Protocol

The Activity Feed (right panel, top section) shows architect-readable findings, decisions, inferences, and validations as they happen — not all at once at the end.

**How it works:**

1. Claude emits fenced ` ```activity ` JSON blocks inline during its response stream.
2. The bridge's `processInlineActivities()` scans each new text delta as it arrives and immediately forwards completed blocks as `activity_event` SSE events.
3. The frontend appends each card to the feed without waiting for the run to finish.
4. At run end, only the 5 structured validation section cards (Requirement Coverage, STM Completeness, Schema Reconciliation, SQL Checks, Jira Transition) are appended from the `validation` event.

**What appears in the feed:**
- Findings from each stage (intake, analysis, schema_resolution, sql_generation, validation, ready)
- Inferences with confidence % and evidence
- Decisions with rationale
- Dry-run results and auto-fixes
- No MCP plumbing language ("Calling BigQuery MCP" is never shown)

### 7.2 Two-Pass Jira Workflow

For Jira-backed runs, the Jira comment and status transition are strictly the last actions — enforced at the tool level:

**Main pass (Claude's generation run):**
- Jira write tools (`addCommentToJiraIssue`, `transitionJiraIssue`, etc.) are blocked via `--disallowedTools`
- Jira read tools remain available throughout
- `validation.jiraTransition.status` is set to `not_run`

**Follow-up pass (bridge-spawned after gate clears):**
- Triggered automatically by the bridge after `sqlChecks.status === 'pass'`
- A second Claude session resumes the same conversation with Jira writes enabled
- Posts comment + transitions to In Progress
- Result appears as a `Jira Transition` card in the Activity Feed

If the follow-up pass fails or is skipped, a `Jira Update Skipped` error card is added to the feed.

### 7.3 Strict Validation Gate

The bridge enforces: **SQL is only delivered to the UI if `validation.sqlChecks.status === 'pass'`**.

- Set `SQL_CURATOR_REQUIRE_DRYRUN_PASS=false` to disable (dev/testing only)
- If the gate blocks, the run is reported as failed and the Activity Feed shows the dry-run error cards
- Claude is instructed to diagnose and retry dry-run failures up to 3 times before failing

### 7.4 Stage Regression Guard

The Zustand `setStage` action refuses to move the pipeline tracker backwards. Stray tool-pair events that would re-activate an already-completed stage are dropped silently. This prevents the "Intake running" issue where late-arriving tool calls mapped to intake would reset the visible stage after the pipeline had already advanced to validation.

---

## 9. Troubleshooting

### 7.1 Claude CLI Not Found

**Symptom:** Bridge returns `503` with "Claude CLI not found"

**Solution:**
```bash
# Verify installation
which claude
claude --version

# If not found, install
npm install -g @anthropic-ai/claude-code

# Ensure it's on PATH
echo $PATH  # Should include npm global bin directory
```

### 7.2 MCP Tools Not Working

**Symptom:** Claude runs but tool calls fail or return empty results

**Solution:**
```bash
# Verify ~/.claude.json exists and is valid JSON
cat ~/.claude.json | python3 -m json.tool

# Test individual MCP server
claude -p "Use your Jira tool to fetch story PROJ-1234" --verbose

# Check MCP server logs in Claude's verbose output
# Look for lines starting with [mcp]
```

### 7.3 Bridge Not Responding

**Symptom:** UI shows "Claude Bridge is not running"

**Solution:**
```bash
# Check if bridge is running
curl http://127.0.0.1:3001/health

# If not running, start it
cd mini-services/claude-bridge
bun run dev

# Check for port conflicts
lsof -i :3001
```

### 7.4 Timeout Errors

**Symptom:** "Claude CLI timed out after 180s"

**Solution:**
```bash
# Increase timeout in .env.local
CLAUDE_TIMEOUT_MS=300000  # 5 minutes

# Or reduce complexity of the request
# (e.g., don't fetch too many table schemas at once)
```

### 7.5 Concurrency Limit

**Symptom:** "Server busy. 3 concurrent requests max"

**Solution:**
```bash
# Increase concurrency limit
CLAUDE_MAX_CONCURRENT=5

# Or wait for existing requests to complete
# Check active requests:
curl http://127.0.0.1:3001/health | jq .activeRequests
```

### 7.6 Claude Not Generating SQL

**Symptom:** Claude responds with questions instead of SQL

**Possible Causes:**
1. Requirements are genuinely unclear → This is expected behavior. Respond via chat.
2. Jira story fetch failed → Check MCP Jira configuration
3. BQ schema fetch failed → Check BigQuery credentials
4. Max turns reached before SQL generation → Increase `CLAUDE_MAX_TURNS`

### 7.7 Session Issues

```bash
# Clear a specific session via API
curl -X DELETE http://127.0.0.1:3001/session/YOUR_SESSION_ID

# Sessions auto-expire after 30 minutes of inactivity
# Use "New Session" button in the UI header to reset
```

---

## 10. Service Management

### 8.1 Running as Systemd Services (Linux)

**claude-bridge.service:**
```ini
[Unit]
Description=SQL Curator Claude Bridge
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/sql-curator/mini-services/claude-bridge
ExecStart=/usr/bin/node index.js
Environment=BRIDGE_PORT=3001
Environment=CLAUDE_MAX_CONCURRENT=3
Environment=CLAUDE_TIMEOUT_MS=180000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable claude-bridge
sudo systemctl start claude-bridge
sudo systemctl status claude-bridge
journalctl -u claude-bridge -f
```

### 8.2 Docker (Optional)

```dockerfile
# Dockerfile.bridge
FROM node:20-slim

WORKDIR /app
COPY package.json ./
COPY index.js ./

# Claude CLI must be available in the container
RUN npm install -g @anthropic-ai/claude-code

EXPOSE 3001
CMD ["node", "index.js"]
```

```bash
docker build -f Dockerfile.bridge -t sql-curator-bridge .
docker run -d -p 3001:3001 \
  -v ~/.claude.json:/root/.claude.json:ro \
  -e CLAUDE_MAX_CONCURRENT=3 \
  sql-curator-bridge
```

---

## 11. Security Considerations

### 9.1 Authentication

- Claude Bridge runs on `127.0.0.1` (localhost only) — not exposed to the network
- Claude Code CLI authenticates via Claude Pro/Max subscription
- MCP server credentials are in `~/.claude.json` (user-level, not app-level)

### 9.2 Data Flow

- All data flows locally between processes on the same machine
- No data is sent to external APIs (beyond Claude's own infrastructure)
- Jira/BigQuery/GitHub credentials are only accessible to Claude CLI via MCP

### 9.3 Input Sanitization

- User input is passed to Claude CLI as a prompt string
- Claude CLI handles its own prompt injection protections
- Bridge does not execute any user-provided code

---

## 12. File Reference

### 10.1 Project Structure

```
sql-curator/
├── .env.example                          # Environment variable template
├── claude-bridge.js                      # Legacy root-level bridge (deprecated)
├── mini-services/
│   └── claude-bridge/
│       ├── package.json                  # Mini-service package
│       └── index.js                      # ★ Claude Code CLI → SSE Bridge
├── src/
│   ├── app/
│   │   ├── page.tsx                      # Main split-screen UI
│   │   ├── globals.css                   # Theme & animations
│   │   ├── layout.tsx                    # Root layout
│   │   └── api/
│   │       ├── chat/route.ts             # ★ SSE chat endpoint (bridge-aware)
│   │       ├── generate/route.ts         # ★ SSE generate endpoint (bridge-aware)
│   │       ├── jobs/route.ts             # Jobs CRUD
│   │       └── sql/
│   │           ├── validate/route.ts     # SQL validation
│   │           └── analyze/route.ts      # SQL analysis
│   ├── components/split/
│   │   ├── left-panel.tsx                # SQL Editor + Pipeline Tracker
│   │   ├── right-panel.tsx               # Task Type + Inputs + Chat
│   │   ├── chat-panel.tsx                # ★ Bidirectional chat with SSE
│   │   ├── input-section.tsx             # ★ Submit form with SSE streaming
│   │   ├── sql-editor.tsx                # SQL output with syntax highlighting
│   │   ├── pipeline-tracker.tsx          # 7-stage animated pipeline
│   │   ├── task-type-selector.tsx        # Generate / Convert / Auto-detect
│   │   ├── jira-input.tsx                # Jira project + story number
│   │   ├── bq-project-input.tsx          # BigQuery project (mandatory)
│   │   ├── file-upload.tsx               # Drag & drop file upload
│   │   └── context-input.tsx             # Free-text context area
│   ├── lib/
│   │   ├── types.ts                      # ★ TypeScript types + bidirectional state
│   │   ├── agent.ts                      # Built-in agent (z-ai-web-dev-sdk fallback)
│   │   ├── api-clients.ts               # Jira/BQ/GitHub clients (real API only)
│   │   ├── sse-client.ts                 # Shared SSE types + event dispatcher
│   │   ├── bridge-forwarder.ts           # Shared Claude Bridge forwarding logic
│   │   ├── db.ts                         # Prisma client
│   │   └── utils.ts                      # cn() utility
│   └── stores/
│       └── use-app-store.ts              # ★ Zustand store (bidirectional state)
└── worklog.md                            # Development task history
```

### 10.2 Key Files Modified for Claude CLI Integration

| File | Purpose |
|------|---------|
| `mini-services/claude-bridge/index.js` | HTTP server that spawns `claude` CLI, pipes JSON-Lines to SSE |
| `src/app/api/chat/route.ts` | Forwards to bridge when `USE_CLAUDE_BRIDGE=true` |
| `src/app/api/generate/route.ts` | Same bridge support for regeneration |
| `src/stores/use-app-store.ts` | Added `interactionState`, `pendingClarification` |
| `src/lib/types.ts` | Added `ClarificationRequest`, `AgentInteractionState` |
| `src/components/split/chat-panel.tsx` | Handles `clarification` SSE event, shows banner |
| `src/components/split/input-section.tsx` | Handles `clarification` SSE event |
| `src/components/split/sql-editor.tsx` | Handles `clarification` SSE event |

---

## 13. Testing Guide

### 11.1 End-to-End Test

1. Start both services (bridge on 3001, Next.js on 3000)
2. Open the application in the browser
3. Select a Task Type (e.g., "Generate")
4. Fill in a Jira story number (e.g., PROJ-1234)
5. Select a BigQuery project (e.g., my-analytics-prod)
6. Click "Submit & Generate"
7. Watch the pipeline tracker progress through stages
8. Observe tool call indicators (spinning wrenches → green checks)
9. Review the generated SQL in the editor
10. Type a follow-up question in the chat input
11. Verify Claude responds with context from the conversation

### 11.2 Bidirectional Interaction Test

1. Submit a vague request (e.g., just a project name without story)
2. Claude should respond asking for more details
3. Verify the orange "Claude needs more information" banner appears
4. Type a response in the chat input
5. Claude should use the new information to generate SQL

### 11.3 Error Handling Test

1. Stop the claude-bridge service
2. Submit a request
3. UI should show "Claude Bridge is not running" error
4. Restart the bridge
5. Submit again — should work normally

---

## 14. Claude CLI Reference

### 12.1 Key Flags Used

| Flag | Purpose |
|------|---------|
| `-p -` | Read prompt from stdin (pipe mode) |
| `--output-format stream-json` | JSON-Lines streaming output format |
| `--max-turns N` | Limit agent loop iterations |
| `--resume ID` | Resume a previous conversation |
| `--verbose` | Include detailed MCP tool logs in stderr |

### 12.2 Output Format

The bridge parses Claude's `stream-json` output, which emits JSON-Lines:

```jsonl
{"type":"system","subtype":"init",...}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"jira_get_issue","input":{...}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Here's the SQL..."}]}}
{"type":"result","result":"...","conversation_id":"..."}
```

**Reference:** https://docs.anthropic.com/en/docs/claude-code/cli-reference

---

*Last updated: $(date -u +%Y-%m-%d)*
*Version: 1.0.0*
