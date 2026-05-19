#!/usr/bin/env node
// ============================================================
// claude-bridge.js — Claude Code CLI → HTTP/SSE Bridge
// ============================================================
//
// A local HTTP proxy that spawns `claude` CLI with
// --output-format stream-json, converts JSON-Lines output
// to Server-Sent Events compatible with the SQL Curator frontend.
//
// Architecture:
//   Browser → Next.js /api/chat → claude-bridge (port 3001)
//                                      ↓
//                               claude CLI (with MCP tools)
//                                      ↓
//                               Jira / BigQuery / GitHub
//
// Usage:
//   bun run dev          # Start with hot-reload (port 3001)
//   node index.js        # Start directly
//   BRIDGE_PORT=4001 bun run dev   # Custom port
//
// The claude CLI MUST have MCP servers configured in
// ~/.claude.json for this bridge to access Jira, BigQuery,
// BigQuery, and GitHub tools.
// ============================================================

'use strict';

const http = require('http');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { loadConfig } = require('./config');
const { createLogger, setLevel: setLogLevel, root: rootLogger } = require('./logging');
const metrics = require('./metrics');
const { validateChatBody } = require('./request-validation');

// ── Structured error responses ───────────────────────────────
// All error paths funnel through one helper so the wire format stays
// consistent and stack traces never leak to clients.
function sendError(res, status, code, message, extra = {}) {
  if (res.headersSent) return; // SSE responses are handled inline.
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: { code, message, ...extra },
  }));
}

// ── Configuration ─────────────────────────────────────────────
// Fail-fast at module load: malformed env vars throw with an aggregated list.
const CONFIG = loadConfig();
setLogLevel(CONFIG.logLevel);

// ── Request-scoped identifiers ───────────────────────────────
// Every HTTP request gets a short stable ID threaded into logs and error
// payloads so a single run can be grep'd end-to-end from client → bridge →
// Claude session → Jira follow-up → L3 cold session.
function newRequestId() {
  return crypto.randomUUID().slice(0, 8);
}

// ── Bridge-level runtime state ───────────────────────────────
// Exposed via /health and /metrics so operators can see last-error,
// in-flight counts, and current queue depth without grepping logs.
const bridgeState = {
  startedAt: Date.now(),
  lastErrorAt: null,
  lastErrorMessage: null,
};
function recordError(message) {
  bridgeState.lastErrorAt = Date.now();
  bridgeState.lastErrorMessage = String(message || '').slice(0, 500);
}

// ── Idempotency key tracking ─────────────────────────────────
// Protects against accidental double-submission of the same request — a
// refreshed tab, a fat-fingered double-click, a network retry. Within the
// TTL window, the SAME idempotency key is rejected with 409 instead of
// spawning a duplicate Claude session (which would cost twice and confuse
// the conversation state).
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const idempotency = new Map(); // key → { state: 'in_flight'|'completed', requestId, completedAt, succeeded }

function pruneIdempotency() {
  const now = Date.now();
  for (const [key, entry] of idempotency) {
    if (entry.state === 'completed' && (now - entry.completedAt) > IDEMPOTENCY_TTL_MS) {
      idempotency.delete(key);
    }
  }
}
// Periodic prune so the map can't grow unbounded under sustained traffic.
setInterval(pruneIdempotency, 60_000).unref();

const PORT = CONFIG.port;
const CLAUDE_MAX_TURNS = CONFIG.claude.maxTurns;
const CLAUDE_TIMEOUT_MS = CONFIG.claude.timeoutMs;
const MAX_HISTORY_MESSAGES = CONFIG.server.maxHistoryMessages;
const MAX_CONCURRENT = CONFIG.claude.maxConcurrent;
const MAX_REQUEST_BODY_BYTES = CONFIG.server.maxRequestBodyBytes;
const MAX_STREAM_BUFFER_BYTES = CONFIG.server.maxStreamBufferBytes;
const OFFLINE_DRY_RUN_ENABLED = CONFIG.features.offlineDryRunEnabled;
const REQUIRE_SQLCHECKS_PASS = CONFIG.features.requireSqlChecksPass;
const JIRA_WRITE_TOOLS = CONFIG.jiraWriteTools;
const JIRA_COMPLETION_ENABLED = CONFIG.features.jiraCompletionEnabled;
const JIRA_COMPLETION_TIMEOUT_MS = CONFIG.timeouts.jiraCompletionMs;
const BQ_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BQ_DATASET_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

function validateTargetScope(bqProjectId, bqDatasetId) {
  if (!bqProjectId || typeof bqProjectId !== 'string' || !bqProjectId.trim()) {
    return 'Target BigQuery Project ID is required';
  }
  if (!BQ_PROJECT_ID_PATTERN.test(bqProjectId.trim())) {
    return 'Target BigQuery Project ID must be a valid Google Cloud project ID';
  }
  if (!bqDatasetId || typeof bqDatasetId !== 'string' || !bqDatasetId.trim()) {
    return 'Target BigQuery Dataset ID is required';
  }
  if (!BQ_DATASET_ID_PATTERN.test(bqDatasetId.trim())) {
    return 'Target BigQuery Dataset ID must contain only letters, numbers, and underscores and cannot start with a number';
  }
  return null;
}

// ── In-memory session store ───────────────────────────────────
// Maps sessionId → { messages: [...], conversationId: string | null, lastActivity: Date }

const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      conversationId: null, // Claude's --resume conversation ID
      lastActivity: Date.now(),
      stmVersion: 0,
    });
  }
  return sessions.get(sessionId);
}

function nextStmVersion(sessionId) {
  const session = getSession(sessionId);
  session.stmVersion = (session.stmVersion || 0) + 1;
  return session.stmVersion;
}

function trimSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.messages.length > MAX_HISTORY_MESSAGES) {
    session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
  }
}

// Cleanup stale sessions every 5 minutes (30 min idle TTL)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > 30 * 60 * 1000) {
      console.log(`  [cleanup] Session ${id.slice(0, 8)} expired`);
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Active request tracking for concurrency limits
let activeRequests = 0;

// ── Spawned process registry (for clean shutdown) ─────────────
const spawnedProcs = new Set();

// ── Claude CLI availability check ─────────────────────────────

let claudePath = null;

function findClaude() {
  if (claudePath) return claudePath;

  const candidates = ['claude', 'claude-code'];
  for (const cmd of candidates) {
    try {
      // Pass the full command as a single string when shell:true to avoid
      // Node 22 DEP0190 (mixing args array with shell:true is deprecated).
      // The cmd values here are hardcoded literals, so interpolation is safe.
      const result = spawnSync(`${cmd} --version`, {
        timeout: 5000,
        shell: true,
      });
      if (result.status === 0) {
        claudePath = cmd;
        console.log(`  [init] Found Claude CLI: ${cmd}`);
        return cmd;
      }
    } catch { /* not found */ }
  }

  // Try common paths
  const paths = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    path.join(os.homedir(), 'node_modules', '.bin', 'claude'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      claudePath = p;
      console.log(`  [init] Found Claude CLI at: ${p}`);
      return p;
    }
  }

  return null;
}

// ── Prompt Builder ────────────────────────────────────────────

function loadSqlForgeSkill() {
  const skillPath = path.resolve(__dirname, '..', '..', 'skills', 'sqlforge', 'SKILL.md');
  try {
    return fs.readFileSync(skillPath, 'utf8').trim();
  } catch (err) {
    console.error(`  [skill] Unable to load SQL Curator skill: ${err.message}`);
    return '';
  }
}

function buildThinShellPrompt(request) {
  const { messages, taskType, jiraInput, bqProjectId, bqDatasetId, contextText } = request;
  const sqlForgeSkill = loadSqlForgeSkill();
  const targetProject = String(bqProjectId || '').trim();
  const targetDataset = String(bqDatasetId || '').trim();

  const instructions = `# SQL Curator — Claude Code Workflow Engine

You are the complete workflow engine for a minimalist SQL generation UI. The UI is only a presentation layer: it collects input, sends it here, renders your status/questions/final SQL, and must not make business or workflow decisions.

## SQL Curator Skill Contract
Follow the SQL Curator skill instructions below as the stable operating contract for this request. If anything in the skill conflicts with the hard constraints in this prompt, the hard constraints win.

${sqlForgeSkill || 'SQL Curator skill file was not available; use the hard constraints and workflow rules in this prompt.'}

## Hard Constraints
- The UI and Next.js routes must use zero external APIs and must not contain business workflow logic.
- Claude Code owns all workflow decisions and must use the enabled native Jira and BigQuery MCP connectors when Jira or BigQuery lookup is needed.
- Claude Code must use the enabled native GitHub MCP connector when the requested mode is GitHub deployment.
- Do not build or assume custom MCP connectors for this POC.
- Do not execute mutating SQL. Read-only metadata inspection and dry runs are allowed only inside Claude Code when required for schema reconciliation or validation.
- Treat uploaded files and free text as direct local context.
- Supported uploaded file context is plain text only: TXT, CSV, JSON, MD, and SQL. Do not assume PDF, DOCX, XLSX, or PPTX extraction exists in this POC.
- The BigQuery project ID and dataset ID are mandatory. Treat them as the target BigQuery scope for generated object names, schema reconciliation, inference, and dry-run validation.
- Do not infer, scan, or reconcile schemas outside the mandatory target dataset. If needed details are absent from that dataset, ask a focused clarification instead of crawling other datasets.
- If a Jira reference is supplied, fetch the story details with the native Jira MCP connector and merge the story description, acceptance criteria, comments, and relevant linked context into the session context before deciding whether to generate or clarify.
- After SQL is generated successfully for a supplied Jira story, use the native Jira MCP connector to post a Jira comment and transition that Jira issue to In Progress. The comment must summarize SQL generation, STM status, validation result, dry-run result when available, output artifact summary, assumptions, and unresolved warnings. If either Jira action is unavailable, include the exact failure as validation feedback instead of failing SQL generation.
- If Jira fetching fails or the connector is unavailable, ask the user to provide the story details instead of guessing.
- Do not deploy to GitHub during SQL generation. GitHub deployment is allowed only when Requested Mode is github_deploy, which is triggered by the user's deployment icon action.
- Emit concise visible activity checkpoints as you work: what you fetched, analyzed, investigated, inferred, assumed, validated, dry-run errors/fixes, and Jira/GitHub actions. Do not expose private chain-of-thought; provide architect-readable rationale, findings, and decisions.

## Workflow You Own
1. Intake and consolidate every supplied source into one requirement context.
2. Identify the target use case: generate SQL, convert SQL, or clarify requirement.
3. Detect schema, mappings, business logic, target tables, joins, filters, and transformation rules from the provided context.
4. If context is sufficient, generate production-oriented BigQuery SQL immediately.
5. Validate the generated SQL against only the supplied source inputs: mapping completeness, stated business rules, obvious schema/logic gaps, and syntax-level reasonableness.
6. Infer missing non-critical details when confidence is 90% or higher.
7. If confidence is below 90% for a critical detail, ask one focused clarification and stop.
8. After a clarification answer, resume from the unresolved stage only. Do not restart at Intake unless the original context is invalid or missing.
9. If the user selects one of your clarification options or explicitly approves a proposed mapping, treat that answer as authorization to continue with that mapping. Do not ask the same clarification again. Continue to STM construction, SQL generation, dry-run validation when possible, and return warnings for any remaining low-confidence business semantics.

## GitHub Deployment Mode
When Requested Mode is github_deploy:
- Treat the provided generated SQL and STM artifact as the source of truth.
- Use the native GitHub MCP connector only. Do not use custom GitHub APIs from the UI.
- Determine repository, branch, file path, and PR/commit expectation from the supplied context, Jira story, or conversation history.
- If repository, branch, or destination path cannot be inferred with at least 90% confidence, return a clarification using the required clarification JSON format.
- If sufficient, push or create the requested GitHub change through Claude Code and return a concise deployment summary.
- Do not modify SQL business logic during deployment unless the user explicitly requests it.

## Schema Reconciliation Policy
- If target project ID, target dataset ID, table names, column names, and join/filter rules are explicit and internally consistent, do not infer or inspect unrelated schema. Proceed directly to SQL generation and validation.
- The supplied target dataset is the hard boundary for BigQuery investigation. Use native BigQuery MCP only to inspect tables/views/columns inside that dataset.
- If schema details are implicit, missing, or ambiguous, derive scoped search terms from the intake context first: business domain, target subject area, entities, table prefixes, mapping names, Jira keywords, uploaded file headings, and free-text nouns, then apply those terms only inside the target dataset.
- Do not list, crawl, or reconcile all datasets in the project. Do not search other datasets for alternatives unless the user explicitly changes the target dataset.
- Prefer exact or near-exact table candidates named in the intake within the target dataset. If multiple meaningful candidates remain within that dataset, ask the user to choose.
- If meaningful candidates cannot be inferred within the target dataset, ask a direct clarification question and request table/column context or a corrected dataset from the user.
- Clarification must include selectable options when candidates exist, plus a free-text path for more context. If no candidates exist, ask the question directly and use the free-text path only.

## Pipeline Stages
Use this progression conceptually: Intake -> Analyze -> Schema -> Generate -> Validate -> Ready.
Never reset from Schema or Generate back to Intake unless the input payload is incomplete or corrupted.

## Clarification Format
When information is required, end with [CLARIFY] and include this exact fenced JSON block:
\`\`\`clarification
{"explanation":"Short reason the workflow is blocked","details":"Investigation findings, candidates, rationale, confidence, and checkpoint text for SQL Curator Assistant","question":"Focused question","options":["Option A","Option B"],"allowFreeText":true}
\`\`\`
Use 2-5 options whenever possible. Ask no vague open-ended question unless options are impossible. Put BigQuery investigation findings and confirmation context in details so the Assistant pane can show the user exactly what Claude found before they answer.

## Final Output Format
When SQL is ready, include:
1. A concise validation summary.
2. Optional assumptions made during inference.
3. Jira comment and transition feedback when a Jira story was supplied, including whether a comment was posted and whether the story was moved to In Progress.
4. The generated SQL in a single \`\`\`sql fenced block.
5. A required STM artifact in a \`\`\`stm fenced JSON block using:
{"title":"STM Title","description":"Brief description","rows":[{"sourceField":"field_name","sourceTable":"table_name","sourceType":"data_type","targetColumn":"column_name","targetTable":"table_name","targetType":"data_type","transformation":"TRANSFORM","businessRule":"RULE","notes":"NOTE"}]}
6. A required validation artifact in a \`\`\`validation fenced JSON block using:
{"activityLog":[{"stage":"analysis","type":"observation","status":"completed","title":"Intake classified","summary":"What Claude observed or decided","details":["Optional extra detail"],"confidence":95,"evidence":["Optional evidence"],"timestamp":0,"source":"claude"}],"activityDetails":["Summarize what Claude fetched, analyzed, found, reconciled, inferred, assumed, validated, and updated."],"inferences":["List each material inference or auto-approved assumption used for STM/SQL generation, including confidence when useful. If none, say no material inference was required."],"requirementCoverage":{"status":"pass","summary":"What requirement coverage was validated","checks":["Concrete check"]},"stmCompleteness":{"status":"pass","summary":"What STM completeness was validated","checks":["Concrete check"]},"schemaReconciliation":{"status":"pass","summary":"What schema reconciliation was validated","checks":["Concrete check"]},"sqlChecks":{"status":"pass","summary":"What SQL checks were validated","checks":["Concrete check"]},"jiraTransition":{"status":"pass","summary":"Jira comment and transition result, or reason not applicable","checks":["Jira comment posted or failure reason","Jira transition result or failure reason"]}}
Use status values only from pass, warning, fail, and not_run.
For activityLog status use only running, completed, warning, failed, blocked, or pending. For activityLog type use only observation, inference, decision, validation, error, or artifact. NEVER use type "tool" — tool invocations are not user-facing; describe what was learned from a tool result, not that a tool was called. For activityLog source use only claude, bridge, jira, bigquery, github, offline, or fallback.

LIVE ACTIVITY FEED — INLINE BLOCKS REQUIRED
The Activity pane streams from inline \`\`\`activity blocks you emit during the run. The bridge scans your streaming text for these blocks and forwards each as an SSE event the moment its closing fence arrives. If you only emit findings in the final validation block, the user sees nothing happening until the end. Stream them as you go.

Required inline format — emit one of these after each significant step (intake, analysis findings, schema decisions, STM completion, dry-run attempts, dry-run fixes, Jira actions). One JSON object per block, blank line before and after, on its own lines:

\`\`\`activity
{"stage":"analysis","type":"observation","status":"completed","title":"Fetched SCRUM-21","summary":"Top 3 customers by total broadband usage for a specified month.","evidence":["Jira description excerpt","AC3: filter for a specific month"],"source":"jira"}
\`\`\`

Hard requirements:
- At least one inline activity block at the close of each stage you actually executed (intake, analysis, schema_resolution, sql_generation, validation, ready).
- Within a stage, additional blocks for material findings, inferences, decisions, validations, dry-run attempts, fixes, retries, and unresolved errors.
- Each entry states the FINDING, not the action. Bad: "Called getJiraIssue." Good: "SCRUM-21 acceptance criteria require top-N ranking, monthly grain, total broadband usage = downlink+uplink."
- type "inference" and type "decision" entries MUST include evidence[].
- type "error" entries state the diagnosis and what was done about it (fix, retry, surfaced for clarification).
- Do not narrate the same finding twice; the bridge dedupes by raw JSON payload.
- Do not echo the SQL or STM in the activity log.
- Forbidden phrases in title/summary: "Calling", "Invoking", "Tool", "MCP", "Running tool", "Fetching via", "BigQuery MCP", "Jira MCP".
- The final validation.activityLog[] field is now optional. If present, it should be a deduplicated summary only.

STRICT JIRA STEP ORDERING (Jira-backed runs only) — TOOL-GATED
The bridge enforces ordering at the tool level. During THIS main pass the Jira WRITE tools are disallowed: addCommentToJiraIssue, transitionJiraIssue, editJiraIssue, createJiraIssue, addWorklogToJiraIssue, createIssueLink. They will not appear in your toolset and will fail if attempted. Do not try to call them. Jira READ tools (getJiraIssue, searchJiraIssuesUsingJql) remain available.

After your main pass produces SQL/STM/validation and the strict gate passes (sqlChecks.status === "pass"), the bridge spawns a follow-up Claude pass that resumes this same conversation with Jira write tools re-enabled. That follow-up will post the comment and transition the issue automatically.

Your main pass sequence:
1. Intake: fetch Jira story (read). Emit activity block.
2. Analyze: extract acceptance criteria. Emit activity blocks.
3. Schema: reconcile within target dataset. Emit activity blocks.
4. Generate: build STM, write SQL. Emit activity blocks.
5. Validate: run BigQuery dry run, retry up to 3x on failure. Emit one activity block per attempt + fix.
6. Ready: emit ready activity block, then final SQL/STM/validation fenced blocks, then [SQL_READY].

In the validation JSON block, set jiraTransition.status to "not_run" with summary "Deferred to bridge follow-up pass after gate clears." — the bridge's follow-up will overwrite the user-facing result with the real outcome.

Activity details must include dry-run attempts, dry-run errors, diagnosis, fixes applied, retry outcomes, and unresolved failures whenever those occur.

STRICT GATE: The bridge withholds generated SQL from the UI unless validation.sqlChecks.status is exactly "pass". If you emit [SQL_READY] with sqlChecks.status set to warning/fail/not_run, the user sees the run as failed and no SQL is released. Always run a BigQuery dry run (and the diagnose-fix-retry loop up to 3 times) before declaring readiness. If a dry run is impossible (no MCP, permission denied), set sqlChecks.status to "warning" and surface a clarification rather than emitting [SQL_READY].
7. End with [SQL_READY].

## BigQuery SQL Rules
Generate BigQuery SQL with appropriate source tables, target object, column mappings, joins, filters, aggregations, business rules, null handling, casting, date logic, aliases, and useful comments. Prefer CTEs, SAFE_DIVIDE, COUNTIF, QUALIFY for window filters, COALESCE/IFNULL for nullable inputs, and clear aliases.`;

  const parts = [instructions];
  parts.push(`## Requested Mode\n${taskType || 'sql_generation'}`);

  if (jiraInput?.project || jiraInput?.storyNumber) {
    const storyRef = [jiraInput.project, jiraInput.storyNumber].filter(Boolean).join('-');
    parts.push(`## Jira Story Reference\n${storyRef || JSON.stringify(jiraInput)}\n\nFetch this Jira story using the enabled native Jira MCP connector. Add the fetched story details to the working context before requirement analysis. Do not use custom connectors.`);
  }

  parts.push(`## Target BigQuery Scope\nProject ID: ${targetProject}\nDataset ID: ${targetDataset}\n\nThis target dataset is mandatory and is the hard boundary for BigQuery schema reconciliation, inference, generated object qualification, and dry-run validation. Inspect or infer only within \`${targetProject}.${targetDataset}\`. If the Jira story, file, or free text points to missing or ambiguous objects, ask for clarification instead of crawling other datasets.`);

  if (contextText?.trim()) {
    parts.push(`## Consolidated User Context\n${contextText.trim()}`);
  }

  if (messages && messages.length > 0) {
    const recent = messages.slice(-MAX_HISTORY_MESSAGES);
    parts.push('## Conversation History');
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      parts.push(`**${role}:** ${msg.content}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

function buildPrompt(request) {
  return buildThinShellPrompt(request);
}

// ── SQL Extraction ────────────────────────────────────────────

function extractSql(content) {
  // Accept common BigQuery fence labels models actually emit.
  const labeled = content.match(/```(?:sql|bigquery|bq|googlesql)\s*\n([\s\S]*?)```/i);
  if (labeled) return labeled[1].trim();
  // Fallback: bare fenced block whose body clearly looks like SQL.
  const bare = content.match(/```\s*\n([\s\S]*?)```/);
  if (bare) {
    const body = bare[1];
    if (/\b(SELECT|WITH|CREATE|INSERT|UPDATE|DELETE|MERGE)\b/i.test(body)) {
      return body.trim();
    }
  }
  return null;
}

// ── STM Extraction ────────────────────────────────────────────

function extractStm(content, request, sessionId) {
  const match = content.match(/```stm\s*\n([\s\S]*?)```/i);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed.rows || !Array.isArray(parsed.rows)) return null;

    // Determine source type from request
    let source = 'text';
    if (request.jiraInput?.project && request.jiraInput?.storyNumber) source = 'jira';

    return {
      rows: parsed.rows.map(r => ({
        sourceField: String(r.sourceField || ''),
        sourceTable: String(r.sourceTable || ''),
        sourceType: String(r.sourceType || ''),
        targetColumn: String(r.targetColumn || ''),
        targetTable: String(r.targetTable || ''),
        targetType: String(r.targetType || ''),
        transformation: String(r.transformation || ''),
        businessRule: String(r.businessRule || ''),
        notes: String(r.notes || ''),
      })),
      title: String(parsed.title || 'Source-to-Target Mapping'),
      description: String(parsed.description || 'Auto-generated STM artifact'),
      source,
      jiraRef: source === 'jira' ? `${request.jiraInput.project}-${request.jiraInput.storyNumber}` : undefined,
      bqProject: String(request.bqProjectId || ''),
      bqDataset: String(request.bqDatasetId || ''),
      generatedAt: new Date().toISOString(),
      version: nextStmVersion(sessionId),
    };
  } catch (err) {
    console.error(`  [stm] Failed to parse STM JSON: ${err.message}`);
    return null;
  }
}

// ── L2: Deterministic SQL ↔ STM structural validators ───────
// These run without any LLM. They parse the SQL and STM mechanically and
// compare structural elements: target column coverage, source table coverage,
// target object match, output schema vs declared types. The bridge owns
// these verdicts. No interpretation, no bias.

function parseStmRows(stmBlock) {
  if (!stmBlock) return null;
  try {
    const parsed = JSON.parse(stmBlock.trim());
    if (!parsed.rows || !Array.isArray(parsed.rows)) return null;
    return parsed.rows.map((r) => ({
      sourceField: String(r.sourceField || '').trim(),
      sourceTable: String(r.sourceTable || '').trim(),
      sourceType: String(r.sourceType || '').trim().toUpperCase(),
      targetColumn: String(r.targetColumn || '').trim(),
      targetTable: String(r.targetTable || '').trim(),
      targetType: String(r.targetType || '').trim().toUpperCase(),
    }));
  } catch {
    return null;
  }
}

// Strip SQL strings and comments to make table/column parsing safer.
function stripSqlLiteralsAndComments(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ')           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")  // single-quoted strings
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""'); // double-quoted (identifiers we don't care about here)
}

// Find the column aliases of the *outermost* SELECT — i.e. the columns the
// query actually returns to the caller. We pick the last top-level SELECT
// before any closing constructs and pull its column list.
function extractFinalSelectColumns(sql) {
  const stripped = stripSqlLiteralsAndComments(sql);
  // Find every top-level SELECT (depth 0); the LAST one is the output shape.
  let depth = 0;
  const selects = []; // { start, end }
  const upper = stripped.toUpperCase();
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && upper.startsWith('SELECT', i) && /\W/.test(stripped[i - 1] || ' ')) {
      // Find the matching FROM at depth 0
      let d = 0;
      for (let j = i + 6; j < stripped.length; j++) {
        const c = stripped[j];
        if (c === '(') d++;
        else if (c === ')') d = Math.max(0, d - 1);
        if (d === 0 && upper.startsWith('FROM', j) && /\W/.test(stripped[j - 1] || ' ') && /\W/.test(stripped[j + 4] || ' ')) {
          selects.push({ start: i + 6, end: j });
          i = j;
          break;
        }
      }
    }
  }
  if (selects.length === 0) return [];
  const last = selects[selects.length - 1];
  const colSegment = stripped.slice(last.start, last.end);

  // Split by top-level commas
  const cols = [];
  let buf = '';
  let d = 0;
  for (const ch of colSegment) {
    if (ch === '(') d++;
    else if (ch === ')') d = Math.max(0, d - 1);
    if (ch === ',' && d === 0) {
      cols.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) cols.push(buf.trim());

  // For each expression, extract the trailing alias (the actual output name).
  return cols
    .map((expr) => {
      const m = expr.match(/(?:\bAS\s+)?([`"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/i);
      return m ? m[2] : null;
    })
    .filter(Boolean);
}

