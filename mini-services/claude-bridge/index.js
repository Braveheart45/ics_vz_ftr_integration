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
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_SOURCES,
  inferActivityType,
  inferActivityStage,
  normalizeActivityStatus,
  normalizeActivitySource,
  normalizeActivityType,
  normalizeStringList,
  makeActivityEvent,
} = require('./activity');
const {
  safeJsonStringify,
  safeJsonParse,
  tryParseJson,
  pickStrings,
  clipForActivity,
  canonicaliseToolResultContent,
} = require('./tool-helpers');
const {
  extractSql,
  extractStm: extractStmRaw,
  isClarificationRequest,
  extractClarification,
  detectTerminalRunIssue,
} = require('./output-parsers');
const {
  decideSqlRelease,
  normalizeValidationStatus,
  combineValidationStatuses,
  deriveDryRunStatus,
} = require('./release-policy');
const { runStructuralChecks } = require('./structural-checks');
const promptAssembler = require('./prompt-assembler');

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
// the single linear Claude session.
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
      rootLogger.debug('Expired idle session', { sessionId: id.slice(0, 8) });
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
        rootLogger.debug('Found Claude CLI', { command: cmd });
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
      rootLogger.debug('Found Claude CLI', { path: p });
      return p;
    }
  }

  return null;
}

// ── Prompt Builder ────────────────────────────────────────────

// The agent's brain (spine + references + contracts + validator persona) is
// composed by ./prompt-assembler.js — the single seam that reads skills/ and
// contracts/ from disk and assembles the prompt. The bridge no longer inlines
// or paraphrases skill content here.
const BRAIN_STATUS = promptAssembler.getLoadStatus();
if (BRAIN_STATUS.loaded) {
  rootLogger.info('Agent brain loaded from skills/ + contracts/', { issues: BRAIN_STATUS.issues.length });
} else {
  rootLogger.error('Agent brain failed to load; generation prompts will be incomplete', { issues: BRAIN_STATUS.issues });
}

function buildThinShellPrompt(request) {
  // Composition is owned by prompt-assembler.js (single source of truth).
  return promptAssembler.assembleGenerationPrompt(request, {
    maxHistoryMessages: MAX_HISTORY_MESSAGES,
    dialect: 'bigquery',
  });
}

function buildPrompt(request) {
  return buildThinShellPrompt(request);
}

// ── SQL Extraction ────────────────────────────────────────────

