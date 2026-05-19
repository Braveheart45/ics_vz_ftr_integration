'use strict';

// ============================================================
// claude-bridge — runtime configuration
// ============================================================
//
// Loads every environment variable in one place, applies defaults, coerces
// to the right type, validates ranges, and freezes the result so accidental
// mutation downstream is impossible.
//
// Fail-fast policy: any malformed or out-of-range value throws at startup so
// the bridge does not boot in a half-configured state. Errors are aggregated
// so the operator sees every problem at once instead of fixing them one by
// one through repeated boot attempts.
// ============================================================

const DEFAULTS = {
  BRIDGE_PORT: '3001',
  CLAUDE_MAX_TURNS: '25',
  CLAUDE_TIMEOUT_MS: '1200000',
  MAX_HISTORY_MESSAGES: '20',
  CLAUDE_MAX_CONCURRENT: '3',
  SQL_CURATOR_MAX_REQUEST_BODY_BYTES: String(2 * 1024 * 1024),
  SQL_CURATOR_MAX_STREAM_BUFFER_BYTES: String(8 * 1024 * 1024),
  SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN: 'false',
  SQL_CURATOR_REQUIRE_DRYRUN_PASS: 'true',
  SQL_CURATOR_DEFER_JIRA_COMPLETION: 'true',
  SQL_CURATOR_JIRA_COMPLETION_TIMEOUT_MS: '120000',
  SQL_CURATOR_L3_TIMEOUT_MS: '45000',
  SQL_CURATOR_L3_COVERAGE_CHECK: 'true',
  SQL_CURATOR_LOG_LEVEL: 'info',
};

const DEFAULT_JIRA_WRITE_TOOLS = [
  'mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue',
  'mcp__claude_ai_Atlassian_Rovo__addWorklogToJiraIssue',
  'mcp__claude_ai_Atlassian_Rovo__transitionJiraIssue',
  'mcp__claude_ai_Atlassian_Rovo__editJiraIssue',
  'mcp__claude_ai_Atlassian_Rovo__createJiraIssue',
  'mcp__claude_ai_Atlassian_Rovo__createIssueLink',
];

const VALID_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

function parseIntInRange(name, raw, { min = 1, max = Number.MAX_SAFE_INTEGER }, errors) {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    errors.push(`${name}: expected integer, got "${raw}"`);
    return null;
  }
  if (value < min || value > max) {
    errors.push(`${name}: value ${value} outside allowed range [${min}, ${max}]`);
    return null;
  }
  return value;
}

function parseBool(raw) {
  return String(raw).toLowerCase() === 'true';
}

function loadConfig(env = process.env) {
  const errors = [];
  const read = (key) => (env[key] !== undefined && env[key] !== '' ? env[key] : DEFAULTS[key]);

  const port = parseIntInRange('BRIDGE_PORT', read('BRIDGE_PORT'), { min: 1, max: 65535 }, errors);
  const claudeMaxTurns = parseIntInRange('CLAUDE_MAX_TURNS', read('CLAUDE_MAX_TURNS'), { min: 1, max: 200 }, errors);
  const claudeTimeoutMs = parseIntInRange('CLAUDE_TIMEOUT_MS', read('CLAUDE_TIMEOUT_MS'), { min: 1000, max: 60 * 60 * 1000 }, errors);
  const maxHistoryMessages = parseIntInRange('MAX_HISTORY_MESSAGES', read('MAX_HISTORY_MESSAGES'), { min: 1, max: 500 }, errors);
  const maxConcurrent = parseIntInRange('CLAUDE_MAX_CONCURRENT', read('CLAUDE_MAX_CONCURRENT'), { min: 1, max: 32 }, errors);
  const maxRequestBodyBytes = parseIntInRange('SQL_CURATOR_MAX_REQUEST_BODY_BYTES', read('SQL_CURATOR_MAX_REQUEST_BODY_BYTES'), { min: 1024, max: 64 * 1024 * 1024 }, errors);
  const maxStreamBufferBytes = parseIntInRange('SQL_CURATOR_MAX_STREAM_BUFFER_BYTES', read('SQL_CURATOR_MAX_STREAM_BUFFER_BYTES'), { min: 64 * 1024, max: 256 * 1024 * 1024 }, errors);
  const jiraCompletionTimeoutMs = parseIntInRange('SQL_CURATOR_JIRA_COMPLETION_TIMEOUT_MS', read('SQL_CURATOR_JIRA_COMPLETION_TIMEOUT_MS'), { min: 5000, max: 30 * 60 * 1000 }, errors);
  const l3TimeoutMs = parseIntInRange('SQL_CURATOR_L3_TIMEOUT_MS', read('SQL_CURATOR_L3_TIMEOUT_MS'), { min: 5000, max: 10 * 60 * 1000 }, errors);

  const jiraWriteToolsRaw = (env.SQL_CURATOR_JIRA_WRITE_TOOLS || '').trim();
  const jiraWriteTools = jiraWriteToolsRaw
    ? jiraWriteToolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : DEFAULT_JIRA_WRITE_TOOLS;

  const logLevel = String(read('SQL_CURATOR_LOG_LEVEL')).toLowerCase();
  if (!VALID_LOG_LEVELS.has(logLevel)) {
    errors.push(`SQL_CURATOR_LOG_LEVEL: "${logLevel}" must be one of ${[...VALID_LOG_LEVELS].join(', ')}`);
  }

  if (errors.length > 0) {
    const lines = errors.map((e) => `  • ${e}`).join('\n');
    throw new Error(
      `claude-bridge configuration invalid (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}\n\n` +
      'Fix the environment variables above and restart. See .env.example for the complete list of supported keys.'
    );
  }

  const config = Object.freeze({
    port,
    claude: Object.freeze({
      maxTurns: claudeMaxTurns,
      timeoutMs: claudeTimeoutMs,
      maxConcurrent,
    }),
    server: Object.freeze({
      maxHistoryMessages,
      maxRequestBodyBytes,
      maxStreamBufferBytes,
    }),
    features: Object.freeze({
      offlineDryRunEnabled: parseBool(read('SQL_CURATOR_ENABLE_OFFLINE_DRY_RUN')),
      requireSqlChecksPass: parseBool(read('SQL_CURATOR_REQUIRE_DRYRUN_PASS')),
      jiraCompletionEnabled: parseBool(read('SQL_CURATOR_DEFER_JIRA_COMPLETION')),
      l3CoverageCheckEnabled: parseBool(read('SQL_CURATOR_L3_COVERAGE_CHECK')),
    }),
    timeouts: Object.freeze({
      jiraCompletionMs: jiraCompletionTimeoutMs,
      l3CoverageMs: l3TimeoutMs,
    }),
    jiraWriteTools: Object.freeze(jiraWriteTools),
    logLevel,
  });

  return config;
}

module.exports = { loadConfig, DEFAULTS, DEFAULT_JIRA_WRITE_TOOLS };