// Extract every table referenced in FROM / JOIN clauses (project.dataset.table
// or dataset.table or table). Returns the bare table name in lowercase for
// matching purposes.
function extractSourceTables(sql) {
  const stripped = stripSqlLiteralsAndComments(sql).replace(/`/g, '');
  const tables = new Set();
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*){0,2})/gi;
  let m;
  while ((m = re.exec(stripped))) {
    tables.add(m[1].toLowerCase());
  }
  return Array.from(tables);
}

// Best-effort detection of the target object the SQL is producing. If the
// SQL is a CREATE TABLE/VIEW statement, return the named target. Otherwise
// returns null (caller can fall back to the request's target scope).
function extractTargetTable(sql) {
  const stripped = stripSqlLiteralsAndComments(sql).replace(/`/g, '');
  const m = stripped.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*){0,2})/i);
  return m ? m[1].toLowerCase() : null;
}

// Canonicalise an MCP tool_result content into a structured object when
// possible. Different MCP servers wrap their responses differently:
//
//   • Raw JSON string:           "{ \"statistics\": ... }"
//   • Already-parsed object:     { statistics: ... }
//   • Anthropic content array:   [{ type: "text", text: "{...}" }, ...]
//   • Plain text summary:        "Query valid. Estimated 1.2 GB."
//
// Returns { json: object|null, text: string }. `json` is the parsed payload
// when extractable; `text` is the best-effort string form (for error
// messages, logging, fallback heuristics).
function canonicaliseToolResultContent(content) {
  if (content === null || content === undefined) return { json: null, text: '' };

  // Pre-parsed object — try to use directly.
  if (typeof content === 'object' && !Array.isArray(content)) {
    return { json: content, text: safeJsonStringify(content) };
  }

  // Anthropic content array — concatenate text blocks.
  if (Array.isArray(content)) {
    const textParts = [];
    for (const block of content) {
      if (block && typeof block === 'object' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (typeof block === 'string') {
        textParts.push(block);
      }
    }
    const joined = textParts.join('\n');
    const json = tryParseJson(joined);
    return { json, text: joined };
  }

  if (typeof content === 'string') {
    const json = tryParseJson(content);
    return { json, text: content };
  }

  return { json: null, text: String(content) };
}

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function safeJsonStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

// BigQuery dry-run responses (when surfaced through the MCP unchanged) include
// `statistics.query.schema.fields[]`. Try to find it via the canonical parser.
// Returns the fields array or null if not present in any recognised shape.
function parseDryRunOutputSchema(resultText) {
  const { json } = canonicaliseToolResultContent(resultText);
  if (!json) return null;
  const fields =
    json?.statistics?.query?.schema?.fields ||
    json?.schema?.fields ||
    json?.outputSchema ||
    null;
  if (!Array.isArray(fields)) return null;
  return fields.map((f) => ({
    name: String(f.name || '').trim(),
    type: String(f.type || f.fieldType || '').trim().toUpperCase(),
  })).filter((f) => f.name);
}

// Normalise type strings so STM "INTEGER" matches BQ "INT64", etc.
function canonicalBqType(t) {
  const v = String(t || '').toUpperCase();
  if (v === 'INTEGER' || v === 'INT') return 'INT64';
  if (v === 'FLOAT' || v === 'DOUBLE') return 'FLOAT64';
  if (v === 'BOOL') return 'BOOLEAN';
  return v;
}

// Compare table references with tail-matching — the SQL may reference
// `project.dataset.table` while the STM declared just `table`, or vice versa.
function tablesMatch(a, b) {
  const ap = a.toLowerCase().split('.').filter(Boolean);
  const bp = b.toLowerCase().split('.').filter(Boolean);
  if (ap.length === 0 || bp.length === 0) return false;
  const min = Math.min(ap.length, bp.length);
  for (let i = 1; i <= min; i++) {
    if (ap[ap.length - i] !== bp[bp.length - i]) return false;
  }
  return true;
}

// Runs all L2 structural checks against the extracted artifacts.
// Returns: { status: 'pass'|'fail'|'warning', summary, checks[] }
function runStructuralChecks(sqlBlock, stmBlock, lastDryRunResultText) {
  const checks = [];

  const stmRows = parseStmRows(stmBlock);
  if (!stmRows || stmRows.length === 0) {
    return {
      status: 'warning',
      summary: 'STM block was missing or unparsable — structural checks could not run.',
      checks: ['STM JSON block is required for L2 structural validation.'],
    };
  }

  // Check 1 — target column coverage
  const sqlOutputCols = extractFinalSelectColumns(sqlBlock).map((c) => c.toLowerCase());
  const stmTargetCols = stmRows.map((r) => r.targetColumn).filter(Boolean);
  const missingCols = stmTargetCols.filter(
    (c) => c && !sqlOutputCols.includes(c.toLowerCase())
  );
  checks.push({
    name: 'target_column_coverage',
    status: missingCols.length === 0 ? 'pass' : 'fail',
    detail: missingCols.length === 0
      ? `All ${stmTargetCols.length} STM target columns appear in the SQL output.`
      : `Missing in SQL output: ${missingCols.join(', ')}.`,
  });

  // Check 2 — source table coverage
  const sqlTables = extractSourceTables(sqlBlock);
  const stmSourceTables = Array.from(new Set(stmRows.map((r) => r.sourceTable).filter(Boolean)));
  const missingTables = stmSourceTables.filter(
    (st) => !sqlTables.some((qt) => tablesMatch(st, qt))
  );
  checks.push({
    name: 'source_table_coverage',
    status: missingTables.length === 0 ? 'pass' : 'fail',
    detail: missingTables.length === 0
      ? `All ${stmSourceTables.length} STM source table(s) referenced by the SQL.`
      : `Missing FROM/JOIN reference: ${missingTables.join(', ')}.`,
  });

  // Check 3 — target table match
  const sqlTarget = extractTargetTable(sqlBlock);
  const stmTarget = stmRows[0]?.targetTable || '';
  if (!sqlTarget) {
    checks.push({
      name: 'target_table_match',
      status: 'warning',
      detail: 'SQL has no CREATE TABLE/VIEW statement; target object cannot be verified.',
    });
  } else if (!stmTarget) {
    checks.push({
      name: 'target_table_match',
      status: 'warning',
      detail: 'STM rows did not declare a target table.',
    });
  } else if (tablesMatch(sqlTarget, stmTarget)) {
    checks.push({
      name: 'target_table_match',
      status: 'pass',
      detail: `SQL target ${sqlTarget} matches STM target ${stmTarget}.`,
    });
  } else {
    checks.push({
      name: 'target_table_match',
      status: 'fail',
      detail: `SQL target ${sqlTarget} does not match STM target ${stmTarget}.`,
    });
  }

  // Check 4 — output schema vs STM target columns/types (from BQ dry-run)
  const schema = parseDryRunOutputSchema(lastDryRunResultText);
  if (!schema) {
    checks.push({
      name: 'output_schema_vs_stm',
      status: 'not_run',
      detail: 'BigQuery dry-run response did not expose the output schema (MCP wrapping); type-level check skipped.',
    });
  } else {
    const stmByName = new Map(stmRows.map((r) => [r.targetColumn.toLowerCase(), r]));
    const schemaByName = new Map(schema.map((f) => [f.name.toLowerCase(), f]));
    const schemaNames = new Set(schemaByName.keys());
    const stmNames = new Set(stmByName.keys());
    const missingFromSchema = [...stmNames].filter((n) => !schemaNames.has(n));
    const extraInSchema = [...schemaNames].filter((n) => !stmNames.has(n));
    const typeMismatches = [];
    for (const [name, field] of schemaByName) {
      const stmRow = stmByName.get(name);
      if (!stmRow || !stmRow.targetType) continue;
      const sqlType = canonicalBqType(field.type);
      const stmType = canonicalBqType(stmRow.targetType);
      if (sqlType !== stmType) {
        typeMismatches.push(`${name}: SQL=${sqlType}, STM=${stmType}`);
      }
    }
    const schemaIssues = [];
    if (missingFromSchema.length) schemaIssues.push(`Declared in STM but missing from SQL output: ${missingFromSchema.join(', ')}.`);
    if (extraInSchema.length) schemaIssues.push(`Produced by SQL but not in STM: ${extraInSchema.join(', ')}.`);
    if (typeMismatches.length) schemaIssues.push(`Type mismatch — ${typeMismatches.join('; ')}.`);

    checks.push({
      name: 'output_schema_vs_stm',
      status: schemaIssues.length === 0 ? 'pass' : 'fail',
      detail: schemaIssues.length === 0
        ? `BigQuery dry-run output schema matches STM (${schema.length} columns).`
        : schemaIssues.join(' '),
    });
  }

  const anyFail = checks.some((c) => c.status === 'fail');
  const anyWarning = checks.some((c) => c.status === 'warning' || c.status === 'not_run');
  const status = anyFail ? 'fail' : anyWarning ? 'warning' : 'pass';
  const summary = anyFail
    ? 'SQL does not structurally match the STM. See check details.'
    : anyWarning
      ? 'SQL aligns with the STM for verifiable checks; some checks could not be run.'
      : 'SQL structurally matches the STM on all checks.';

  return { status, summary, checks };
}

function extractValidationSummary(content, request = {}) {
  const hasSql = !!extractSql(content);
  const hasStm = /```stm\s*\n[\s\S]*?```/i.test(content);
  const hasJira = !!(request.jiraInput?.project || request.jiraInput?.storyNumber);
  const jiraSignals = extractJiraSignals(content, hasJira);
  const inferences = extractInferenceNotes(content);
  const activityDetails = extractActivityDetails(content);

  const validationMatch = content.match(/```validation\s*\n([\s\S]*?)```/i);
  if (validationMatch) {
    try {
      return normalizeValidationSummary(JSON.parse(validationMatch[1].trim()), {
        hasSql,
        hasStm,
        hasJira,
        jiraSignals,
        inferences,
        activityDetails,
      });
    } catch (err) {
      console.error(`  [validation] Failed to parse validation JSON: ${err.message}`);
    }
  }

  const withoutSql = content
    .replace(/```sql\s*\n[\s\S]*?```/gi, '')
    .replace(/```stm\s*\n[\s\S]*?```/gi, '')
    .replace(/```validation\s*\n[\s\S]*?```/gi, '')
    .replace('[SQL_READY]', '')
    .trim();

  const lines = withoutSql
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));

  const detailLines = lines
    .filter((line) => !/^validation summary:?$/i.test(line))
    .slice(0, 8);

  return normalizeValidationSummary({
    requirementCoverage: {
      status: hasSql ? 'pass' : 'warning',
      summary: detailLines[0] || 'Requirements were reviewed against the generated SQL.',
      checks: detailLines.length > 0 ? detailLines.slice(0, 3) : ['Generated SQL was compared with available requirement context.'],
    },
    stmCompleteness: {
      status: hasStm ? 'pass' : 'warning',
      summary: hasStm ? 'STM artifact was returned with the generated SQL.' : 'Structured STM artifact was not returned; using validation fallback.',
      checks: [hasStm ? 'Fenced STM JSON block was detected.' : 'Claude should return a fenced stm JSON block with every generated SQL response.'],
    },
    schemaReconciliation: {
      status: 'warning',
      summary: 'Schema reconciliation details were not returned in structured form.',
      checks: ['Bridge preserved Claude validation text as fallback.', 'Scoped schema evidence should be reviewed if ambiguity remains.'],
    },
    sqlChecks: {
      status: hasSql ? 'pass' : 'warning',
      summary: hasSql ? 'SQL fenced block was present and emitted to the UI.' : 'SQL block was not detected in Claude output.',
      checks: hasSql
        ? ['SQL block was extracted successfully.', 'Validation stage completed after SQL generation.']
        : ['Claude should return generated SQL in a fenced sql block.'],
    },
    jiraTransition: {
      status: jiraSignals.status,
      summary: jiraSignals.summary,
      checks: jiraSignals.checks,
    },
    generatedAt: new Date().toISOString(),
  }, {
    hasSql,
    hasStm,
    hasJira,
    jiraSignals,
    inferences,
    activityDetails,
  });
}