// Thin wrapper that supplies the session-scoped version counter so the
// extractor in output-parsers.js stays pure.
function extractStm(content, request, sessionId) {
  const parsed = extractStmRaw(content, request, nextStmVersion(sessionId));
  if (!parsed) {
    if (/```stm\s*\n/i.test(content || '')) {
      // STM block existed but parse failed — surface for the operator.
      rootLogger.warn('Failed to parse STM JSON block');
    }
  }
  return parsed;
}

// Validation status helpers (combine/derive/normalise) live in ./release-policy.js.
// Activity event normalisers moved to ./activity.js.
// Tool result parsing helpers moved to ./tool-helpers.js.
// SQL/STM/clarification/terminal extractors moved to ./output-parsers.js.

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
      rootLogger.warn('Failed to parse validation JSON', { error: err.message });
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

// normalizeValidationStatus + combineValidationStatuses now live in
// ./release-policy.js so they can be unit-tested in isolation.

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
  // Preserve structured inference objects {claim, confidence, evidence} from the
  // validation JSON block. Falling back to prose-extracted strings only when the
  // validation block produced no structured inferences.
  const sourceInferences = Array.isArray(source.inferences)
    ? source.inferences.filter((item) => item !== null && item !== undefined)
    : [];
  const inferences = sourceInferences.length > 0
    ? sourceInferences.slice(0, 20)
    : (context.inferences || []).slice(0, 20);
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

// ── Semantic tool → architect-readable finding ───────────────
// Each MCP tool call is paired with its tool_result (by tool_use_id) so we
// can synthesize one finding card with the actual learned content, in
// architect language — never plumbing terms like "Called", "Invoked", "MCP".

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
      rootLogger.warn('Failed to parse inline activity block', { error: err.message });
      continue;
    }
    onEvent({
      type: 'activity_event',
      event: makeActivityEvent({
        ...parsed,
        source: parsed.source || 'claude',
      }),
    });
    // Also tick the pipeline matrix forward when Claude crosses into a new
    // stage. Tool-call ticks cover schema and intake; inline activity blocks
    // are the only signal for sql_generation and validation transitions.
    const PIPELINE_ADVANCE_STAGES = new Set(['analysis', 'schema_resolution', 'sql_generation', 'validation', 'ready']);
    if (parsed.stage && PIPELINE_ADVANCE_STAGES.has(parsed.stage)) {
      onEvent({ type: 'status', stage: parsed.stage, message: parsed.title || '' });
    }
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
  // Bridge-owned validation verdict source: every BigQuery dry-run/execute MCP
  // call that completes is captured here from the raw tool_result. In the close
  // handler, deriveDryRunStatus() reduces these to a deterministic pass/fail/
  // not_run that OVERRIDES Claude's self-reported validation.sqlChecks.status
  // when they disagree. This keeps the executional verdict free of LLM
  // interpretation bias while remaining inside the MCP-only constraint.
  const dryRunAttempts = [];

  // Shared context passed to parseClaudeLine for every stream-json line. We
  // mutate this object to thread state across event-handler invocations
  // (e.g. `lastResult.subtype` is written when the `result` event arrives
  // so the close handler can label the auto-retry card with the real cause).
  const parseCtx = {
    toolCalls,
    pendingToolCalls,
    orderingState,
    dryRunAttempts,
    lastResult: null,
  };

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

    // Linear single-pass: all MCP tools (BigQuery read+execute, Jira read+write,
    // GitHub) are available throughout. The skill controls ordering — Jira writes
    // happen only at S13, after S11 validator + S12 dry-run complete.

    // Resume conversation if we have a conversation ID
    if (session.conversationId) {
      args.push('--resume', session.conversationId);
    }

    proc = spawn(claudeBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildClaudeEnv(),
      // Run the session at the repo root so on-demand Reads of skill reference
      // paths resolve and the layout matches what the Agent SDK will expect.
      // The brain is injected by prompt-assembler.js regardless, so this does
      // not depend on CLAUDE.md auto-load behaviour in headless mode.
      cwd: promptAssembler.REPO_ROOT,
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
        // Debug-only stream-json trace for diagnosing Claude streaming.
        let snippet = line;
        try {
          const j = JSON.parse(line);
          snippet = `${j.type}${j.message?.role ? `/${j.message.role}` : ''}${j.message?.content ? ` blocks=${(j.message.content || []).map((c) => c.type).join(',')}` : ''}${j.subtype ? ` subtype=${j.subtype}` : ''}`;
        } catch { /* keep raw */ }
        log.debug('Claude stream event', { elapsedMs: Date.now() - claudeStartMs, event: snippet });
        const result = parseClaudeLine(line, onEvent, parseCtx);
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
      let sqlBlock    = extractSql(finalText);
      const hasSqlBlock = !!sqlBlock;

      log.debug('Final text diagnostic', {
        chars: finalText.length,
        hasSqlBlock,
        isClarify,
        hasSqlReady: finalText.includes('[SQL_READY]'),
        snippet: finalText.slice(0, 800).replace(/\n/g, '\\n'),
      });

      // Emit final message (replaces/corrects any streaming bubble on the
      // client). Strip out the inline ```activity blocks: they were already
      // streamed individually as activity_event SSEs and would otherwise
      // appear as a wall of JSON in the assistant message cache.
      if (finalText) {
        onEvent({ type: 'message', content: stripInlineActivities(finalText) });
      }

      const isGithubDeploy = request.taskType === 'github_deploy';
      const isJiraBackedRun = !!(request.jiraInput?.project && request.jiraInput?.storyNumber);

      // Advance the pipeline matrix immediately so the UI shows "Validate"
      // while we parse Claude's emitted validation block — not after.
      if (hasSqlBlock && !isGithubDeploy && !isClarify) {
        onEvent({ type: 'status', stage: 'sql_generation', status: 'completed', message: 'BigQuery SQL generated.' });
        onEvent({ type: 'status', stage: 'validation', status: 'active', message: 'Parsing validator + dry-run + Jira results...' });
      }

      // ── Validation (linear in-session flow + deterministic backstop) ───
      // S11 (validator persona) + S12 (dry-run) + S13 (Jira) run inside Claude's
      // main pass and Claude emits a `validation` JSON block. We DO NOT take
      // Claude's self-reported sqlChecks.status on faith: the bridge captured
      // every real execute_sql_readonly result in `dryRunAttempts`, and the
      // deterministic dry-run verdict derived from those raw is_error flags
      // OVERRIDES Claude's prose whenever they disagree. A hallucinated or
      // skipped dry-run therefore cannot produce a clean release.
      let validationSummary = null;
      let stmBlock = null;
      if (hasSqlBlock) {
        validationSummary = extractValidationSummary(finalText, request);
        stmBlock = (finalText.match(/```stm\s*\n([\s\S]*?)```/i) || [])[1] || null;
      }

      // Deterministic STM↔SQL structural check (LLM-free). Like the dry-run
      // signal, this OVERRIDES the validator persona's prose stmCompleteness
      // when it finds a concrete mechanical mismatch (a STM target column with
      // no matching SELECT alias, or a STM source table not referenced).
      let structuralVerdict = null;
      if (hasSqlBlock && !isGithubDeploy && !isClarify) {
        structuralVerdict = runStructuralChecks(sqlBlock, stmBlock);
        const claudeStm = normalizeValidationStatus(validationSummary?.stmCompleteness?.status);
        // Only downgrade, never upgrade: a deterministic fail/warning overrides a
        // claimed pass; a deterministic pass leaves the persona's verdict intact
        // (the persona also judges transformation fidelity the checker can't see).
        const structuralWorse = combineValidationStatuses([claudeStm, structuralVerdict.status]) !== claudeStm;
        if (validationSummary && structuralVerdict.status !== 'pass' && structuralWorse) {
          validationSummary.stmCompleteness = {
            status: structuralVerdict.status,
            summary: `Bridge structural check: ${structuralVerdict.summary}`,
            checks: structuralVerdict.checks.map((c) => `${c.name}: ${c.status} — ${c.detail}`),
          };
        }
        metrics.incr('validation_status', { source: 'structural', status: structuralVerdict.status });
      }

      // Deterministic dry-run status from the raw tool results (not Claude prose).
      const deterministicDryRun = deriveDryRunStatus(dryRunAttempts);
      const claudeDryRun = normalizeValidationStatus(validationSummary?.sqlChecks?.status);
      const dryRunDisagreement = hasSqlBlock && validationSummary && deterministicDryRun !== claudeDryRun;

      // Reconcile: the deterministic signal wins. Overwrite the sqlChecks
      // section so the UI's validation summary reflects reality, not the claim.
      if (hasSqlBlock && validationSummary) {
        const dryRunSummary =
          deterministicDryRun === 'not_run'
            ? 'No BigQuery dry-run (execute_sql_readonly) was observed during the run. S12 was skipped — the SQL has NOT been executionally validated.'
            : deterministicDryRun === 'fail'
              ? 'The last BigQuery dry-run returned an error. The SQL did not pass executional validation.'
              : 'BigQuery dry-run completed without error.';
        validationSummary.sqlChecks = {
          status: deterministicDryRun,
          summary: dryRunSummary,
          checks: [
            `Dry-run attempts observed: ${dryRunAttempts.length}.`,
            dryRunDisagreement
              ? `Claude self-reported sqlChecks="${claudeDryRun}" but the bridge observed "${deterministicDryRun}" — bridge signal wins.`
              : `Bridge-observed dry-run status: ${deterministicDryRun}.`,
          ],
        };
      }

      if (validationSummary) {
        metrics.incr('validation_status', { source: 'stm', status: validationSummary?.stmCompleteness?.status || 'unknown' });
        metrics.incr('validation_status', { source: 'requirements', status: validationSummary?.requirementCoverage?.status || 'unknown' });
        metrics.incr('validation_status', { source: 'sql_dryrun', status: deterministicDryRun });
        metrics.incr('validation_status', { source: 'jira', status: validationSummary?.jiraTransition?.status || 'unknown' });
        if (dryRunDisagreement) metrics.incr('dry_run_disagreement', { claude: claudeDryRun, bridge: deterministicDryRun });
      }

      // Out-of-order Jira write detector (#4/#5): if Claude posted a Jira
      // comment/transition BEFORE a successful dry-run, that is a contract
      // violation that writes to an external system against unvalidated SQL.
      // Surface it as a release-affecting warning directly (jiraTransition is
      // intentionally NOT part of combineValidationStatuses, so route it here).
      const prematureJiraWrite = !!orderingState.jiraCommentBeforeDryRun;

      // Take the worst status across the validator sub-sections + the
      // deterministic STM↔SQL structural check + the deterministic dry-run +
      // the premature-Jira flag.
      const validationStatus = combineValidationStatuses([
        validationSummary?.stmCompleteness?.status,
        validationSummary?.requirementCoverage?.status,
        structuralVerdict ? structuralVerdict.status : 'pass',
        deterministicDryRun,
        prematureJiraWrite ? 'warning' : 'pass',
      ]);

      const releaseDecision = decideSqlRelease({
        hasSqlBlock,
        isClarify,
        isGithubDeploy,
        validationStatus,
      });
      const surfacesSql = releaseDecision.surfacesSql;
      const validationPassed = releaseDecision.validationPassed;
      const sqlReleaseWarning = releaseDecision.warning;

      if (surfacesSql) {
        const ticketKey = request.jiraInput?.project && request.jiraInput?.storyNumber
          ? `${request.jiraInput.project}-${request.jiraInput.storyNumber}`
          : 'standalone';
        onEvent({ type: 'status', stage: 'analysis', status: 'completed', message: 'Requirement analysis completed.' });
        onEvent({ type: 'status', stage: 'schema_resolution', status: 'completed', message: 'Schema and mapping context resolved.' });
        onEvent({ type: 'sql', sql: sqlBlock, fileName: `sql_curator_${ticketKey}_${Date.now()}.sql`, warning: sqlReleaseWarning || undefined });
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
        // Dedicated card when the deterministic STM↔SQL check found a mismatch.
        if (structuralVerdict && structuralVerdict.status === 'fail') {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'validation',
              status: 'failed',
              title: 'STM ↔ SQL Check (bridge-verified) — fail',
              summary: structuralVerdict.summary,
              evidence: structuralVerdict.checks.map((c) => `${c.name}: ${c.detail}`),
              source: 'bridge',
            }),
          });
        }
        // Dedicated card when Claude skipped the mandatory S12 dry-run.
        if (deterministicDryRun === 'not_run') {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'error',
              status: 'warning',
              title: 'Mandatory Dry-Run Was Skipped',
              summary: 'No execute_sql_readonly call was observed this run. S12 is mandatory; the released SQL has NOT been executionally validated against BigQuery.',
              details: ['Re-run, or run the SQL through a BigQuery dry-run manually before using it.'],
              source: 'bridge',
            }),
          });
        }
        // Dedicated card when the deterministic signal contradicts Claude.
        if (dryRunDisagreement && deterministicDryRun !== 'not_run') {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'validation',
              status: deterministicDryRun === 'fail' ? 'failed' : 'warning',
              title: 'Dry-Run Verdict Corrected by Bridge',
              summary: `Claude reported the dry-run as "${claudeDryRun}", but the bridge observed "${deterministicDryRun}" from the actual BigQuery tool result. The bridge signal is authoritative.`,
              source: 'bridge',
            }),
          });
        }
        // Dedicated card when Jira was written before a successful dry-run.
        if (prematureJiraWrite) {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'error',
              status: 'warning',
              title: 'Jira Written Before Validation',
              summary: 'A Jira comment/transition was issued before a successful dry-run completed. The Jira issue may have been updated against unvalidated SQL.',
              source: 'bridge',
            }),
          });
        }
        if (sqlReleaseWarning) {
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'validation',
              status: 'warning',
              title: 'SQL Released With Validation Warning',
              summary: sqlReleaseWarning,
              details: [
                `STM ↔ SQL alignment: ${validationSummary?.stmCompleteness?.status || 'unknown'}`,
                `Requirement coverage: ${validationSummary?.requirementCoverage?.status || 'unknown'}`,
                `Dry-run (bridge-verified): ${deterministicDryRun}`,
                prematureJiraWrite ? 'Jira was written before validation completed.' : null,
              ].filter(Boolean),
              source: 'bridge',
            }),
          });
        }
        onEvent({ type: 'validation_summary', summary: validationSummary });
        onEvent({
          type: 'status',
          stage: 'validation',
          status: 'completed',
          message: validationPassed
            ? 'Validated against requirements, mappings, and available schema context.'
            : 'SQL released with validation warnings. Review validation summary before use.',
        });
      }

      if (!hasSqlBlock && !isClarify && !isGithubDeploy) {
        const terminalIssue = detectTerminalRunIssue(finalText);

        // ── Auto-retry: request the SQL block explicitly once ──
        // Fires whenever the first pass returned no SQL block (missing_sql).
        // If the session has a conversation ID we resume via --resume so Claude
        // has full context. Without one (e.g. the CLI result event omitted
        // session_id) we re-run fresh but include the prior assistant text in
        // the message history so the retry still has context.
        if (terminalIssue.kind === 'missing_sql' && retryCount === 0) {
          const resumeId = session.conversationId;
          const lastResult = parseCtx.lastResult || {};
          const subtype = lastResult.subtype || 'unknown';
          const numTurns = lastResult.numTurns;
          log.warn('Auto-retry: no SQL block on first pass', {
            resumeId: resumeId ? resumeId.slice(0, 12) : 'none (fresh)',
            resultSubtype: subtype,
            numTurns,
          });
          metrics.incr('auto_retry_attempts', { reason: subtype === 'error_max_turns' ? 'max_turns' : 'missing_sql' });
          const reasonText = subtype === 'error_max_turns'
            ? `First pass hit the ${numTurns ?? '?'}-turn budget before emitting the final SQL block. Consider raising CLAUDE_MAX_TURNS if this keeps happening.`
            : subtype === 'error_during_execution'
              ? 'First pass exited mid-execution before emitting the final SQL block.'
              : 'First pass returned no fenced SQL block.';
          onEvent({
            type: 'activity_event',
            event: makeActivityEvent({
              stage: 'validation',
              type: 'observation',
              status: 'completed',
              title: 'Auto-Retry Triggered',
              summary: `${reasonText} ${resumeId ? 'Resumed the same conversation' : 'Re-ran with explicit SQL formatting instructions'} and asked Claude to emit the artifact. New cards below are from the retry.`,
              evidence: [
                `result subtype: ${subtype}`,
                numTurns != null ? `turns used: ${numTurns}` : null,
                `retry mode: ${resumeId ? 'resume' : 'fresh'}`,
              ].filter(Boolean),
              source: 'bridge',
            }),
          });

          const retryUserMsg = 'IMPORTANT: Your previous response did not include a fenced ```sql``` code block, which is required. The MCP tools (BigQuery, Jira, GitHub) are already authenticated — do not try to authenticate them. Do not call ToolSearch. Emit the complete SQL now inside a properly fenced ```sql\\n...\\n``` block, followed by the STM (```stm) and validation (```validation) blocks, then end with [SQL_READY]. If you did not generate SQL yet, generate it now from the requirements and schema already in context.';
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

      // Jira completion now happens inline in Claude's main pass at S13.
      // No follow-up pass — the validation summary reports the final Jira result.

      if (surfacesSql) {
        onEvent({
          type: 'status',
          stage: 'ready',
          status: 'completed',
          message: validationPassed ? 'SQL ready for review and copy.' : 'SQL ready for review with validation warnings.',
        });
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

      // Capture every dry-run attempt so the close handler can derive the
      // deterministic executional verdict (deriveDryRunStatus). The LAST
      // attempt is the verdict source (auto-fix retries converge on the final
      // SQL). This overrides Claude's self-reported sqlChecks.status.
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
  // The Claude CLI uses `session_id` in current versions; older builds used
  // `conversation_id` or bare `id`. Accept all three so --resume works.
  // Capture `subtype` so the bridge can distinguish natural completion from
  // max-turns / errors (drives the auto-retry copy).
  if (type === 'result') {
    const conversationId = parsed.session_id || parsed.conversation_id || parsed.id || null;
    const subtype = parsed.subtype || null;
    const numTurns = typeof parsed.num_turns === 'number' ? parsed.num_turns : null;
    if (ctx && typeof ctx === 'object') {
      ctx.lastResult = { subtype, numTurns, isError: !!parsed.is_error };
    }
    return { conversationId, resultSubtype: subtype, numTurns };
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
        brainLoaded: BRAIN_STATUS.loaded,
        brainLoadIssues: BRAIN_STATUS.issues.length,
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
      rootLogger.info('Session deleted', { sessionId: sessionId.slice(0, 8) });
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

      // Client-disconnect abort. Listen on `res` (the response/socket half),
      // not `req`. In HTTP/1.1, req.on('close') fires when the request body
      // is fully consumed — which happens immediately after readBody() returns,
      // long before Claude starts. res.on('close') fires only when the response
      // socket is torn down before res.end() — the genuine mid-stream disconnect.
      const clientAbort = new AbortController();
      let clientDisconnected = false;
      res.on('close', () => {
        if (!clientDisconnected && !res.writableEnded) {
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
          if (event !== 'message_delta') {
            requestLog.debug('SSE event sent', {
              elapsedMs: Date.now() - requestStartMs,
              event,
              stage: data && data.stage,
              title: data && data.event && data.event.title,
            });
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
              sseSend('sql', { sql: event.sql, fileName: event.fileName, warning: event.warning, timestamp: Date.now() });
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
  const claudeBin = findClaude();
  rootLogger.info('Claude bridge started', {
    host: '127.0.0.1',
    port: PORT,
    claudeDetected: !!claudeBin,
    claudeBin,
    maxTurns: CLAUDE_MAX_TURNS,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    maxConcurrent: MAX_CONCURRENT,
    endpoints: ['POST /chat', 'GET /health', 'GET /metrics', 'DELETE /session/:id'],
  });

  if (!claudeBin) {
    rootLogger.warn('Claude CLI not found on PATH', {
      install: 'npm install -g @anthropic-ai/claude-code',
      docs: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    });
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
