'use strict';

// ============================================================
// claude-bridge — Activity Feed event shaping
// ============================================================
// Every card the UI's Activity Feed shows is built via makeActivityEvent.
// The normalisers in this file map free-form Claude output and bridge events
// into the controlled vocabulary the UI expects.
//
// Pure — no side effects, no cross-module imports. Safe to unit-test.
// ============================================================

const ACTIVITY_TYPES = new Set(['observation', 'inference', 'decision', 'validation', 'error', 'artifact']);
const ACTIVITY_STATUSES = new Set(['running', 'completed', 'warning', 'failed', 'blocked', 'pending']);
const ACTIVITY_SOURCES = new Set(['claude', 'bridge', 'jira', 'bigquery', 'github', 'offline', 'fallback']);

/**
 * Best-effort classifier for free-form text into the controlled activity-type
 * vocabulary. Used when Claude omits a `type` field on a streamed activity
 * block or when the bridge synthesizes a card from a tool_result.
 * @param {string} text
 * @returns {string} one of ACTIVITY_TYPES
 */
function inferActivityType(text) {
  const value = String(text || '').toLowerCase();
  if (/error|failed|failure|limit|blocked|missing|not found|denied|unable/.test(value)) return 'error';
  if (/infer|assum|confidence|candidate|proposed|likely/.test(value)) return 'inference';
  if (/decision|selected|chosen|approved|load pattern|object type|partition|cluster/.test(value)) return 'decision';
  if (/validat|dry run|dry-run|dryrun|audit|check|coverage/.test(value)) return 'validation';
  if (/stm|sql|artifact|download|file/.test(value)) return 'artifact';
  return 'observation';
}

/**
 * Map a tool name, summary, or freeform text to one of the canonical pipeline
 * stages. Used to anchor cards to the correct stage on the matrix.
 * @param {string} message
 * @returns {string}
 */
function inferActivityStage(message) {
  const text = String(message || '').toLowerCase();
  if (/jira|story|requirement|acceptance|intake|analyz|analysis|s0[1-4]/.test(text)) return 'analysis';
  if (/schema|dataset|table|column|reconcil|candidate|bigquery|bq|s0[5-6]/.test(text)) return 'schema_resolution';
  if (/stm|mapping|source-to-target|logic model|generate|sql writer|s0[7-9]|s10/.test(text)) return 'sql_generation';
  if (/validat|dry run|dry-run|dryrun|self-audit|jira comment|transition|s1[1-2]/.test(text)) return 'validation';
  if (/ready|complete|sql_ready/.test(text)) return 'ready';
  return 'analysis';
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

/**
 * Canonicalise a free-form activity event payload into the shape the
 * frontend Activity Feed consumes. Fields are validated against allow-lists
 * and stringified safely so a malformed Claude event never breaks the UI.
 *
 * @param {object} [event]
 * @returns {{
 *   id: string|undefined,
 *   stage: string,
 *   type: string,
 *   status: string,
 *   title: string,
 *   summary: string,
 *   details: string[]|undefined,
 *   confidence: number|undefined,
 *   evidence: string[]|undefined,
 *   timestamp: number,
 *   source: string,
 * }}
 */
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

module.exports = {
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
};