function detectTerminalRunIssue(content) {
  const text = String(content || '');
  if (/hit your limit|usage limit|rate limit|resets?\s+\d|quota/i.test(text)) {
    const limitLine = text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /hit your limit|usage limit|rate limit|resets?\s+\d|quota/i.test(line));
    return {
      kind: 'claude_limit',
      message: limitLine || 'Claude Code hit a usage or rate limit before returning SQL.',
      hint: 'Retry after the Claude Code limit resets; the workflow state and prior clarification can be reused.',
    };
  }

  return {
    kind: 'missing_sql',
    message: 'Claude Code completed but did not return a fenced SQL block.',
    hint: 'Ask Claude to retry generation or provide the missing context requested in the activity output.',
  };
}

function buildTerminalFailureValidationSummary(content, request = {}, issue = detectTerminalRunIssue(content)) {
  const base = extractValidationSummary(content, request);
  const details = [
    issue.message,
    ...(base.activityDetails || []),
  ].filter(Boolean);

  const schemaChecks = details.filter((line) => /schema|dataset|table|column|BigQuery|dry run|dry-run|dryrun/i.test(line)).slice(0, 6);
  const sqlChecks = details.filter((line) => /sql|dry run|dry-run|dryrun|error|failed|limit|quota|missing/i.test(line)).slice(0, 6);

  return normalizeValidationSummary({
    ...base,
    activityDetails: details,
    requirementCoverage: {
      status: base.requirementCoverage?.status || 'warning',
      summary: base.requirementCoverage?.summary || 'Requirement analysis started but the run ended before SQL was returned.',
      checks: base.requirementCoverage?.checks || ['Review the Activity Summary for the last completed workflow step.'],
    },
    stmCompleteness: {
      status: 'warning',
      summary: 'STM artifact was not returned before the run stopped.',
      checks: ['Claude Code must return fenced STM JSON after successful SQL generation.'],
    },
    schemaReconciliation: {
      status: schemaChecks.length ? 'warning' : base.schemaReconciliation?.status || 'warning',
      summary: schemaChecks.length
        ? 'Schema reconciliation or dry-run activity occurred before the run stopped.'
        : base.schemaReconciliation?.summary || 'Schema reconciliation result was not fully returned.',
      checks: schemaChecks.length ? schemaChecks : base.schemaReconciliation?.checks || ['No structured schema reconciliation result was returned.'],
    },
    sqlChecks: {
      status: 'fail',
      summary: issue.message,
      checks: sqlChecks.length ? sqlChecks : [issue.hint],
    },
    jiraTransition: {
      status: request.jiraInput?.project || request.jiraInput?.storyNumber ? 'warning' : 'not_run',
      summary: request.jiraInput?.project || request.jiraInput?.storyNumber
        ? 'Jira comment and transition were not completed because SQL generation did not finish.'
        : 'No Jira story was supplied for transition.',
      checks: request.jiraInput?.project || request.jiraInput?.storyNumber
        ? ['Jira update is attempted only after SQL generation and validation complete.', issue.message]
        : ['Jira transition was not applicable.'],
    },
  }, {
    hasSql: false,
    hasStm: false,
    hasJira: !!(request.jiraInput?.project || request.jiraInput?.storyNumber),
    jiraSignals: extractJiraSignals(content, !!(request.jiraInput?.project || request.jiraInput?.storyNumber)),
    inferences: base.inferences || extractInferenceNotes(content),
    activityDetails: details,
  });
}

