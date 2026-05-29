'use strict';

// ============================================================
// claude-bridge — SQL release policy
// ============================================================
// Single-source validation: Claude's main pass runs S11 (validator persona),
// S12 (dry-run), and S13 (Jira) inline. The bridge consults the worst status
// across the validator + dry-run sub-sections to decide whether to attach a
// warning banner to the released SQL. The SQL itself surfaces whenever a
// fenced ```sql block was emitted — the user can always see what was produced
// even if validation flagged a problem.
// ============================================================

const ALLOWED = new Set(['pass', 'warning', 'fail', 'not_run']);

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  return ALLOWED.has(value) ? value : 'not_run';
}

/**
 * Normalise a single validation *section* status. Unlike `normalizeStatus`,
 * an unrecognised value defaults to `'warning'` (not `'not_run'`): a section
 * that reports an unknown status is suspect and should pull the run toward a
 * warning rather than silently disappearing.
 * @param {*} status
 * @returns {'pass'|'warning'|'fail'|'not_run'}
 */
function normalizeValidationStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ALLOWED.has(normalized) ? normalized : 'warning';
}

/**
 * Combine several validation-section statuses into one, worst-wins.
 * Precedence: fail > warning > not_run > pass. Empty input → 'not_run'.
 * @param {Array<*>} statuses
 * @returns {'pass'|'warning'|'fail'|'not_run'}
 */
function combineValidationStatuses(statuses) {
  const values = (statuses || []).map(normalizeValidationStatus).filter(Boolean);
  if (values.length === 0) return 'not_run';
  if (values.includes('fail')) return 'fail';
  if (values.includes('warning')) return 'warning';
  if (values.includes('not_run')) return 'not_run';
  return 'pass';
}

/**
 * Derive a DETERMINISTIC dry-run status from the raw BigQuery tool results the
 * bridge captured during the pass — independent of whatever Claude self-reports
 * in validation.sqlChecks.status. This is the bridge-owned signal that a
 * hallucinated or skipped dry-run cannot fake.
 *
 *   - no attempts captured       → 'not_run' (S12 was skipped — must warn)
 *   - last captured attempt errored → 'fail'
 *   - otherwise                   → 'pass'
 *
 * "Last attempt wins" because auto-fix retries converge on the final SQL; the
 * last execute_sql_readonly result reflects the SQL actually released.
 *
 * @param {Array<{isError?:boolean}>} dryRunAttempts
 * @returns {'pass'|'fail'|'not_run'}
 */
function deriveDryRunStatus(dryRunAttempts) {
  if (!Array.isArray(dryRunAttempts) || dryRunAttempts.length === 0) return 'not_run';
  const last = dryRunAttempts[dryRunAttempts.length - 1];
  return last && last.isError ? 'fail' : 'pass';
}

/**
 * @param {Object} input
 * @param {boolean} input.hasSqlBlock
 * @param {boolean} [input.isClarify]
 * @param {boolean} [input.isGithubDeploy]
 * @param {'pass'|'warning'|'fail'|'not_run'} [input.validationStatus]
 *   The worst status across validator + dry-run sub-sections. Computed by
 *   combineValidationStatuses([stmCompleteness, requirementCoverage, sqlChecks]).
 * @returns {{ surfacesSql:boolean, validationPassed:boolean, warning:(string|null) }}
 */
function decideSqlRelease({
  hasSqlBlock,
  isClarify = false,
  isGithubDeploy = false,
  validationStatus = 'not_run',
} = {}) {
  const surfacesSql = Boolean(hasSqlBlock && !isClarify && !isGithubDeploy);
  const status = normalizeStatus(validationStatus);
  const validationPassed = surfacesSql && status === 'pass';

  let warning = null;
  if (surfacesSql && !validationPassed) {
    const reasonMap = {
      warning: 'validator flagged warnings — review the validation summary before using it',
      fail: 'validator and/or dry-run reported a failure — review the SQL carefully before using it',
      not_run: 'validator + dry-run results are unavailable — review the SQL before using it',
    };
    warning = `SQL was generated, but ${reasonMap[status] || reasonMap.not_run}.`;
  }

  return {
    surfacesSql,
    validationPassed,
    warning,
  };
}

module.exports = {
  decideSqlRelease,
  normalizeStatus,
  normalizeValidationStatus,
  combineValidationStatuses,
  deriveDryRunStatus,
};
