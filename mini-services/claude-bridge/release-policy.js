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
};