function extractInferenceNotes(content) {
  const withoutBlocks = String(content || '')
    .replace(/```sql\s*\n[\s\S]*?```/gi, '')
    .replace(/```stm\s*\n[\s\S]*?```/gi, '')
    .replace(/```validation\s*\n[\s\S]*?```/gi, '')
    .replace(/```clarification\s*\n[\s\S]*?```/gi, '')
    .replace(/```activity\s*\n[\s\S]*?```/gi, '');

  const inferenceLines = withoutBlocks
    .split('\n')
    .map((line) => line.replace(/^[-*|#\s]+/, '').trim())
    .filter(Boolean)
    .filter((line) => /assum|infer|confidence|auto-approved|propos|candidate|rationale|decision/i.test(line))
    .filter((line) => line.length <= 260)
    .slice(0, 8);

  return Array.from(new Set(inferenceLines));
}

function extractActivityDetails(content) {
  const clarificationDetails = [];
  const clarificationMatch = String(content || '').match(/```clarification\s*\n([\s\S]*?)```/i);
  if (clarificationMatch) {
    try {
      const parsed = JSON.parse(clarificationMatch[1].trim());
      if (parsed.details) clarificationDetails.push(...String(parsed.details).split('\n'));
      if (parsed.explanation) clarificationDetails.push(String(parsed.explanation));
    } catch {
      // Keep fallback extraction below.
    }
  }

  const withoutBlocks = String(content || '')
    .replace(/```sql\s*\n[\s\S]*?```/gi, '')
    .replace(/```stm\s*\n[\s\S]*?```/gi, '')
    .replace(/```validation\s*\n[\s\S]*?```/gi, '')
    .replace(/```clarification\s*\n([\s\S]*?)```/gi, '')
    .replace(/```activity\s*\n[\s\S]*?```/gi, '')
    .replace(/\[SQL_READY\]|\[CLARIFY\]/g, '');

  const lines = [...clarificationDetails, ...withoutBlocks.split('\n')]
    .map((line) => line.replace(/^[-*|#\s]+/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^[-:]+$/.test(line))
    .filter((line) => line.length >= 12 && line.length <= 320)
    .filter((line) => /S\d+|finding|found|validated|verified|inferred|assumed|candidate|confidence|coverage|schema|dataset|table|column|jira|dry run|dry-run|dryrun|transition|comment|stm|sql|error|failed|failure|fix|fixed|auto-fix|resolved|retry|rerun/i.test(line))
    .slice(0, 40);

  return Array.from(new Set(lines));
}

function extractJiraSignals(content, hasJira) {
  if (!hasJira) {
    return {
      status: 'not_run',
      summary: 'No Jira story was supplied for comment or transition.',
      checks: ['Jira comment and transition were not applicable.'],
    };
  }

  const lines = String(content || '')
    .replace(/```sql\s*\n[\s\S]*?```/gi, '')
    .replace(/```stm\s*\n[\s\S]*?```/gi, '')
    .replace(/```validation\s*\n[\s\S]*?```/gi, '')
    .split('\n')
    .map((line) => line.replace(/^[-*|]\s*/, '').trim())
    .filter(Boolean);

  const commentLines = lines.filter((line) => /jira/i.test(line) && /comment|posted|comment id/i.test(line));
  const transitionLines = lines.filter((line) => /jira|transition|status|in progress|to do/i.test(line) && /transition|status|in progress/i.test(line));
  const failureLines = lines.filter((line) => /jira/i.test(line) && /fail|unable|unavailable|error|could not/i.test(line));

  const postedComment = commentLines.some((line) => /posted|comment id|added|created/i.test(line));
  const transitioned = transitionLines.some((line) => /in progress|transitioned|moved/i.test(line));
  const hasFailure = failureLines.length > 0;

  if (postedComment && transitioned && !hasFailure) {
    return {
      status: 'pass',
      summary: 'Jira comment was posted and the issue transition was reported.',
      checks: [
        commentLines[0] || 'Jira comment posted.',
        transitionLines[0] || 'Jira issue transitioned to In Progress.',
      ],
    };
  }

  if (postedComment || transitioned || hasFailure) {
    return {
      status: hasFailure ? 'warning' : 'pass',
      summary: [
        postedComment ? 'Jira comment result was reported.' : 'Jira comment result was not clearly reported.',
        transitioned ? 'Jira transition result was reported.' : 'Jira transition result was not clearly reported.',
      ].join(' '),
      checks: [
        commentLines[0] || 'Jira comment result missing from Claude final response.',
        transitionLines[0] || 'Jira transition result missing from Claude final response.',
        ...failureLines.slice(0, 2),
      ].filter(Boolean),
    };
  }

  return {
    status: 'warning',
    summary: 'Jira story was supplied, but Claude did not clearly report comment posting or transition.',
    checks: [
      'Expected Jira comment posting result after SQL generation.',
      'Expected Jira transition to In Progress result after SQL generation.',
    ],
  };
}

function normalizeValidationStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ['pass', 'warning', 'fail', 'not_run'].includes(normalized) ? normalized : 'warning';
}

function normalizeValidationSection(section, fallbackSummary, fallbackChecks = [], fallbackStatus = 'warning') {
  const value = section && typeof section === 'object' ? section : {};
  const checks = Array.isArray(value.checks)
    ? value.checks.map((check) => String(check)).filter(Boolean).slice(0, 8)
    : fallbackChecks;

  return {
    status: normalizeValidationStatus(value.status || fallbackStatus),
    summary: String(value.summary || fallbackSummary),
    checks: checks.length > 0 ? checks : [fallbackSummary],
  };
}

function hasUsableSection(section) {
  return !!(
    section &&
    typeof section === 'object' &&
    (section.summary || (Array.isArray(section.checks) && section.checks.length > 0))
  );
}

const ACTIVITY_TYPES = new Set(['observation', 'inference', 'decision', 'validation', 'error', 'artifact']);
const ACTIVITY_STATUSES = new Set(['running', 'completed', 'warning', 'failed', 'blocked', 'pending']);
const ACTIVITY_SOURCES = new Set(['claude', 'bridge', 'jira', 'bigquery', 'github', 'offline', 'fallback']);

function inferActivityType(text) {
  const value = String(text || '').toLowerCase();
  if (/error|failed|failure|limit|blocked|missing|not found|denied|unable/.test(value)) return 'error';
  if (/infer|assum|confidence|candidate|proposed|likely/.test(value)) return 'inference';
  if (/decision|selected|chosen|approved|load pattern|object type|partition|cluster/.test(value)) return 'decision';
  if (/validat|dry run|dry-run|dryrun|audit|check|coverage/.test(value)) return 'validation';
  if (/stm|sql|artifact|download|file/.test(value)) return 'artifact';
  return 'observation';
}

function normalizeActivityStatus(status) {
  const value = String(status || '').toLowerCase();
  if (ACTIVITY_STATUSES.has(value)) return value;
  if (value === 'active') return 'running';
  if (value === 'pass') return 'completed';
  if (value === 'fail') return 'failed';
  if (value === 'not_run') return 'pending';
  return 'completed';
}

function normalizeActivitySource(source) {
  const value = String(source || '').toLowerCase();
  return ACTIVITY_SOURCES.has(value) ? value : 'fallback';
}

function normalizeActivityType(type, text) {
  const value = String(type || '').toLowerCase();
  if (value === 'tool') return inferActivityType(text); // never expose tool-typed events
  return ACTIVITY_TYPES.has(value) ? value : inferActivityType(text);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8);
  return list.length > 0 ? list : undefined;
}

function makeActivityEvent(event = {}) {
  const summary = String(event.summary || event.title || 'Claude Code activity').trim();
  const title = String(event.title || summary).trim();
  const stage = event.stage || inferActivityStage(`${title} ${summary}`);
  return {
    id: event.id,
    stage,
    type: normalizeActivityType(event.type, `${title} ${summary}`),
    status: normalizeActivityStatus(event.status),
    title,
    summary,
    details: normalizeStringList(event.details),
    confidence: typeof event.confidence === 'number' ? event.confidence : undefined,
    evidence: normalizeStringList(event.evidence),
    timestamp: typeof event.timestamp === 'number' && event.timestamp > 0 ? event.timestamp : Date.now(),
    source: normalizeActivitySource(event.source),
  };
}

function validationStatusToActivityStatus(status) {
  const value = normalizeValidationStatus(status);
  if (value === 'pass') return 'completed';
  if (value === 'fail') return 'failed';
  if (value === 'not_run') return 'pending';
  return 'warning';
}

function activityEventsFromValidationSummary(summary = {}) {
  // We deliberately DO NOT re-emit summary.activityLog, summary.activityDetails,
  // or summary.inferences as activity cards here. Findings, inferences, and
  // decisions are streamed live during the run via inline ```activity blocks
  // and the semantic tool-pair translator. Re-emitting them at the end creates
  // a wall of duplicated cards that the architect perceives as "all at once".
  // Only the five structured validation sections are surfaced at completion —
  // they are summaries, not duplicate findings.
  const events = [];
  const sections = [
    ['requirementCoverage', 'Requirement Coverage', 'analysis'],
    ['stmCompleteness', 'STM Completeness', 'sql_generation'],
    ['schemaReconciliation', 'Schema Reconciliation', 'schema_resolution'],
    ['sqlChecks', 'SQL Checks', 'validation'],
    ['jiraTransition', 'Jira Transition', 'validation'],
  ];
  for (const [key, title, stage] of sections) {
    const section = summary[key];
    if (!section || typeof section !== 'object') continue;
    events.push(makeActivityEvent({
      stage,
      type: 'validation',
      status: validationStatusToActivityStatus(section.status),
      title,
      summary: section.summary || title,
      evidence: Array.isArray(section.checks) ? section.checks : undefined,
      source: 'claude',
    }));
  }

  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.stage}|${event.type}|${event.title}|${event.summary}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeValidationSummary(summary, context = {}) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const sourceActivityLog = Array.isArray(source.activityLog)
    ? source.activityLog
    : Array.isArray(source.activity_log)
      ? source.activity_log
      : [];
  const sourceInferences = Array.isArray(source.inferences)
    ? source.inferences.map((item) => String(item)).filter(Boolean)
    : [];
  const inferences = [...sourceInferences, ...(context.inferences || [])].slice(0, 20);
  const sourceActivityDetails = Array.isArray(source.activityDetails)
    ? source.activityDetails.map((item) => String(item)).filter(Boolean)
    : [];
  const activityDetails = Array.from(new Set([...sourceActivityDetails, ...(context.activityDetails || [])])).slice(0, 40);
  const jiraSignals = context.jiraSignals || {
    status: context.hasJira ? 'warning' : 'not_run',
    summary: context.hasJira ? 'Jira result was not returned.' : 'No Jira story was supplied.',
    checks: [context.hasJira ? 'Jira comment and transition result missing.' : 'Jira comment and transition were not applicable.'],
  };

  if (Array.isArray(source.details) || source.summary || source.jiraStatus) {
    const details = Array.isArray(source.details)
      ? source.details.map((detail) => String(detail)).filter(Boolean)
      : [String(source.summary || 'Validation completed by Claude Code.')];

    return {
      activityLog: sourceActivityLog.map((event) => makeActivityEvent({ ...event, source: event.source || 'claude' })),
      activityDetails,
      requirementCoverage: normalizeValidationSection(
        { status: 'pass', summary: source.summary, checks: [...details.slice(0, 4), ...inferences.slice(0, 2)] },
        'Requirements were validated against the generated SQL.',
      ),
      stmCompleteness: normalizeValidationSection(
        { status: context.hasStm ? 'pass' : 'warning', summary: context.hasStm ? 'STM artifact was emitted successfully.' : 'Legacy validation output did not include structured STM checks.', checks: details.slice(0, 2) },
        'STM completeness was not returned in structured form.',
      ),
      schemaReconciliation: normalizeValidationSection(
        { status: 'warning', summary: 'Legacy validation output did not include structured schema reconciliation checks.', checks: details.slice(0, 2) },
        'Schema reconciliation was not returned in structured form.',
      ),
      sqlChecks: normalizeValidationSection(
        { status: context.hasSql ? 'pass' : 'warning', summary: context.hasSql ? 'Generated SQL was emitted successfully.' : 'Generated SQL was not detected.', checks: details.slice(0, 3) },
        'Generated SQL was emitted successfully.',
      ),
      jiraTransition: normalizeValidationSection(
        {
          status: source.jiraStatus ? 'pass' : jiraSignals.status,
          summary: source.jiraStatus || jiraSignals.summary,
          checks: source.jiraStatus ? [source.jiraStatus] : jiraSignals.checks,
        },
        jiraSignals.summary,
      ),
      inferences,
      generatedAt: source.generatedAt || new Date().toISOString(),
    };
  }

  return {
    activityLog: sourceActivityLog.map((event) => makeActivityEvent({ ...event, source: event.source || 'claude' })),
    activityDetails,
    requirementCoverage: normalizeValidationSection(
      source.requirementCoverage,
      context.hasSql
        ? 'Generated SQL was reviewed against the supplied requirement context.'
        : 'Requirement coverage validation was not returned.',
      [context.hasSql
        ? 'SQL was generated; Claude Code should have validated coverage against Jira/file/text requirements.'
        : 'Claude Code should compare generated SQL with Jira/file/text requirements.',
        ...inferences.slice(0, 2)],
    ),
    stmCompleteness: normalizeValidationSection(
      source.stmCompleteness,
      context.hasStm ? 'STM artifact was emitted successfully.' : 'STM completeness validation was not returned.',
      [context.hasStm ? 'Fenced STM JSON block was detected.' : 'Claude Code should verify source, target, transformation, and business rule coverage.'],
      context.hasStm ? 'pass' : 'warning',
    ),
    schemaReconciliation: normalizeValidationSection(
      source.schemaReconciliation,
      context.hasSql && !hasUsableSection(source.schemaReconciliation)
        ? 'Schema reconciliation was not returned in structured form.'
        : 'Schema reconciliation validation was not returned.',
      [context.hasSql
        ? 'If schema was explicit, no broad dataset crawl was required; if ambiguous, Claude Code should have reconciled only tables and columns inside the mandatory target dataset.'
        : 'Claude Code should reconcile only tables and columns inside the mandatory target dataset when schema is unclear.'],
    ),
    sqlChecks: normalizeValidationSection(
      source.sqlChecks,
      context.hasSql ? 'Generated SQL was emitted successfully.' : 'SQL checks were not returned.',
      [context.hasSql ? 'Fenced SQL block was detected and emitted to the UI.' : 'Claude Code should verify BigQuery SQL structure, aliases, casting, joins, filters, and obvious syntax issues.'],
      context.hasSql ? 'pass' : 'warning',
    ),
    jiraTransition: normalizeValidationSection(
      source.jiraTransition,
      jiraSignals.summary,
      jiraSignals.checks,
      jiraSignals.status,
    ),
    inferences,
    generatedAt: source.generatedAt || new Date().toISOString(),
  };
}

// ── Clarification Detection ───────────────────────────────────
// Relies solely on the [CLARIFY] sentinel that the prompt instructs
// Claude to include — avoids brittle phrase-list matching.

function isClarificationRequest(content) {
  return typeof content === 'string' && content.includes('[CLARIFY]');
}

function extractClarification(content) {
  const rawContent = String(content || '');
  const detailText = rawContent
    .replace(/\[CLARIFY\]/g, '')
    .replace(/```clarification\s*\n[\s\S]*?```/gi, '')
    .trim();
  const fallback = {
    message: detailText,
    details: detailText,
    needsInput: true,
  };
  const match = rawContent.match(/```clarification\s*\n([\s\S]*?)```/i);
  if (!match) return fallback;

  try {
    const parsed = JSON.parse(match[1].trim());
    const options = Array.isArray(parsed.options)
      ? parsed.options.map((option) => String(option)).filter(Boolean).slice(0, 5)
      : undefined;

    return {
      explanation: parsed.explanation ? String(parsed.explanation) : undefined,
      message: String(parsed.question || parsed.message || fallback.message),
      details: parsed.details ? String(parsed.details) : detailText || undefined,
      options,
      allowFreeText: parsed.allowFreeText !== false,
      needsInput: true,
    };
  } catch {
    return fallback;
  }
}

// ── Pipeline Stage Mapping ────────────────────────────────────

function runOfflineDryRun(request, onEvent) {
  const text = [
    request.contextText || '',
    ...(request.messages || []).map((message) => message.content || ''),
  ].join('\n');
  const lowerText = text.toLowerCase();

  onEvent({ type: 'status', stage: 'analysis', status: 'completed', message: 'Dry run requirement analysis completed.' });

  const hasExplicitSchema =
    /project\s*[:.=]/i.test(text) ||
    /dataset\s*[:.=]/i.test(text) ||
    /table\s*[:.=]/i.test(text) ||
    /\bfrom\s+`?[\w-]+\.[\w-]+\.[\w-]+`?/i.test(text);

  const needsClarification =
    lowerText.includes('ambiguous') ||
    lowerText.includes('unclear') ||
    (!hasExplicitSchema && lowerText.includes('scrum-16'));

  if (needsClarification) {
    const clarificationDetails = [
      'Dry run investigation found ambiguous schema context.',
      '',
      'The supplied intake does not provide clear table or column paths inside the mandatory target dataset. SQL Curator needs scoped schema confirmation before generation.',
    ].join('\n');
    onEvent({
      type: 'status',
      stage: 'schema_resolution',
      status: 'blocked',
      message: 'Dry run found ambiguous schema context.',
    });
    onEvent({
      type: 'validation_summary',
      summary: normalizeValidationSummary({
        activityDetails: [
          'Dry run inspected the supplied intake and found ambiguous schema context.',
          'Schema resolution is blocked because table or column paths are not explicit inside the mandatory target dataset.',
          'SQL generation was not started; user clarification is required.',
        ],
        inferences: [
          'No safe schema inference was made because confidence is below the required threshold.',
        ],
        requirementCoverage: {
          status: 'warning',
          summary: 'Requirement intent was detected, but target-dataset table or column details are insufficient for SQL generation.',
          checks: ['Detected missing or ambiguous table/column context within the mandatory target dataset.'],
        },
        stmCompleteness: {
          status: 'warning',
          summary: 'STM cannot be completed until source and target schema are confirmed.',
          checks: ['Blocked before STM finalization.'],
        },
        schemaReconciliation: {
          status: 'warning',
          summary: 'Schema reconciliation requires user confirmation.',
          checks: ['Prepared clarification options for the unresolved schema stage.'],
        },
        sqlChecks: {
          status: 'not_run',
          summary: 'SQL checks did not run because SQL was not generated.',
          checks: ['Generation is intentionally blocked pending clarification.'],
        },
        jiraTransition: {
          status: request.jiraInput?.project ? 'not_run' : 'not_run',
          summary: request.jiraInput?.project
            ? 'Jira transition is not attempted during clarification.'
            : 'No Jira story was supplied for transition.',
          checks: ['Jira updates occur only after successful SQL generation.'],
        },
      }, {
        hasSql: false,
        hasStm: false,
        hasJira: !!request.jiraInput?.project,
      }),
    });
    onEvent({
      type: 'clarification',
      explanation: 'The intake does not provide clear target-dataset table or column paths for schema reconciliation.',
      message: 'Which schema context inside the target dataset should Claude use for this request?',
      details: clarificationDetails,
      options: [
        'Use tables named in the uploaded mapping',
        'Inspect matching tables only inside the target dataset',
        'I will provide table and column names for this dataset',
      ],
      allowFreeText: true,
      needsInput: true,
    });
    onEvent({ type: 'done', success: false, clarification: true });
    return { success: false, clarification: true, assistantText: '[DRY_RUN_CLARIFICATION]' };
  }

  const projectId = String(request.bqProjectId || 'target_project');
  const datasetId = String(request.bqDatasetId || 'target_dataset');
  const sql = `-- SQL Curator offline dry run SQL
-- Target project: ${projectId}
-- Target dataset: ${datasetId}
-- Validation: Generated without Claude or external services.
WITH src_orders AS (
  SELECT
    order_id,
    customer_id,
    order_date,
    SAFE_CAST(order_total AS NUMERIC) AS order_total
  FROM \`${projectId}.${datasetId}.orders\`
),

final AS (
  SELECT
    customer_id,
    DATE(order_date) AS order_date,
    COUNT(DISTINCT order_id) AS order_count,
    SUM(COALESCE(order_total, 0)) AS total_order_amount
  FROM src_orders
  GROUP BY customer_id, order_date
)

SELECT * FROM final;`;

  onEvent({ type: 'status', stage: 'schema_resolution', status: 'completed', message: 'Dry run schema context resolved.' });
  onEvent({ type: 'sql', sql, fileName: `sql_curator_offline_dry_run_${Date.now()}.sql` });
  onEvent({ type: 'status', stage: 'sql_generation', status: 'completed', message: 'Dry run SQL generated.' });
  onEvent({
    type: 'validation_summary',
    summary: normalizeValidationSummary({
      inferences: [
        `Inferred target project from mandatory BQ Project ID: ${projectId}.`,
        `Used deterministic offline dry-run schema within mandatory dataset: ${datasetId}.`,
      ],
      requirementCoverage: {
        status: 'pass',
        summary: 'Offline dry run validated that supplied test context reaches SQL generation.',
        checks: [
          'Accepted Jira/text/file-shaped context without external APIs.',
          'Generated deterministic SQL from the dry-run intake.',
        ],
      },
      stmCompleteness: {
        status: 'pass',
        summary: 'Offline dry run emitted a downloadable STM artifact.',
        checks: [
          'STM row contains source, target, transformation, and business rule fields.',
          'STM CSV and JSON download payloads are available to the UI.',
        ],
      },
      schemaReconciliation: {
        status: 'pass',
        summary: 'Offline dry run used explicit deterministic schema context.',
        checks: [
          'No dataset crawl was performed.',
          `Target project was set to ${projectId}.`,
          `Target dataset was set to ${datasetId}.`,
        ],
      },
      sqlChecks: {
        status: 'pass',
        summary: 'Offline dry run emitted BigQuery SQL and validation stage events.',
        checks: [
          'SQL uses project-and-dataset-qualified BigQuery table references.',
          'SQL uses SAFE_CAST and COALESCE for production-oriented handling.',
          'Pipeline milestones were emitted through Ready.',
        ],
      },
      jiraTransition: {
        status: request.jiraInput?.project ? 'warning' : 'not_run',
        summary: request.jiraInput?.project
          ? 'Offline dry run does not mutate Jira status.'
          : 'No Jira story was supplied for transition.',
        checks: [
          request.jiraInput?.project
            ? 'Jira transition requires live Claude Code MCP execution.'
            : 'Jira transition was not applicable in this run.',
        ],
      },
      generatedAt: new Date().toISOString(),
    }),
  });
  onEvent({
    type: 'stm',
    artifact: {
      rows: [
        {
          sourceField: 'order_id',
          sourceTable: `${projectId}.${datasetId}.orders`,
          sourceType: 'STRING',
          targetColumn: 'order_count',
          targetTable: `${projectId}.${datasetId}.customer_daily_orders`,
          targetType: 'INT64',
          transformation: 'COUNT(DISTINCT order_id)',
          businessRule: 'Count unique orders by customer and date',
          notes: 'Offline dry run only',
        },
      ],
      title: 'Offline Dry Run STM',
      description: 'Deterministic artifact used to validate SQL Curator UI wiring.',
      source: request.jiraInput?.project ? 'jira' : 'text',
      jiraRef: request.jiraInput?.project && request.jiraInput?.storyNumber
        ? `${request.jiraInput.project}-${request.jiraInput.storyNumber}`
        : undefined,
      bqProject: projectId,
      bqDataset: datasetId,
      generatedAt: new Date().toISOString(),
      version: nextStmVersion(request.sessionId),
    },
  });
  onEvent({ type: 'status', stage: 'validation', status: 'completed', message: 'Dry run validation completed without external services.' });
  onEvent({ type: 'status', stage: 'ready', status: 'completed', message: 'Dry run SQL ready.' });
  onEvent({ type: 'done', success: true });

  return { success: true, clarification: false, assistantText: '[DRY_RUN_SQL_READY]' };
}

function mapToolToStage(toolName) {
  const name = (toolName || '').toLowerCase();
  if (name.includes('jira')) return 'analysis';
  if (name.includes('bigquery') || name.includes('bq') || name.includes('dataset') || name.includes('table_schema')) return 'schema_resolution';
  if (name.includes('sql') || name.includes('query') || name.includes('dry_run')) return 'validation';
  return 'intake';
}

function mapToolToActivityMessage(toolName, toolInput = {}) {
  const name = String(toolName || '').toLowerCase();
  const inputText = JSON.stringify(toolInput || {}).toLowerCase();

  if (name.includes('jira')) {
    if (/comment|addcomment|createcomment/.test(name) || /comment/.test(inputText)) {
      return 'Posting Jira completion comment.';
    }
    if (/transition|status/.test(name) || /in progress|transition/.test(inputText)) {
      return 'Updating Jira status to In Progress.';
    }
    if (/issue|story|ticket|get|search/.test(name) || /issue|story|ticket|scrum/.test(inputText)) {
      return 'Fetching Jira story details.';
    }
    return 'Reading Jira context.';
  }

  if (name.includes('bigquery') || name.includes('google_cloud_bigquery') || name.includes('dataset') || name.includes('table')) {
    if (/dry.?run|dryrun|dry_run|query_job|run_query|execute_query/.test(name) || /dry.?run|dryrun|dry_run/.test(inputText)) {
      return 'Running BigQuery validation dry run.';
    }
    if (/schema|table|column/.test(name) || /schema|table|column/.test(inputText)) {
      return 'Verifying scoped BigQuery schema.';
    }
    if (/dataset/.test(name) || /dataset/.test(inputText)) {
      return 'Verifying the mandatory target BigQuery dataset.';
    }
    return 'Reconciling BigQuery metadata.';
  }

  if (name.includes('github')) {
    return 'Preparing GitHub deployment through Claude Code.';
  }

  if (name.includes('sql') || name.includes('query')) {
    return 'Validating generated SQL.';
  }

  return 'Claude Code is working on the request.';
}

function inferActivityStage(message) {
  const text = String(message || '').toLowerCase();
  if (/jira|story|requirement|acceptance|intake|analyz|analysis|s0[1-4]/.test(text)) return 'analysis';
  if (/schema|dataset|table|column|reconcil|candidate|bigquery|bq|s0[5-6]/.test(text)) return 'schema_resolution';
  if (/stm|mapping|source-to-target|logic model|generate|sql writer|s0[7-9]|s10/.test(text)) return 'sql_generation';
  if (/validat|dry run|dry-run|dryrun|self-audit|jira comment|transition|s1[1-2]/.test(text)) return 'validation';
  if (/ready|complete|sql_ready/.test(text)) return 'ready';
  return 'analysis';
}

// ── Semantic tool → architect-readable finding ───────────────
// Each MCP tool call is paired with its tool_result (by tool_use_id) so we
// can synthesize one finding card with the actual learned content, in
// architect language — never plumbing terms like "Called", "Invoked", "MCP".

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function pickStrings(arr, fields, limit = 8) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (item && typeof item === 'object') {
      for (const f of fields) {
        if (typeof item[f] === 'string' && item[f].trim()) { out.push(item[f]); break; }
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

function clipForActivity(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function semanticFindingFromToolPair(toolName, toolInput, toolResultText, isError) {
  const name = String(toolName || '').toLowerCase();
  const parsed = safeJsonParse(toolResultText);

  // ── Jira read ─────────────────────────────────────────────
  if (name.includes('getjiraissue')) {
    const key = parsed?.key || toolInput?.issueIdOrKey || 'Jira story';
    const summary = parsed?.fields?.summary;
    const status = parsed?.fields?.status?.name;
    const desc = typeof parsed?.fields?.description === 'string' ? clipForActivity(parsed.fields.description, 180) : null;
    const acHint = desc && /acceptance/i.test(desc) ? 'Acceptance criteria captured in story description.' : null;
    return {
      stage: 'analysis',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? `Could not fetch ${key}` : `Fetched ${key}: ${summary || 'story details'}`,
      summary: isError ? clipForActivity(toolResultText) : `Story status: ${status || 'unknown'}. ${desc || ''}`.trim(),
      evidence: acHint ? [acHint] : undefined,
      source: 'jira',
    };
  }
  if (name.includes('searchjiraissuesusingjql')) {
    const total = parsed?.total || (Array.isArray(parsed?.issues) ? parsed.issues.length : null);
    return {
      stage: 'analysis',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? 'Jira search failed' : 'Searched Jira',
      summary: isError ? clipForActivity(toolResultText) : `Returned ${total ?? 'N/A'} candidate issue(s).`,
      source: 'jira',
    };
  }

  // ── Jira write — these are the ones we want to flag for ordering
  if (name.includes('addcomment') && name.includes('jira')) {
    const issueKey = toolInput?.issueIdOrKey || 'Jira story';
    return {
      stage: 'validation',
      type: 'artifact',
      status: isError ? 'failed' : 'completed',
      title: isError ? `Jira comment failed on ${issueKey}` : `Posted Jira comment on ${issueKey}`,
      summary: isError ? clipForActivity(toolResultText) : `Run summary published as a comment on ${issueKey}.`,
      source: 'jira',
    };
  }
  if (name.includes('transitionjiraissue')) {
    const issueKey = toolInput?.issueIdOrKey || 'Jira story';
    return {
      stage: 'validation',
      type: 'decision',
      status: isError ? 'failed' : 'completed',
      title: isError ? `Jira transition failed on ${issueKey}` : `Transitioned ${issueKey}`,
      summary: isError ? clipForActivity(toolResultText) : `Issue moved to In Progress.`,
      source: 'jira',
    };
  }
  if (name.includes('jira')) {
    return {
      stage: 'analysis',
      type: isError ? 'error' : 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? 'Jira call returned an issue' : 'Jira lookup completed',
      summary: clipForActivity(toolResultText),
      source: 'jira',
    };
  }

  // ── BigQuery ──────────────────────────────────────────────
  if (name.includes('list_dataset_ids')) {
    const datasets = pickStrings(parsed?.datasets, ['datasetId', 'id']);
    return {
      stage: 'schema_resolution',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? 'Could not list datasets' : `Listed datasets in project`,
      summary: isError ? clipForActivity(toolResultText) : `Found ${datasets.length} dataset(s): ${datasets.join(', ') || '—'}`,
      evidence: datasets.length ? datasets : undefined,
      source: 'bigquery',
    };
  }
  if (name.includes('list_table_ids')) {
    const tables = pickStrings(parsed?.tables, ['tableId', 'id']);
    const ds = toolInput?.datasetId;
    return {
      stage: 'schema_resolution',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? `Could not list tables in ${ds}` : `Discovered tables in ${ds || 'dataset'}`,
      summary: isError ? clipForActivity(toolResultText) : `${tables.length} table(s) in scope: ${tables.join(', ') || '—'}`,
      evidence: tables.length ? tables : undefined,
      source: 'bigquery',
    };
  }
  if (name.includes('get_dataset_info')) {
    const ds = parsed?.datasetReference?.datasetId || toolInput?.datasetId;
    const desc = parsed?.description;
    const loc = parsed?.location;
    return {
      stage: 'schema_resolution',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? `Could not inspect dataset ${ds}` : `Verified dataset ${ds}`,
      summary: isError ? clipForActivity(toolResultText) : `Exists in ${loc || 'unknown region'}. ${desc || ''}`.trim(),
      source: 'bigquery',
    };
  }
  if (name.includes('get_table_info')) {
    const table = parsed?.tableReference?.tableId || toolInput?.tableId;
    const fields = pickStrings(parsed?.schema?.fields, ['name']);
    return {
      stage: 'schema_resolution',
      type: 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? `Could not inspect table ${table}` : `Examined schema of ${table}`,
      summary: isError ? clipForActivity(toolResultText) : `${fields.length} column(s): ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '…' : ''}`,
      evidence: fields.length ? fields : undefined,
      source: 'bigquery',
    };
  }
  if (name.includes('execute_sql')) {
    if (isError) {
      return {
        stage: 'validation',
        type: 'error',
        status: 'warning',
        title: 'BigQuery dry run / read returned an error',
        summary: clipForActivity(toolResultText),
        source: 'bigquery',
      };
    }
    const rows = Array.isArray(parsed?.rows) ? parsed.rows.length : null;
    const bytes = parsed?.totalBytesProcessed || parsed?.total_bytes_processed;
    return {
      stage: 'validation',
      type: 'validation',
      status: 'completed',
      title: 'BigQuery query completed',
      summary: `Rows: ${rows ?? 'N/A'}. Bytes processed: ${bytes ?? 'N/A'}.`,
      source: 'bigquery',
    };
  }
  if (name.includes('bigquery') || name.includes('bq')) {
    return {
      stage: 'schema_resolution',
      type: isError ? 'error' : 'observation',
      status: isError ? 'warning' : 'completed',
      title: isError ? 'BigQuery call returned an issue' : 'BigQuery metadata inspected',
      summary: clipForActivity(toolResultText),
      source: 'bigquery',
    };
  }

  // ── GitHub ────────────────────────────────────────────────
  if (name.includes('github')) {
    return {
      stage: 'ready',
      type: isError ? 'error' : 'artifact',
      status: isError ? 'warning' : 'completed',
      title: isError ? 'GitHub action returned an issue' : 'GitHub action completed',
      summary: clipForActivity(toolResultText),
      source: 'github',
    };
  }

  // Default — return nothing so generic tools stay silent.
  return null;
}

// ── Inline streaming activity parser ──────────────────────────
// Claude emits one ```activity ... ``` JSON block after each significant
// step. We scan accumulated stream text from a sliding offset and emit each
// completed block as an SSE activity_event the moment its closing fence
// arrives — that is what drives the live Activity Feed.
const INLINE_ACTIVITY_RE = /```activity\s*\n([\s\S]*?)\n```/g;

function processInlineActivities(text, fromOffset, onEvent, seen) {
  let advanceTo = fromOffset;
  INLINE_ACTIVITY_RE.lastIndex = fromOffset;
  let match;
  while ((match = INLINE_ACTIVITY_RE.exec(text)) !== null) {
    const raw = match[1].trim();
    advanceTo = INLINE_ACTIVITY_RE.lastIndex;
    if (seen.has(raw)) continue;
    seen.add(raw);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`  [activity] Failed to parse inline block: ${err.message}`);
      continue;
    }
    onEvent({
      type: 'activity_event',
      event: makeActivityEvent({
        ...parsed,
        source: parsed.source || 'claude',
      }),
    });
  }
  return advanceTo;
}

function stripInlineActivities(text) {
  return String(text || '').replace(/\n?```activity\s*\n[\s\S]*?\n```\n?/g, '\n').trim();
}

// ── Sanitised env for Claude child ─────────────────────────────
// The Claude CLI inherits whatever it needs from a deliberate whitelist
// rather than the full parent process.env. This avoids leaking secrets that
// happen to live in the bridge operator's shell (cloud keys, DB creds,
// tokens for unrelated services) into a process that builds prompts and
// invokes MCP servers.

const CLAUDE_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'COMSPEC',
  'PATHEXT',
]);

function buildClaudeEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    // Allowlist match.
    if (CLAUDE_ENV_ALLOWLIST.has(upper)) {
      out[k] = v;
      continue;
    }
    // Claude/Anthropic-owned variables — needed for auth + MCP config.
    if (upper.startsWith('CLAUDE_') || upper.startsWith('ANTHROPIC_')) {
      out[k] = v;
      continue;
    }
    // Node-required runtime bits (NODE_PATH etc.) — keep narrow.
    if (upper === 'NODE_PATH' || upper === 'NODE_OPTIONS' || upper === 'NVM_DIR' || upper === 'NVM_BIN') {
      out[k] = v;
    }
  }
  if (!out.HOME) out.HOME = os.homedir();
  return out;
}

