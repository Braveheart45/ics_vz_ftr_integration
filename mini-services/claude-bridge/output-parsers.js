'use strict';

// ============================================================
// claude-bridge — extractors over Claude's final-text output
// ============================================================
// Pure parsers that work on the assembled assistant text. No I/O, no module
// state. Each extractor returns null / a fallback when its target block is
// missing so callers can degrade gracefully.
// ============================================================

/**
 * Extract the SQL artifact from Claude's text output. Accepts the standard
 * `sql` fence label plus a few BigQuery-flavoured aliases models occasionally
 * emit, with a heuristic fallback to a bare fence whose body looks SQL-shaped.
 * @param {string} content
 * @returns {string|null}
 */
function extractSql(content) {
  const labeled = String(content || '').match(/```(?:sql|bigquery|bq|googlesql)\s*\n([\s\S]*?)```/i);
  if (labeled) return labeled[1].trim();
  const bare = String(content || '').match(/```\s*\n([\s\S]*?)```/);
  if (bare) {
    const body = bare[1];
    if (/\b(SELECT|WITH|CREATE|INSERT|UPDATE|DELETE|MERGE)\b/i.test(body)) {
      return body.trim();
    }
  }
  return null;
}

/**
 * Extract the fenced STM JSON block and normalise it into the artifact shape
 * the UI consumes. `version` is supplied by the caller (sourced from the
 * session-scoped counter) so this stays pure.
 *
 * @param {string} content
 * @param {object} request
 * @param {number} version
 * @returns {object|null}
 */
function extractStm(content, request, version) {
  const match = String(content || '').match(/```stm\s*\n([\s\S]*?)```/i);
  if (!match) return null;

  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.rows)) return null;

  let source = 'text';
  if (request?.jiraInput?.project && request?.jiraInput?.storyNumber) source = 'jira';

  return {
    rows: parsed.rows.map((r) => ({
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
    bqProject: String(request?.bqProjectId || ''),
    bqDataset: String(request?.bqDatasetId || ''),
    generatedAt: new Date().toISOString(),
    version,
  };
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function isClarificationRequest(content) {
  return typeof content === 'string' && content.includes('[CLARIFY]');
}

/**
 * Extract a structured clarification payload from a [CLARIFY] response. Falls
 * back to a free-text shape when the fenced JSON block is absent or malformed
 * so the UI still sees something the user can act on.
 *
 * @param {string} content
 * @returns {{
 *   explanation?: string,
 *   message: string,
 *   details?: string,
 *   options?: string[],
 *   allowFreeText?: boolean,
 *   needsInput: true,
 * }}
 */
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

/**
 * Classify the failure mode for a run that ended without surfacing SQL. The
 * caller uses this to choose between the auto-retry path (missing_sql) and a
 * terminal-error path (claude_limit).
 *
 * @param {string} content
 * @returns {{ kind: 'claude_limit'|'missing_sql', message: string, hint: string }}
 */
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

module.exports = {
  extractSql,
  extractStm,
  isClarificationRequest,
  extractClarification,
  detectTerminalRunIssue,
};