// ── Cross-platform child-process kill ──────────────────────────
// Node on Windows does not actually deliver POSIX signals; `kill('SIGTERM')`
// instantly terminates and the SIGKILL escalation is meaningless. On POSIX
// the staged SIGTERM → SIGKILL is the right behaviour. Pick per platform
// and track the escalation timer so it can be cleared on early exit.

function killChildProcess(proc) {
  if (!proc || proc.killed) return null;
  if (process.platform === 'win32') {
    try {
      // taskkill /T kills the entire process tree (claude can spawn MCPs).
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { timeout: 5000 });
    } catch {
      try { proc.kill(); } catch { /* already dead */ }
    }
    return null;
  }
  try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  const escalation = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }, 3000);
  // Cancel the escalation timer if the child actually exits in time.
  proc.once('exit', () => clearTimeout(escalation));
  return escalation;
}

// ── Claude CLI Spawner ────────────────────────────────────────

async function runClaude(prompt, sessionId, request, onEvent, ctx = {}, retryCount = 0) {
  const log = ctx.log || rootLogger.child({ sessionId, component: 'claude-session' });
  const requestId = ctx.requestId || null;
  // AbortSignal from the HTTP handler. Fires when the client disconnects so
  // we can kill the spawned Claude tree promptly instead of letting it run
  // to the wall-clock timeout while no one is listening.
  const abortSignal = ctx.abortSignal || null;
  const claudeBin = findClaude();
  if (!claudeBin) {
    throw new Error(
      'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code\n' +
      'Ensure MCP servers are configured in ~/.claude.json'
    );
  }

  if (activeRequests >= MAX_CONCURRENT) {
    throw new Error(`Server busy. ${MAX_CONCURRENT} concurrent requests max. Please retry in a moment.`);
  }

  activeRequests++;
  log.info('Spawning Claude session', { activeRequests, maxConcurrent: MAX_CONCURRENT });
  metrics.incr('claude_sessions_spawned', { kind: retryCount > 0 ? 'retry' : 'primary' });
  metrics.setGauge('claude_sessions_active', {}, activeRequests);

  let proc = null;
  let timeoutId = null;
  // accumulatedDeltas: built up from content_block_delta events (streaming)
  // fullMessageText: set from 'assistant' full-message events (authoritative)
  let accumulatedDeltas = '';
  let fullMessageText = '';
  let hasStartedMessage = false;
  let toolCalls = new Set();
  let hasCleanedUp = false;
  // Streaming activity-block parser state
  let activityScanOffsetDeltas = 0;
  let activityScanOffsetFull = 0;
  const seenActivityBlocks = new Set();
  // Pending tool_use entries keyed by tool_use_id, awaiting their tool_result.
  // Each entry: { name, input, stageAtCall }
  const pendingToolCalls = new Map();
  // Jira-ordering tracking: has a successful BigQuery dry-run completed yet?
  const orderingState = { dryRunPassed: false, jiraCommentBeforeDryRun: false };
  // Bridge-owned gate verdict source: every BigQuery dry-run/execute MCP call
  // that completes is captured here from the raw tool_result. The verdict is
  // derived from the LAST attempt's is_error flag — Claude's prose verdict
  // (validation.sqlChecks.status) is discarded. This is the only path that
  // guarantees the gate decision is free of LLM interpretation bias while
  // remaining inside the MCP-only constraint.
  const dryRunAttempts = [];

  // Forward-declared so cleanup() can detach the listener; assigned later.
  let abortHandlerRef = null;
  const cleanup = () => {
    if (hasCleanedUp) return;
    hasCleanedUp = true;
    clearTimeout(timeoutId);
    activeRequests--;
    metrics.setGauge('claude_sessions_active', {}, activeRequests);
    if (proc) {
      spawnedProcs.delete(proc);
      killChildProcess(proc);
    }
    if (abortSignal && abortHandlerRef) {
      try { abortSignal.removeEventListener('abort', abortHandlerRef); } catch { /* ignore */ }
      abortHandlerRef = null;
    }
  };

  // Get session for conversation resumption
  const session = getSession(sessionId);

  return new Promise((resolve, reject) => {
    // If the HTTP client disconnects, kill the Claude tree immediately and
    // reject so the outer handler can stop emitting SSE writes.
    if (abortSignal) {
      if (abortSignal.aborted) {
        cleanup();
        metrics.incr('claude_sessions_aborted', { reason: 'pre_aborted' });
        return reject(new Error('Request aborted by client before Claude session started'));
      }
      abortHandlerRef = () => {
        if (hasCleanedUp) return;
        log.warn('Client disconnected — killing Claude tree');
        metrics.incr('claude_sessions_aborted', { reason: 'client_disconnect' });
        cleanup();
        reject(new Error('Request aborted by client'));
      };
      abortSignal.addEventListener('abort', abortHandlerRef, { once: true });
    }

    const args = [
      '-p',
      '-',
      '--output-format', 'stream-json',
      '--max-turns', String(CLAUDE_MAX_TURNS),
      '--verbose',
      '--dangerously-skip-permissions', // headless mode: auto-approve all MCP tool calls
    ];

    // Two-pass Jira ordering: block Jira write tools during the main run so
    // Claude cannot post the comment or transition the issue before the
    // strict validation gate clears. We perform a follow-up Claude pass with
    // these tools allowed once the gate passes.
    const isJiraBacked = !!(request.jiraInput?.project && request.jiraInput?.storyNumber);
    if (JIRA_COMPLETION_ENABLED && isJiraBacked && JIRA_WRITE_TOOLS.length > 0) {
      args.push('--disallowedTools', JIRA_WRITE_TOOLS.join(','));
    }

    // Resume conversation if we have a conversation ID
    if (session.conversationId) {
      args.push('--resume', session.conversationId);
    }

    proc = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildClaudeEnv(),
    });
    spawnedProcs.add(proc);

    // Timeout handler
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`));
    }, CLAUDE_TIMEOUT_MS);

    let buffer = '';
    let bufferAborted = false;
    const claudeStartMs = Date.now();

    // Bounded-buffer guard: a pathological Claude response (e.g. an MCP tool
    // that returns megabytes of payload) could exhaust memory if any of the
    // three accumulators grows without bound. We enforce the cap from config
    // and abort the run if any accumulator exceeds it.
    const enforceBufferLimit = (which, currentBytes) => {
      if (bufferAborted) return true;
      if (currentBytes > MAX_STREAM_BUFFER_BYTES) {
        bufferAborted = true;
        log.error('Stream buffer exceeded limit — aborting session', {
          accumulator: which,
          bytes: currentBytes,
          limit: MAX_STREAM_BUFFER_BYTES,
        });
        metrics.incr('stream_buffer_overflow', { accumulator: which });
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'failed',
            title: 'Stream Buffer Overflow',
            summary: `Claude response exceeded the ${MAX_STREAM_BUFFER_BYTES}-byte buffer limit on ${which}. Session aborted to protect the bridge.`,
            details: ['Raise SQL_CURATOR_MAX_STREAM_BUFFER_BYTES if this is expected for your workload.'],
            source: 'bridge',
          }),
        });
        cleanup();
        reject(new Error(`Stream buffer overflow on ${which} (>${MAX_STREAM_BUFFER_BYTES} bytes)`));
        return true;
      }
      return false;
    };

    proc.stdout.on('data', (chunk) => {
      if (bufferAborted) return;
      buffer += chunk.toString('utf-8');
      if (enforceBufferLimit('line_buffer', Buffer.byteLength(buffer, 'utf8'))) return;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        // Log each stream-json line with a timestamp so we can see whether
        // Claude itself is emitting progressively or batching.
        let snippet = line;
        try {
          const j = JSON.parse(line);
          snippet = `${j.type}${j.message?.role ? `/${j.message.role}` : ''}${j.message?.content ? ` blocks=${(j.message.content || []).map((c) => c.type).join(',')}` : ''}${j.subtype ? ` subtype=${j.subtype}` : ''}`;
        } catch { /* keep raw */ }
        console.log(`  [claude +${String(Date.now() - claudeStartMs).padStart(5, ' ')}ms] ${snippet}`);
        const result = parseClaudeLine(line, onEvent, {
          toolCalls,
          pendingToolCalls,
          orderingState,
          dryRunAttempts,
        });
        if (result?.delta) {
          // Emit message_start once before the first streaming chunk
          if (!hasStartedMessage) {
            hasStartedMessage = true;
            onEvent({ type: 'message_start' });
          }
          onEvent({ type: 'message_delta', content: result.delta });
          accumulatedDeltas += result.delta;
          if (enforceBufferLimit('accumulated_deltas', Buffer.byteLength(accumulatedDeltas, 'utf8'))) return;
          activityScanOffsetDeltas = processInlineActivities(
            accumulatedDeltas,
            activityScanOffsetDeltas,
            onEvent,
            seenActivityBlocks,
          );
        }
        if (result?.fullText) {
          // Accumulate across turns — multi-turn runs emit multiple assistant events
          fullMessageText = fullMessageText
            ? fullMessageText + '\n\n' + result.fullText
            : result.fullText;
          if (enforceBufferLimit('full_message_text', Buffer.byteLength(fullMessageText, 'utf8'))) return;
          activityScanOffsetFull = processInlineActivities(
            fullMessageText,
            activityScanOffsetFull,
            onEvent,
            seenActivityBlocks,
          );
        }
        if (result?.conversationId) {
          session.conversationId = result.conversationId;
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      // Log stderr but don't expose to client
      const text = chunk.toString('utf-8').trim();
      if (text) log.warn('Claude stderr', { text });
    });

    // Write prompt to stdin and close
    proc.stdin.write(prompt, (err) => {
      if (err) {
        cleanup();
        reject(new Error(`Failed to write to Claude stdin: ${err.message}`));
        return;
      }
      proc.stdin.end();
    });

    proc.on('close', async (code) => {
      cleanup();
      log.info('Claude session exited', { exitCode: code });

      // Prefer the authoritative full-message text; fall back to accumulated streaming deltas
      const finalText = fullMessageText || accumulatedDeltas;

      // Determine if this was a clarification request — only honour [CLARIFY] sentinel
      const isClarify = finalText.includes('[CLARIFY]');
      const sqlBlock  = extractSql(finalText);
      const hasSqlBlock = !!sqlBlock;

      // Emit final message (replaces/corrects any streaming bubble on the
      // client). Strip out the inline ```activity blocks: they were already
      // streamed individually as activity_event SSEs and would otherwise
      // appear as a wall of JSON in the assistant message cache.
      if (finalText) {
        onEvent({ type: 'message', content: stripInlineActivities(finalText) });
      }

      const isGithubDeploy = request.taskType === 'github_deploy';

      // ── Layered validation gate ─────────────────────────────
      // The gate is a conjunction of three layers; SQL surfaces only when
      // ALL pass. The bridge derives every verdict deterministically (L1
      // from raw tool_result is_error, L2 from mechanical SQL/STM parsing,
      // L3 from a cold LLM coverage check). Claude's self-reported prose
      // verdicts are discarded and overwritten in the validation summary.
      //
      //   L1 — BigQuery dry-run via MCP (executional correctness)
      //   L2 — SQL ↔ STM structural alignment (no LLM)
      //   L3 — STM ↔ requirements coverage (cold LLM, no SQL, no history)
      let validationSummary = null;
      let sqlChecksStatus = 'not_run';
      let gatePassed = false;
      let gateBlockedBy = null;
      let bridgeVerdict = null;
      if (hasSqlBlock) {
        validationSummary = extractValidationSummary(finalText, request);
        const stmBlock = (finalText.match(/```stm\s*\n([\s\S]*?)```/i) || [])[1] || null;

        if (!isGithubDeploy && !isClarify) {
          // ── L1: BigQuery dry-run via MCP ───────────────────
          const lastAttempt = dryRunAttempts.length > 0 ? dryRunAttempts[dryRunAttempts.length - 1] : null;

          if (!lastAttempt) {
            bridgeVerdict = {
              status: 'not_run',
              summary: 'BigQuery dry-run tool was not invoked during the run. Strict mode requires a dry-run via MCP before SQL surfaces.',
              checks: [
                'Expected at least one execute_sql_readonly (or equivalent dry-run) tool call from the main session.',
                'Claude must invoke the dry-run tool so the bridge can read the authoritative result.',
              ],
            };
          } else if (lastAttempt.isError) {
            const errSnippet = (lastAttempt.resultText || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
            bridgeVerdict = {
              status: 'fail',
              summary: 'BigQuery dry-run returned an error via MCP.',
              checks: [
                `Tool: ${lastAttempt.toolName}`,
                errSnippet || 'No error text returned.',
                `Dry-run attempts in this run: ${dryRunAttempts.length}.`,
              ],
            };
          } else {
            bridgeVerdict = {
              status: 'pass',
              summary: 'BigQuery dry-run completed successfully via MCP.',
              checks: [
                `Tool: ${lastAttempt.toolName}`,
                'Tool result reported no error (is_error=false).',
                `Dry-run attempts in this run: ${dryRunAttempts.length}.`,
              ],
            };
          }
          if (validationSummary) validationSummary.sqlChecks = bridgeVerdict;
          sqlChecksStatus = bridgeVerdict.status;
          metrics.incr('gate_layer_result', { layer: 'L1', status: bridgeVerdict.status });

          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'validation',
              status: bridgeVerdict.status === 'pass' ? 'completed'
                : bridgeVerdict.status === 'fail' ? 'failed' : 'pending',
              title: `BigQuery Dry-Run — ${bridgeVerdict.status}`,
              summary: bridgeVerdict.summary,
              evidence: bridgeVerdict.checks,
              source: 'bigquery',
            }),
          });

          // ── L2: SQL ↔ STM structural alignment (only when L1 passed) ──
          let structuralVerdict = null;
          if (bridgeVerdict.status === 'pass') {
            structuralVerdict = runStructuralChecks(
              sqlBlock,
              stmBlock,
              lastAttempt?.resultText
            );
            if (validationSummary) {
              validationSummary.stmCompleteness = {
                status: structuralVerdict.status,
                summary: structuralVerdict.summary,
                checks: structuralVerdict.checks.map((c) => `${c.name}: ${c.status} — ${c.detail}`),
              };
            }
            metrics.incr('gate_layer_result', { layer: 'L2', status: structuralVerdict.status });
            onEvent({
              type: 'activity_event',
              event: makeActivityEvent({
                stage: 'validation',
                type: 'validation',
                status: structuralVerdict.status === 'pass' ? 'completed'
                  : structuralVerdict.status === 'fail' ? 'failed' : 'warning',
                title: `SQL ↔ STM Structural Check — ${structuralVerdict.status}`,
                summary: structuralVerdict.summary,
                evidence: structuralVerdict.checks.map((c) => `${c.name}: ${c.detail}`),
                source: 'bridge',
              }),
            });
          }

          // ── L3: STM ↔ requirements coverage (only when L1+L2 passed) ──
          let coverageVerdict = null;
          if (bridgeVerdict.status === 'pass' && structuralVerdict?.status === 'pass') {
            coverageVerdict = await runRequirementsCoverageCheck(stmBlock, request, onEvent, { log: log.child({ phase: 'l3-coverage' }) });
            if (coverageVerdict && validationSummary) {
              validationSummary.requirementCoverage = {
                status: coverageVerdict.status,
                summary: coverageVerdict.summary,
                checks: coverageVerdict.checks,
              };
            }
            if (coverageVerdict) {
              metrics.incr('gate_layer_result', { layer: 'L3', status: coverageVerdict.status });
            }
          }

          // Composite gate decision: every layer must be pass for SQL to
          // surface. Any fail/not_run blocks; warnings are allowed through
          // but flagged in the validation summary the UI shows.
          const layerStatuses = [
            { layer: 'L1 dry-run', status: bridgeVerdict.status },
            { layer: 'L2 structural', status: structuralVerdict?.status || (bridgeVerdict.status === 'pass' ? 'not_run' : 'skipped') },
            { layer: 'L3 coverage', status: coverageVerdict?.status || (bridgeVerdict.status === 'pass' && structuralVerdict?.status === 'pass' ? 'not_run' : 'skipped') },
          ];
          const blockingLayer = layerStatuses.find((l) => l.status === 'fail' || l.status === 'not_run');
          if (blockingLayer) {
            sqlChecksStatus = blockingLayer.status;
            gateBlockedBy = `${blockingLayer.layer}: ${blockingLayer.status}`;
          } else {
            sqlChecksStatus = 'pass';
          }
        } else {
          // GitHub deploy or clarification paths bypass all layers.
          sqlChecksStatus = validationSummary?.sqlChecks?.status || 'not_run';
        }

        if (REQUIRE_SQLCHECKS_PASS) {
          gatePassed = sqlChecksStatus === 'pass';
          if (!gatePassed && !gateBlockedBy) gateBlockedBy = sqlChecksStatus;
        } else {
          gatePassed = true;
        }
      }
      const surfacesSql = hasSqlBlock && gatePassed;

      if (surfacesSql) {
        const ticketKey = request.jiraInput?.project && request.jiraInput?.storyNumber
          ? `${request.jiraInput.project}-${request.jiraInput.storyNumber}`
          : 'standalone';
        onEvent({ type: 'status', stage: 'analysis', status: 'completed', message: 'Requirement analysis completed.' });
        onEvent({ type: 'status', stage: 'schema_resolution', status: 'completed', message: 'Schema and mapping context resolved.' });
        onEvent({ type: 'sql', sql: sqlBlock, fileName: `sql_curator_${ticketKey}_${Date.now()}.sql` });
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'sql_generation',
            type: 'artifact',
            status: 'completed',
            title: 'SQL Generated',
            summary: 'Claude Code returned a fenced BigQuery SQL artifact for review.',
            evidence: [`${sqlBlock.split('\n').length} SQL line(s) emitted.`],
            source: 'claude',
          }),
        });
        onEvent({ type: 'status', stage: 'sql_generation', status: 'completed', message: 'BigQuery SQL generated by Claude Code.' });
        onEvent({ type: 'validation_summary', summary: validationSummary });
        onEvent({ type: 'status', stage: 'validation', status: 'completed', message: 'Validated against requirements, mappings, and available schema context.' });
      }

      // ── Gated rejection: SQL existed but dry-run/validation did not pass ──
      if (hasSqlBlock && !gatePassed && !isClarify && !isGithubDeploy) {
        const gateReason = (() => {
          switch (gateBlockedBy) {
            case 'fail':
              return 'BigQuery dry run or SQL validation reported a failure.';
            case 'warning':
              return 'BigQuery dry run or SQL validation reported warnings; strict mode requires `pass`.';
            case 'not_run':
              return 'BigQuery dry run was not attempted. Strict mode requires a successful dry run before SQL is released.';
            default:
              return `SQL checks returned status "${gateBlockedBy}"; strict mode requires "pass".`;
          }
        })();
        const checks = Array.isArray(validationSummary?.sqlChecks?.checks)
          ? validationSummary.sqlChecks.checks.slice(0, 5)
          : [];
        onEvent({
          type: 'status',
          stage: 'validation',
          status: 'failed',
          message: 'SQL withheld: validation did not pass.',
        });
        onEvent({ type: 'validation_summary', summary: validationSummary });
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'failed',
            title: 'SQL Withheld — Validation Did Not Pass',
            summary: gateReason,
            details: [
              'Strict mode is enabled (SQL_CURATOR_REQUIRE_DRYRUN_PASS).',
              'Generated SQL was not released to the UI because validation.sqlChecks.status is not "pass".',
              ...checks,
            ],
            evidence: checks,
            source: 'bridge',
          }),
        });
        onEvent({
          type: 'error',
          message: 'SQL was generated but withheld because validation did not pass.',
          hint: `${gateReason} Resubmit so Claude can diagnose and retry the dry run; see Activity Feed for findings.`,
        });
      }

      if (!hasSqlBlock && !isClarify && !isGithubDeploy) {
        const terminalIssue = detectTerminalRunIssue(finalText);

        // ── Auto-retry: request the SQL block explicitly once ──
        // Only retry for missing_sql (not rate limits), only on the first attempt,
        // and only when we have a resumable conversation ID.
        if (terminalIssue.kind === 'missing_sql' && retryCount === 0 && session.conversationId) {
          log.warn('Auto-retry: no SQL block on first pass, resuming conversation', { conversationId: session.conversationId.slice(0, 12) });
          metrics.incr('auto_retry_attempts', { reason: 'missing_sql' });
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'observation',
              status: 'running',
              title: 'Auto-Retry: Requesting SQL Block',
              summary: 'Claude completed the run without a fenced SQL block. Resuming the same conversation to request the SQL artifact explicitly.',
              source: 'bridge',
            }),
          });

          const retryUserMsg = 'Your previous response did not include a fenced ```sql``` code block. Please re-emit the complete generated SQL now inside a properly fenced ```sql\n...\n``` block, followed by the STM and validation blocks if not already present, then end with [SQL_READY].';
          const retryRequest = {
            ...request,
            messages: [
              ...(request.messages || []),
              { role: 'assistant', content: finalText },
              { role: 'user', content: retryUserMsg },
            ],
          };
          const retryPrompt = buildPrompt(retryRequest);

          try {
            const retryResult = await runClaude(retryPrompt, sessionId, retryRequest, onEvent, ctx, 1);
            resolve(retryResult);
          } catch (retryErr) {
            log.error('Auto-retry failed', { error: retryErr.message });
            // Fall through: surface the original error below via a re-entrant call
            // but we must not resolve twice — just log and let the outer error path run.
            onEvent({
              type: 'activity_event',
              event: makeActivityEvent({
                stage: 'validation',
                type: 'error',
                status: 'failed',
                title: 'Auto-Retry Failed',
                summary: `Retry attempt also failed: ${retryErr.message}`,
                source: 'bridge',
              }),
            });
            // Fall through to normal error surface below.
          }
          return; // prevent double-resolve; retry path owns the resolve/reject from here
        }

        onEvent({
          type: 'status',
          stage: 'validation',
          status: 'failed',
          message: terminalIssue.kind === 'claude_limit'
            ? 'Claude Code usage limit stopped the run before SQL was returned.'
            : 'Claude Code finished without returning generated SQL.',
        });
        onEvent({
          type: 'validation_summary',
          summary: buildTerminalFailureValidationSummary(finalText, request, terminalIssue),
        });
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'failed',
            title: 'Run Stopped Before SQL',
            summary: terminalIssue.message,
            details: terminalIssue.hint ? [terminalIssue.hint] : undefined,
            source: 'bridge',
          }),
        });
        onEvent({
          type: 'error',
          message: terminalIssue.message,
          hint: terminalIssue.hint,
        });
      }

      // Extract and emit STM artifact only when SQL is actually surfaced
      if (surfacesSql) {
        const stm = extractStm(finalText, request, sessionId);
        if (stm && stm.rows.length > 0) {
          onEvent({ type: 'stm', artifact: stm });
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'sql_generation',
              type: 'artifact',
              status: 'completed',
              title: 'STM Artifact Built',
              summary: `Claude Code returned a Source-to-Target Map with ${stm.rows.length} mapping row(s).`,
              source: 'claude',
            }),
          });
          log.info('STM extracted', { rows: stm.rows.length });
        }
      }

      if (isClarify && !surfacesSql) {
        onEvent({ type: 'status', stage: 'analysis', status: 'blocked', message: 'Clarification required before continuing.' });
        onEvent({ type: 'validation_summary', summary: extractValidationSummary(finalText, request) });
        const clarification = extractClarification(finalText);
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'analysis',
            type: 'decision',
            status: 'blocked',
            title: 'Clarification Required',
            summary: clarification.explanation || clarification.message || 'Claude Code needs user clarification before continuing.',
            details: clarification.details ? [clarification.details] : undefined,
            evidence: clarification.options,
            source: 'claude',
          }),
        });
        onEvent({ type: 'clarification', ...clarification });
      }

      // ── Two-pass Jira completion ────────────────────────────
      // Now that the strict gate has cleared, run the Jira comment +
      // transition as a focused follow-up. This guarantees they happen AFTER
      // SQL/STM/validation, not before — regardless of how Claude reasoned
      // during the main pass (which had Jira write tools disallowed).
      const isJiraBackedRun = !!(request.jiraInput?.project && request.jiraInput?.storyNumber);
      if (surfacesSql && isJiraBackedRun && JIRA_COMPLETION_ENABLED) {
        try {
          await runJiraCompletion(sessionId, session, request, validationSummary, onEvent);
        } catch (followUpErr) {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'error',
              status: 'warning',
              title: 'Jira Follow-up Did Not Complete',
              summary: `Bridge-led Jira completion pass failed: ${followUpErr.message}. The SQL is still valid; rerun if the Jira issue needs an update.`,
              source: 'bridge',
            }),
          });
        }
      }

      if (surfacesSql) {
        onEvent({ type: 'status', stage: 'ready', status: 'completed', message: 'SQL ready for review and copy.' });
      }

      onEvent({ type: 'done', success: surfacesSql || (isGithubDeploy && code === 0 && !isClarify) });

      resolve({
        success:       code === 0 || surfacesSql,
        clarification: isClarify && !surfacesSql,
        assistantText: finalText,
      });
    });

    proc.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  }).catch((err) => {
    cleanup();
    throw err;
  });
}

// ── L3: Cold requirements-coverage check ─────────────────────
// Spawns a fresh Claude session given ONLY the raw requirement text and the
// STM JSON. No SQL, no chat history, no MCP tools. Asks the narrow question:
// does the STM cover every acceptance criterion in the requirements?
//
// This is the irreducibly interpretive layer — there is no deterministic way
// to check "does the STM capture intent". The cold session minimises bias by
// having no generation history and no SQL to anchor on.
//
// Returns: { status, summary, checks[] } or null on timeout/parse failure.

const L3_TIMEOUT_MS = CONFIG.timeouts.l3CoverageMs;
const L3_ENABLED = CONFIG.features.l3CoverageCheckEnabled;

function buildRequirementsText(request) {
  const parts = [];
  if (request?.jiraInput?.project && request?.jiraInput?.storyNumber) {
    parts.push(`Jira reference: ${request.jiraInput.project}-${request.jiraInput.storyNumber}`);
  }
  // The main session prompt already echoed the Jira description into chat
  // history; the bridge does not re-fetch Jira here to keep this purely text.
  if (request?.contextText && request.contextText.trim()) {
    parts.push('Free-text requirements:\n' + request.contextText.trim());
  }
  if (Array.isArray(request?.uploadedFiles)) {
    for (const f of request.uploadedFiles) {
      if (f?.content && typeof f.content === 'string') {
        parts.push(`Uploaded file (${f.name || 'unnamed'}):\n${f.content.slice(0, 8000)}`);
      }
    }
  }
  // Include the most recent user message as the canonical ask.
  if (Array.isArray(request?.messages)) {
    const lastUser = [...request.messages].reverse().find((m) => m?.role === 'user');
    if (lastUser?.content) {
      parts.push('User request:\n' + String(lastUser.content).slice(0, 8000));
    }
  }
  return parts.join('\n\n').trim();
}

async function runRequirementsCoverageCheck(stmBlock, request, onEvent, ctx = {}) {
  const log = ctx.log || rootLogger.child({ component: 'l3-coverage' });
  if (!L3_ENABLED) return null;
  if (!stmBlock) return null;

  const requirementsText = buildRequirementsText(request);
  if (!requirementsText) {
    // Nothing to validate against. Honest non-result.
    return {
      status: 'not_run',
      summary: 'No textual requirements were provided (no Jira description, free text, or uploaded files); STM ↔ requirements coverage could not be assessed.',
      checks: ['Provide a Jira story, free text, or uploaded file content to enable this layer.'],
    };
  }

  const claudeBin = findClaude();
  if (!claudeBin) return null;

  const prompt = [
    'You are an independent requirements analyst. You have no knowledge of any SQL or schema.',
    'Your only job: judge whether the STM (Source-to-Target Map) below covers every acceptance criterion in the requirements.',
    '',
    '── REQUIREMENTS ─────────────────────────────────────────',
    requirementsText,
    '',
    '── STM JSON ─────────────────────────────────────────────',
    '```json',
    stmBlock,
    '```',
    '',
    '── YOUR TASK ───────────────────────────────────────────',
    '1. Identify each distinct acceptance criterion or business rule in the requirements (filters, joins, grain, aggregations, ranking, date logic, output columns).',
    '2. For each criterion, decide whether the STM has at least one row that addresses it (via transformation, businessRule, target column, or source field).',
    '3. Be strict but fair — do not invent criteria the user did not state, and do not flag STM rows just because they look unrelated to one criterion (they may serve another).',
    '4. Return ONLY a fenced ```coverage``` JSON block. No other prose.',
    '',
    'Required JSON shape:',
    '```',
    '{"status":"pass"|"warning"|"fail","summary":"one sentence","criteria":[{"text":"...","covered":true|false|"partial","evidenceStmRow":"sourceField→targetColumn or N/A"}]}',
    '```',
    '',
    'Status rules — apply strictly:',
    '- "pass"    : every criterion is covered=true',
    '- "warning" : at least one is covered="partial", none are covered=false',
    '- "fail"    : at least one criterion is covered=false',
  ].join('\n');

  onEvent({
    type: 'activity_event',
    event: makeActivityEvent({
      stage: 'validation',
      type: 'validation',
      status: 'running',
      title: 'Requirements Coverage — Cold Review',
      summary: 'A fresh Claude session (no SQL, no chat history, no tools) is checking whether the STM covers every acceptance criterion in the requirements.',
      source: 'bridge',
    }),
  });

  const result = await new Promise((resolve) => {
    const proc = spawn(claudeBin, [
      '-p', '-',
      '--output-format', 'stream-json',
      '--max-turns', '2',
      '--verbose',
      '--dangerously-skip-permissions',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildClaudeEnv(),
    });
    spawnedProcs.add(proc);

    let buffer = '';
    let fullText = '';
    let accDelta = '';

    const timer = setTimeout(() => {
      log.warn('L3 cold session timed out', { timeoutMs: L3_TIMEOUT_MS });
      metrics.incr('l3_coverage_outcome', { result: 'timeout' });
      killChildProcess(proc);
      spawnedProcs.delete(proc);
      resolve(null);
    }, L3_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
            for (const block of parsed.message.content) {
              if (block.type === 'text') fullText += block.text || '';
            }
          }
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            accDelta += parsed.delta.text;
          }
        } catch { /* skip */ }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8').trim();
      if (text) log.warn('L3 stderr', { text });
    });

    proc.stdin.write(prompt, (err) => {
      if (err) {
        clearTimeout(timer);
        killChildProcess(proc);
        spawnedProcs.delete(proc);
        resolve(null);
        return;
      }
      proc.stdin.end();
    });

    proc.on('close', () => {
      clearTimeout(timer);
      spawnedProcs.delete(proc);
      const output = fullText || accDelta;
      const m = output.match(/```coverage\s*\n([\s\S]*?)```/i);
      if (!m) {
        log.warn('L3 returned no coverage block');
        metrics.incr('l3_coverage_outcome', { result: 'no_block' });
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(m[1].trim());
        resolve(parsed);
      } catch (parseErr) {
        log.warn('L3 JSON parse error', { error: parseErr.message });
        metrics.incr('l3_coverage_outcome', { result: 'parse_error' });
        resolve(null);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      spawnedProcs.delete(proc);
      resolve(null);
    });
  });

  if (!result || typeof result !== 'object' || !result.status) {
    onEvent({
      type: 'activity_event',
      event: makeActivityEvent({
        stage: 'validation',
        type: 'error',
        status: 'warning',
        title: 'Requirements Coverage — No Result',
        summary: 'The cold coverage session timed out or returned an unparsable result. Treating coverage as not_run.',
        source: 'bridge',
      }),
    });
    return {
      status: 'not_run',
      summary: 'Requirements coverage check did not return a structured verdict.',
      checks: ['Cold L3 session timed out or returned malformed JSON.'],
    };
  }

  const status = normalizeValidationStatus(result.status);
  const criteria = Array.isArray(result.criteria) ? result.criteria : [];
  const missing = criteria.filter((c) => c.covered === false).map((c) => c.text);
  const partial = criteria.filter((c) => c.covered === 'partial' || c.covered === 'warning').map((c) => c.text);
  const checks = [
    `Criteria identified: ${criteria.length}.`,
    `Fully covered: ${criteria.filter((c) => c.covered === true).length}.`,
    partial.length ? `Partially covered: ${partial.length} — ${partial.slice(0, 5).join('; ')}.` : null,
    missing.length ? `Missing coverage: ${missing.slice(0, 5).join('; ')}.` : null,
  ].filter(Boolean);

  onEvent({
    type: 'activity_event',
    event: makeActivityEvent({
      stage: 'validation',
      type: 'validation',
      status: status === 'pass' ? 'completed' : status === 'fail' ? 'failed' : 'warning',
      title: `Requirements Coverage — ${status}`,
      summary: result.summary || `Cold review of STM ↔ requirements: ${status}.`,
      evidence: checks,
      source: 'bridge',
    }),
  });

  return {
    status,
    summary: result.summary || 'Requirements coverage assessed by cold review.',
    checks,
  };
}

// ── Two-pass Jira completion ──────────────────────────────────
// Spawned after the main run's strict gate passes. Resumes the same Claude
// conversation with Jira write tools allowed and instructs Claude to do ONLY
// the Jira comment + transition. Surfaces tool-derived activity cards via
// the same semantic translator the main pass uses.

async function runJiraCompletion(sessionId, session, request, validationSummary, onEvent) {
  const claudeBin = findClaude();
  if (!claudeBin) throw new Error('Claude CLI not found for Jira completion');

  const issueKey = `${request.jiraInput.project}-${request.jiraInput.storyNumber}`;
  const stmSummary = validationSummary?.stmCompleteness?.summary || 'STM completeness verified.';
  const reqSummary = validationSummary?.requirementCoverage?.summary || 'Requirement coverage verified.';
  const sqlSummary = validationSummary?.sqlChecks?.summary || 'BigQuery dry run passed.';
  const inferences = Array.isArray(validationSummary?.inferences) ? validationSummary.inferences.slice(0, 6) : [];
  const runMarker = `SQL Curator run ${new Date().toISOString()}`;

  const prompt = `The SQL Curator generation pass for ${issueKey} just finished successfully. The bridge withheld this conversation's Jira write tools so the comment could not be posted prematurely. Those tools are now re-enabled. Perform the Jira completion step now.

This is a NEW run. The Jira issue may already contain comments from prior runs — IGNORE THEM. You MUST post a fresh comment for this run regardless of what is already on the issue.

Authoritative context from the run that just completed:
- STM status: ${stmSummary}
- Requirement coverage: ${reqSummary}
- BigQuery validation: ${sqlSummary}
- Run marker (include verbatim in the comment so it is uniquely identifiable): ${runMarker}
${inferences.length ? `- Key inferences/assumptions:\n${inferences.map((i) => `  - ${i}`).join('\n')}` : ''}

REQUIRED ACTIONS — all three are mandatory, in order:

1. Call mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue on ${issueKey}. The comment body must include:
   - The run marker on the first line: "${runMarker}"
   - SQL purpose and target output object
   - STM row count and completeness
   - Requirement coverage against acceptance criteria
   - BigQuery dry-run result (state "PASS" explicitly)
   - Key assumptions or unresolved warnings

2. Call mcp__claude_ai_Atlassian_Rovo__getTransitionsForJiraIssue on ${issueKey} to retrieve the list of available workflow transitions.

3. From the transitions returned in step 2, pick the one whose name most closely matches "In Progress", "In Development", "Start Progress", or "Begin". Then call mcp__claude_ai_Atlassian_Rovo__transitionJiraIssue on ${issueKey} using that transition's ID. If no transition resembles an "in progress" state, pick the transition that moves the issue forward in the workflow.

Hard constraints:
- You MUST call addCommentToJiraIssue exactly once first. Do not skip it.
- You MUST call getTransitionsForJiraIssue to discover the correct transition — do not guess the transition ID or name.
- You MUST call transitionJiraIssue with the ID from the transitions list, not a guessed name.
- Do NOT regenerate SQL, STM, or any validation block.
- Do NOT call BigQuery tools.
- Do NOT call getJiraIssue to inspect existing comments — go straight to addCommentToJiraIssue.
- After all three calls return, reply with a single short confirmation sentence stating the comment ID and the new Jira status. Do NOT emit [SQL_READY] or any fenced sql/stm/validation/activity blocks.`;

  const args = [
    '-p',
    '-',
    '--output-format', 'stream-json',
    '--max-turns', '8',
    '--verbose',
    '--dangerously-skip-permissions',
  ];
  if (session.conversationId) {
    args.push('--resume', session.conversationId);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildClaudeEnv(),
    });
    spawnedProcs.add(proc);

    // Track whether Claude actually invoked the comment + transition tools.
    // If the follow-up pass exits without these, we emit a hard warning
    // because the architect just lost their Jira update.
    const followUpState = { commentPosted: false, transitioned: false };

    // Localised parser state — reuse semantic tool translator via parseClaudeLine.
    const ctx = {
      toolCalls: new Set(),
      pendingToolCalls: new Map(),
      // Mark dry-run as already-passed so the ordering detector stays silent
      // during this pass (the gate already validated it upstream).
      orderingState: { dryRunPassed: true, jiraCommentBeforeDryRun: false },
    };

    // Intercept tool_use lines to record whether the expected MCP calls fire.
    const wrappedOnEvent = (event) => {
      onEvent(event);
    };

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        // Sniff the raw stream-json for the two required tool invocations so
        // we can verify them independent of Claude's prose claims.
        try {
          const raw = JSON.parse(line);
          const checkToolUse = (entry) => {
            const n = String(entry?.name || entry?.tool_name || '').toLowerCase();
            if (n.includes('addcomment') && n.includes('jira')) followUpState.commentPosted = true;
            if (n.includes('transitionjira') && !n.includes('gettransitions')) followUpState.transitioned = true;
          };
          if (raw?.type === 'tool_use') checkToolUse(raw);
          else if (raw?.type === 'assistant' && Array.isArray(raw?.message?.content)) {
            for (const c of raw.message.content) if (c?.type === 'tool_use') checkToolUse(c);
          }
        } catch { /* not JSON, skip */ }
        const result = parseClaudeLine(line, wrappedOnEvent, ctx);
        if (result?.conversationId) session.conversationId = result.conversationId;
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`  [jira-followup stderr] ${text}`);
    });

    proc.stdin.write(prompt, (err) => {
      if (err) {
        killChildProcess(proc);
        spawnedProcs.delete(proc);
        reject(new Error(`Failed to write Jira completion prompt: ${err.message}`));
        return;
      }
      proc.stdin.end();
    });

    const timer = setTimeout(() => {
      killChildProcess(proc);
      spawnedProcs.delete(proc);
      reject(new Error(`Jira completion pass timed out after ${JIRA_COMPLETION_TIMEOUT_MS / 1000}s`));
    }, JIRA_COMPLETION_TIMEOUT_MS);

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      spawnedProcs.delete(proc);
      console.log(`  [jira-followup] Exited with code ${exitCode} for session ${sessionId.slice(0, 8)} commentPosted=${followUpState.commentPosted} transitioned=${followUpState.transitioned}`);

      // Hard verification: if Claude didn't actually invoke the required
      // Jira write tools, surface a loud failure card so the architect
      // knows the Jira update did NOT happen.
      if (!followUpState.commentPosted || !followUpState.transitioned) {
        const missing = [
          !followUpState.commentPosted ? 'comment' : null,
          !followUpState.transitioned ? 'transition' : null,
        ].filter(Boolean).join(' + ');
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'failed',
            title: 'Jira Update Skipped',
            summary: `The bridge's Jira follow-up pass ended without invoking the required ${missing} tool(s) on ${issueKey}. The Jira issue was NOT updated.`,
            details: [
              `Run marker that should have appeared on the comment: ${runMarker}`,
              'This usually means Claude decided to skip; check the Claude CLI version supports the disallowedTools flag and that Jira write MCP tools are reachable.',
            ],
            evidence: [
              `commentPosted=${followUpState.commentPosted}`,
              `transitioned=${followUpState.transitioned}`,
              `exitCode=${exitCode}`,
            ],
            source: 'bridge',
          }),
        });
      }
      resolve({ exitCode, ...followUpState });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      spawnedProcs.delete(proc);
      reject(err);
    });
  });
}

// ── JSON-Lines Parser ─────────────────────────────────────────
// Handles the various event types from `claude --output-format stream-json`
// Reference: https://docs.anthropic.com/en/docs/claude-code/cli-reference

function parseClaudeLine(line, onEvent, ctx) {
  const { toolCalls, pendingToolCalls, orderingState, dryRunAttempts } = ctx;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null; // Skip malformed lines
  }

  const type = parsed.type;

  // System init — ignore
  if (type === 'system') return null;

  // ── Tool use — Claude is calling an MCP tool ──────────
  // We store the call by tool_use_id and wait for the matching tool_result
  // so we can synthesize one architect-readable finding describing what was
  // learned, not what was called. We also detect Jira-ordering violations
  // here (a Jira write before any successful BigQuery dry run).
  if (type === 'tool_use' || (type === 'assistant' && parsed.message?.content?.some(c => c.type === 'tool_use'))) {
    const toolContents = type === 'tool_use'
      ? [parsed]
      : parsed.message.content.filter(c => c.type === 'tool_use');

    for (const toolContent of toolContents) {
      const toolName = toolContent.name || toolContent.tool_name || 'unknown_tool';
      const toolInput = toolContent.input || toolContent.tool_input || {};
      const toolId = toolContent.id || toolContent.tool_use_id || `${toolName}:${Date.now()}`;

      const toolKey = `${toolName}:${JSON.stringify(toolInput).slice(0, 500)}`;
      if (!toolCalls.has(toolKey)) {
        toolCalls.add(toolKey);
        // Pipeline tracker tick — keeps stages animating.
        onEvent({
          type: 'status',
          stage: mapToolToStage(toolName),
          message: mapToolToActivityMessage(toolName, toolInput),
        });
      }

      // Stash for pairing with tool_result.
      pendingToolCalls.set(toolId, { name: toolName, input: toolInput });

      // Ordering check: a Jira write before any successful dry run is a
      // SKILL violation. Surface it the moment it happens so the architect
      // can see the timing problem, even if Claude later "fixes" it.
      const lowerName = String(toolName).toLowerCase();
      const isJiraWrite = lowerName.includes('jira') &&
        (lowerName.includes('addcomment') ||
         lowerName.includes('transitionjira') ||
         lowerName.includes('editjira') ||
         lowerName.includes('createjira'));
      if (isJiraWrite && !orderingState.dryRunPassed && !orderingState.jiraCommentBeforeDryRun) {
        orderingState.jiraCommentBeforeDryRun = true;
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'warning',
            title: 'Jira Update Out of Order',
            summary: 'Claude attempted a Jira write (comment or transition) before a successful BigQuery dry run. Per SKILL S12 / Strict Step Ordering, Jira completion is the final step and must follow a passing dry run. The comment may not reflect the validated SQL.',
            evidence: [`Tool: ${toolName}`, 'Expected order: dry-run pass → Jira comment → transition → [SQL_READY].'],
            source: 'bridge',
          }),
        });
      }
    }
    return null;
  }

  // ── Tool result — MCP tool returned data ──────────────
  // Pair with the stashed tool_use, emit one architect-readable finding,
  // and update ordering state. Errors are flagged separately.
  if (type === 'tool_result' || (type === 'user' && parsed.message?.content?.some(c => c.type === 'tool_result'))) {
    const toolContents = type === 'tool_result'
      ? [parsed]
      : parsed.message.content.filter(c => c.type === 'tool_result');

    for (const toolContent of toolContents) {
      const toolId = toolContent.tool_use_id || toolContent.id;
      const isError = !!toolContent.is_error;
      const content = typeof toolContent.content === 'string'
        ? toolContent.content
        : JSON.stringify(toolContent.content || '');

      const callRecord = toolId ? pendingToolCalls.get(toolId) : null;
      const toolName = callRecord?.name || toolContent.name || toolContent.tool_name || 'unknown_tool';
      const toolInput = callRecord?.input || {};
      if (toolId) pendingToolCalls.delete(toolId);

      // Mark dry-run pass for ordering detector.
      const lowerName = String(toolName).toLowerCase();
      const isDryRunTool = lowerName.includes('execute_sql') || lowerName.includes('dry_run') || lowerName.includes('dryrun');
      if (!isError && isDryRunTool) {
        orderingState.dryRunPassed = true;
      }

      // Capture every dry-run attempt so the bridge can derive the gate
      // verdict from the raw tool_result. The LAST attempt is treated as the
      // verdict source (auto-fix retries on the same SQL converge to the
      // final version). Claude's self-reported sqlChecks.status is discarded
      // in favor of this deterministic signal.
      if (isDryRunTool && dryRunAttempts) {
        const sqlFromInput =
          (toolInput && typeof toolInput === 'object' && (toolInput.query || toolInput.sql || toolInput.statement)) || null;
        dryRunAttempts.push({
          toolName,
          sql: typeof sqlFromInput === 'string' ? sqlFromInput : null,
          isError,
          resultText: typeof content === 'string' ? content : String(content || ''),
          timestamp: Date.now(),
        });
      }

      const finding = semanticFindingFromToolPair(toolName, toolInput, content, isError);
      if (finding) {
        onEvent({
          type: 'activity_event',
          event: makeActivityEvent(finding),
        });
      }
    }
    return null;
  }

  // ── Content block delta — streaming text ──────────────
  if (type === 'content_block_delta') {
    const delta = parsed.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      // Return as 'delta' so the caller can emit message_start + message_delta SSE events
      return { delta: delta.text };
    }
    return null;
  }

  // ── Content block start / stop ───────────────────────
  if (type === 'content_block_start') return null;
  if (type === 'content_block_stop')  return null;

  // ── Assistant message — authoritative full text ───────
  if (type === 'assistant' && parsed.message) {
    const textParts = (parsed.message.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    if (textParts) {
      return { fullText: textParts };
    }
    return null;
  }

  // ── Result — final result from claude ─────────────────
  if (type === 'result') {
    const conversationId = parsed.conversation_id || parsed.id || null;
    return { conversationId };
  }

  return null;
}

// ── HTTP Server ───────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS headers (for local development)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /health ─────────────────────────────────────────
  // Reports a layered health status:
  //   ready                  — claude CLI present and bridge has capacity
  //   claude_not_found       — bridge is up but claude CLI is missing on PATH
  //   degraded_capacity      — at the concurrency ceiling; new requests will 503
  //   recent_errors          — last error within the past 60s (informational)
  if (req.method === 'GET' && req.url === '/health') {
    const claudeBin = findClaude();
    const atCeiling = activeRequests >= MAX_CONCURRENT;
    const recentlyErrored = bridgeState.lastErrorAt && (Date.now() - bridgeState.lastErrorAt) < 60_000;
    let status;
    if (!claudeBin) status = 'claude_not_found';
    else if (atCeiling) status = 'degraded_capacity';
    else if (recentlyErrored) status = 'recent_errors';
    else status = 'ready';

    res.writeHead(claudeBin ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status,
      claude: {
        binPath: claudeBin || null,
        detected: !!claudeBin,
      },
      capacity: {
        activeRequests,
        maxConcurrent: MAX_CONCURRENT,
        queueDepth: Math.max(0, activeRequests - MAX_CONCURRENT),
        atCeiling,
      },
      sessions: {
        active: sessions.size,
      },
      features: {
        offlineDryRunEnabled: OFFLINE_DRY_RUN_ENABLED,
        requireSqlChecksPass: REQUIRE_SQLCHECKS_PASS,
        jiraCompletionEnabled: JIRA_COMPLETION_ENABLED,
        l3CoverageCheckEnabled: L3_ENABLED,
      },
      lastError: bridgeState.lastErrorAt ? {
        atIso: new Date(bridgeState.lastErrorAt).toISOString(),
        ageMs: Date.now() - bridgeState.lastErrorAt,
        message: bridgeState.lastErrorMessage,
      } : null,
      port: PORT,
      uptimeSec: Math.floor((Date.now() - bridgeState.startedAt) / 1000),
      mode: 'claude_cli',
    }));
    return;
  }

  // ── GET /metrics ────────────────────────────────────────
  // JSON snapshot of counters, gauges, and bucketed histograms collected by
  // metrics.js. Operators / dashboards can poll this; transform to Prometheus
  // exposition format downstream if needed.
  if (req.method === 'GET' && req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptimeSec: Math.floor((Date.now() - bridgeState.startedAt) / 1000),
      snapshot: metrics.snapshot(),
    }));
    return;
  }

  // ── DELETE /session/:id ────────────────────────────────
  if (req.method === 'DELETE' && req.url?.startsWith('/session/')) {
    const sessionId = req.url.split('/session/')[1];
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
      console.log(`  [session] Deleted session ${sessionId.slice(0, 8)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // ── 404 ────────────────────────────────────────────────
  // POST /chat
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    let bodyTooLarge = false;

    req.on('data', (chunk) => {
      if (bodyTooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BODY_BYTES) {
        bodyTooLarge = true;
        sendError(res, 413, 'BODY_TOO_LARGE', 'Request body exceeds the configured maximum', {
          maxBytes: MAX_REQUEST_BODY_BYTES,
          hint: 'Reduce uploaded/context content or raise SQL_CURATOR_MAX_REQUEST_BODY_BYTES.',
        });
        req.destroy();
      }
    });

    req.on('end', async () => {
      if (bodyTooLarge) return;

      let rawBody;
      try {
        rawBody = JSON.parse(body);
      } catch {
        sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
        return;
      }

      const validation = validateChatBody(rawBody);
      if (!validation.ok) {
        sendError(res, 400, validation.code, validation.message, { field: validation.field });
        return;
      }
      // From here on we use the normalised, type-safe payload.
      const request = validation.value;
      const { sessionId, taskType, bqProjectId, bqDatasetId } = request;

      const isOfflineDryRun = request.dryRun && OFFLINE_DRY_RUN_ENABLED;
      if (request.dryRun && !OFFLINE_DRY_RUN_ENABLED) {
        sendError(res, 403, 'OFFLINE_DRY_RUN_DISABLED', 'Offline dry run is disabled', {
          hint: 'Set SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN=true only for local UI validation without Claude Code.',
        });
        return;
      }

      if (!isOfflineDryRun && !findClaude()) {
        sendError(res, 503, 'CLAUDE_CLI_NOT_FOUND', 'Claude CLI not found on PATH', {
          hint: 'Install with: npm install -g @anthropic-ai/claude-code',
        });
        return;
      }

      // ── Idempotency check ────────────────────────────────
      // If the client supplied an Idempotency-Key, reject duplicates within
      // the TTL window so a refresh / double-click / network retry never
      // spawns a duplicate Claude session.
      const idempotencyKeyRaw = req.headers['idempotency-key'];
      const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
      if (idempotencyKey) {
        if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
          sendError(res, 400, 'IDEMPOTENCY_KEY_FORMAT', 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9_-]', {
            field: 'Idempotency-Key',
          });
          return;
        }
        const existing = idempotency.get(idempotencyKey);
        if (existing) {
          metrics.incr('idempotency_collision', { state: existing.state });
          if (existing.state === 'in_flight') {
            sendError(res, 409, 'REQUEST_IN_FLIGHT', 'A request with this Idempotency-Key is still in flight', {
              originalRequestId: existing.requestId,
              hint: 'Wait for the in-flight request to complete or use a new Idempotency-Key.',
            });
            return;
          }
          // Completed within TTL — refuse rather than re-bill the user.
          sendError(res, 409, 'REQUEST_ALREADY_COMPLETED', 'A request with this Idempotency-Key already completed', {
            originalRequestId: existing.requestId,
            completedAtIso: new Date(existing.completedAt).toISOString(),
            succeeded: existing.succeeded,
            hint: 'Use a fresh Idempotency-Key for a new run.',
          });
          return;
        }
      }

      const requestId = newRequestId();
      const requestLog = createLogger({ requestId, sessionId, component: 'request' });
      metrics.incr('requests_total', { endpoint: '/chat', taskType });
      const requestStartMs = Date.now();

      // Mark in-flight before we open the SSE stream so a duplicate hit
      // racing in milliseconds is properly rejected.
      if (idempotencyKey) {
        idempotency.set(idempotencyKey, { state: 'in_flight', requestId, completedAt: 0, succeeded: false });
      }

      // Client-disconnect abort. The SSE response closes when the browser
      // navigates away or the tab is closed. We propagate the abort into the
      // Claude session so the child process tree is killed promptly rather
      // than running to its wall-clock timeout while no one is listening.
      const clientAbort = new AbortController();
      let clientDisconnected = false;
      req.on('close', () => {
        if (!clientDisconnected) {
          clientDisconnected = true;
          requestLog.warn('Client disconnected mid-stream');
          metrics.incr('requests_client_disconnect', { endpoint: '/chat' });
          clientAbort.abort();
        }
      });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId,
      });
      if (res.socket) res.socket.setNoDelay(true);
      requestLog.info('Request accepted', { taskType, projectId: bqProjectId, datasetId: bqDatasetId });
      const sseSend = (event, data) => {
        try {
          // Single write — some Node versions can hold sub-chunk writes in the
          // outbound buffer. Combining keeps the frame atomic.
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          // Best-effort flush. cork/uncork forces accumulated writes out.
          if (typeof res.flush === 'function') {
            res.flush();
          } else if (res.socket && typeof res.socket.uncork === 'function') {
            res.socket.uncork();
          }
          const elapsed = Date.now() - requestStartMs;
          // Skip noisy heartbeat status pings in the log.
          if (event !== 'message_delta') {
            console.log(`  [sse +${String(elapsed).padStart(5, ' ')}ms] ${event}${data && data.stage ? ` stage=${data.stage}` : ''}${data && data.event && data.event.title ? ` "${data.event.title}"` : ''}`);
          }
        } catch {
          // Client disconnected.
        }
      };

      const session = getSession(sessionId);
      session.lastActivity = Date.now();
      trimSession(sessionId);

      sseSend('status', { stage: 'intake', status: 'active', message: 'Connecting to Claude Code...', timestamp: Date.now() });

      try {
        const prompt = buildPrompt(request);

        sseSend('status', { stage: 'intake', status: 'completed', message: 'Input delivered to Claude Code.', timestamp: Date.now() });
        sseSend('status', { stage: 'analysis', status: 'active', message: 'Claude is analyzing your request...', timestamp: Date.now() });

        const eventHandler = (event) => {
          switch (event.type) {
            case 'status':
              if (event.stage) currentHeartbeatStage = event.stage;
              if (event.status === 'completed' && event.stage === 'ready') isTerminalStage = true;
              sseSend('status', { ...event, timestamp: Date.now() });
              break;
            case 'activity_event':
              sseSend('activity_event', { event: makeActivityEvent(event.event), timestamp: Date.now() });
              break;
            case 'message_start':
              sseSend('message_start', { timestamp: Date.now() });
              break;
            case 'message_delta':
              sseSend('message_delta', { content: event.content, timestamp: Date.now() });
              break;
            case 'message':
              sseSend('message', { ...event, timestamp: Date.now() });
              break;
            case 'clarification':
              sseSend('clarification', { ...event, timestamp: Date.now() });
              break;
            case 'sql':
              sseSend('sql', { sql: event.sql, fileName: event.fileName, timestamp: Date.now() });
              break;
            case 'stm':
              sseSend('stm', { artifact: event.artifact, timestamp: Date.now() });
              break;
            case 'validation_summary':
              for (const activityEvent of activityEventsFromValidationSummary(event.summary)) {
                sseSend('activity_event', { event: activityEvent, timestamp: Date.now() });
              }
              sseSend('validation_summary', { summary: event.summary, timestamp: Date.now() });
              break;
            case 'done':
              sseSend('done', { ...event, timestamp: Date.now() });
              break;
            case 'error':
              sseSend('activity_event', {
                event: makeActivityEvent({
                  stage: 'validation',
                  type: 'error',
                  status: 'failed',
                  title: 'Claude Code Error',
                  summary: event.message || 'Claude Code returned an error.',
                  details: event.hint ? [event.hint] : undefined,
                  source: 'bridge',
                }),
                timestamp: Date.now(),
              });
              sseSend('error', { ...event, timestamp: Date.now() });
              break;
          }
        };

        let lastEventTime = Date.now();
        let currentHeartbeatStage = 'analysis';
        let isTerminalStage = false;
        const trackingHandler = (event) => {
          lastEventTime = Date.now();
          eventHandler(event);
        };
        const heartbeatInterval = setInterval(() => {
          const silenceSec = Math.round((Date.now() - lastEventTime) / 1000);
          if (silenceSec >= 25 && !isTerminalStage) {
            sseSend('status', {
              stage: currentHeartbeatStage,
              status: 'active',
              message: `Claude Code is still working (${silenceSec}s without a new event).`,
              timestamp: Date.now(),
            });
          }
        }, 30000);

        const result = isOfflineDryRun
          ? runOfflineDryRun(request, trackingHandler)
          : await runClaude(prompt, sessionId, request, trackingHandler, { requestId, log: requestLog, abortSignal: clientAbort.signal }).finally(() => {
              clearInterval(heartbeatInterval);
            });

        if (isOfflineDryRun) {
          clearInterval(heartbeatInterval);
        }

        const durationMs = Date.now() - requestStartMs;
        metrics.observe('request_duration_ms', { endpoint: '/chat' }, durationMs);
        metrics.incr(result.success ? 'requests_succeeded' : 'requests_completed_with_issue', { endpoint: '/chat' });
        requestLog.info('Request completed', {
          success: result.success,
          clarification: !!result.clarification,
          durationMs,
        });
        if (idempotencyKey) {
          idempotency.set(idempotencyKey, { state: 'completed', requestId, completedAt: Date.now(), succeeded: !!result.success });
        }
      } catch (err) {
        const message = err.message || 'Unknown error';
        metrics.incr('requests_failed', { endpoint: '/chat' });
        recordError(message);
        requestLog.error('Request failed', { error: message });
        if (idempotencyKey) {
          idempotency.set(idempotencyKey, { state: 'completed', requestId, completedAt: Date.now(), succeeded: false });
        }

        sseSend('status', { stage: 'idle', message: 'Error occurred', timestamp: Date.now() });
        sseSend('activity_event', {
          event: makeActivityEvent({
            stage: 'validation',
            type: 'error',
            status: 'failed',
            title: 'Bridge Error',
            summary: message,
            source: 'bridge',
          }),
          timestamp: Date.now(),
        });
        // Structured error response: code, message, requestId — no stack.
        sseSend('error', {
          code: 'BRIDGE_ERROR',
          message,
          requestId,
          timestamp: Date.now(),
        });
        sseSend('done', { success: false, requestId, timestamp: Date.now() });
      }

      res.end();
    });

    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'No handler for this method and path', {
    endpoints: ['POST /chat', 'GET /health', 'GET /metrics', 'DELETE /session/:id'],
  });
});

// ── Start Server ──────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   SQL Curator Claude Bridge v1.0             ║');
  console.log('  ║   Claude Code CLI → SSE Proxy                ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Port:          ${String(PORT).padEnd(27)}║`);
  console.log(`  ║   Claude CLI:    ${findClaude() ? 'detected ✓'.padEnd(27) : 'NOT FOUND ✗'.padEnd(27)}║`);
  console.log(`  ║   Max Turns:     ${String(CLAUDE_MAX_TURNS).padEnd(27)}║`);
  console.log(`  ║   Timeout:       ${String(CLAUDE_TIMEOUT_MS / 1000 + 's').padEnd(27)}║`);
  console.log(`  ║   Concurrency:   ${String(MAX_CONCURRENT).padEnd(27)}║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   Endpoints:                                    ║');
  console.log('  ║     POST /chat         Send prompt → Claude   ║');
  console.log('  ║     GET  /health       Health check           ║');
  console.log('  ║     DELETE /session/:id Clear session history ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   MCP Tools: Jira, BigQuery, GitHub            ║');
  console.log('  ║   Config:    ~/.claude.json                    ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  if (!findClaude()) {
    console.error('  ⚠  WARNING: Claude CLI not found on PATH!');
    console.error('     Install: npm install -g @anthropic-ai/claude-code');
    console.error('     Docs:   https://docs.anthropic.com/en/docs/claude-code/overview');
    console.error('     MCP:    https://modelcontextprotocol.io/docs/develop/connect-local-servers');
    console.error('');
  }
});

// ── Graceful Shutdown + Orphan Reaping ────────────────────────
// Production failure modes we defend against:
//   • SIGTERM / SIGINT  → drain server, kill child processes, exit clean.
//   • uncaughtException → log fatal, kill children, exit non-zero so the
//                         supervisor (systemd/k8s/docker) restarts cleanly.
//   • node 'exit' event → final synchronous sweep of any lingering children
//                         (covers paths that bypass the signal handlers).
//
// killChildProcess uses taskkill /T on Windows and SIGTERM → SIGKILL on POSIX,
// which kills the whole MCP server subtree, not just the claude CLI itself.

let shuttingDown = false;
function reapAllChildren(reason) {
  let killed = 0;
  for (const proc of spawnedProcs) {
    try {
      killChildProcess(proc);
      killed++;
    } catch (err) {
      // Best effort — some may already be dead.
      rootLogger.warn('Reap failed for child', { pid: proc?.pid, error: err?.message });
    }
  }
  spawnedProcs.clear();
  if (killed > 0) {
    rootLogger.info('Reaped child processes', { reason, count: killed });
  }
  return killed;
}

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  rootLogger.info('Bridge shutting down', { signal });
  reapAllChildren(signal);
  server.close(() => {
    rootLogger.info('Bridge stopped cleanly');
    process.exit(0);
  });
  setTimeout(() => {
    rootLogger.error('Forced shutdown after 5s timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Final-line-of-defence sweep: if anything resolves via process.exit() or an
// async path that bypasses gracefulShutdown, this synchronous hook still
// reaps child processes so the host doesn't get cluttered with orphans.
process.on('exit', () => {
  if (spawnedProcs.size > 0) {
    reapAllChildren('process_exit');
  }
});

// A fatal error puts the bridge in an undefined state — orphaned children,
// half-flushed SSE streams, and an unknown view of the session map. Log
// loudly, attempt graceful shutdown, and exit non-zero so a supervisor can
// restart cleanly instead of letting the process limp on with corrupt state.
process.on('uncaughtException', (err) => {
  rootLogger.fatal('Uncaught exception', { error: err && err.message, stack: err && err.stack });
  recordError(`Uncaught exception: ${err && err.message}`);
  try { gracefulShutdown('uncaughtException'); } catch { /* ignore */ }
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  rootLogger.error('Unhandled rejection', { reason: msg });
  recordError(`Unhandled rejection: ${msg}`);
  // Do not exit on unhandled rejection by default — Node will downgrade these
  // to crashes in the future. For now we log + record so /health reflects it
  // without losing in-flight runs.
});
