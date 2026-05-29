'use strict';

// ============================================================
// claude-bridge — deterministic STM ↔ SQL structural check
// ============================================================
// A bridge-side, LLM-free cross-check the close handler runs over the parsed
// SQL + STM. It is NOT a separate "layer" or cold session and has no UI card of
// its own — its verdict folds into the single release decision next to the
// deterministic dry-run signal (see release-policy.js / index.js close handler).
//
// The in-session validator persona (S11) owns judgment (inference soundness,
// requirements coverage); this module owns the two mechanical truths an LLM
// should never be trusted to re-derive by eye:
//
//   target_column_coverage — every STM targetColumn appears in the outermost SELECT
//   source_table_coverage  — every STM sourceTable appears in a FROM / JOIN
//
// The SQL parser is intentionally lightweight; full SQL parsing is not the goal.
// ============================================================

/**
 * Parse the raw STM JSON block into rows. Returns null on malformed input so the
 * caller surfaces a 'not_run' for the structural check.
 * @param {string|null} stmBlock
 * @returns {Array<{sourceTable:string, targetColumn:string}>|null}
 */
function parseStmRows(stmBlock) {
  if (!stmBlock) return null;
  try {
    const parsed = JSON.parse(stmBlock.trim());
    if (!parsed.rows || !Array.isArray(parsed.rows)) return null;
    return parsed.rows.map((r) => ({
      sourceTable: String(r.sourceTable || '').trim(),
      targetColumn: String(r.targetColumn || '').trim(),
    }));
  } catch {
    return null;
  }
}

/**
 * Strip SQL string literals and comments so table/column parsing is not fooled
 * by tokens inside comments or strings.
 * @param {string} sql
 * @returns {string}
 */
function stripSqlLiteralsAndComments(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

/**
 * Identify the output column aliases of the outermost SELECT — the columns the
 * query returns. Walks the SQL at depth 0 to find the last top-level SELECT…FROM
 * pair, splits the column segment on top-level commas, and extracts each
 * expression's trailing alias.
 * @param {string} sql
 * @returns {string[]}
 */
function extractFinalSelectColumns(sql) {
  const stripped = stripSqlLiteralsAndComments(sql);
  const upper = stripped.toUpperCase();
  let depth = 0;
  const selects = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && upper.startsWith('SELECT', i) && /\W/.test(stripped[i - 1] || ' ')) {
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

  return cols
    .map((expr) => {
      const m = expr.match(/(?:\bAS\s+)?([`"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/i);
      return m ? m[2] : null;
    })
    .filter(Boolean);
}

/**
 * @param {string} sql
 * @returns {string[]} lowercase table refs from every FROM / JOIN clause
 */
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

/**
 * Tail-match two qualified or unqualified table references. STM may declare
 * `customer_orders` while the SQL writes `project.dataset.customer_orders`.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
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

/**
 * Run the two deterministic STM↔SQL checks.
 * @param {string} sqlBlock
 * @param {string|null} stmBlock
 * @returns {{ status:'pass'|'warning'|'fail', summary:string, checks:Array<{name:string,status:string,detail:string}> }}
 */
function runStructuralChecks(sqlBlock, stmBlock) {
  const stmRows = parseStmRows(stmBlock);
  if (!stmRows || stmRows.length === 0) {
    return {
      status: 'warning',
      summary: 'STM block was missing or unparsable — structural check could not run.',
      checks: [{ name: 'stm_parse', status: 'warning', detail: 'STM JSON block required for the structural check.' }],
    };
  }

  const checks = [];

  // Check 1 — target column coverage
  const sqlOutputCols = extractFinalSelectColumns(sqlBlock).map((c) => c.toLowerCase());
  const stmTargetCols = stmRows.map((r) => r.targetColumn).filter(Boolean);
  const missingCols = stmTargetCols.filter((c) => c && !sqlOutputCols.includes(c.toLowerCase()));
  checks.push({
    name: 'target_column_coverage',
    status: missingCols.length === 0 ? 'pass' : 'fail',
    detail: missingCols.length === 0
      ? `All ${stmTargetCols.length} STM target column(s) appear as SELECT aliases.`
      : `Missing from SQL output (no matching AS alias): ${missingCols.join(', ')}.`,
  });

  // Check 2 — source table coverage
  const sqlTables = extractSourceTables(sqlBlock);
  const stmSourceTables = Array.from(new Set(stmRows.map((r) => r.sourceTable).filter(Boolean)));
  const missingTables = stmSourceTables.filter((st) => !sqlTables.some((qt) => tablesMatch(st, qt)));
  checks.push({
    name: 'source_table_coverage',
    status: missingTables.length === 0 ? 'pass' : 'fail',
    detail: missingTables.length === 0
      ? `All ${stmSourceTables.length} STM source table(s) referenced in FROM/JOIN.`
      : `Missing FROM/JOIN reference: ${missingTables.join(', ')}.`,
  });

  const anyFail = checks.some((c) => c.status === 'fail');
  const status = anyFail ? 'fail' : 'pass';
  const summary = anyFail
    ? 'SQL does not structurally match the STM. See check details.'
    : 'SQL structurally matches the STM (target columns + source tables).';

  return { status, summary, checks };
}

module.exports = {
  runStructuralChecks,
  // exported for unit tests
  parseStmRows,
  stripSqlLiteralsAndComments,
  extractFinalSelectColumns,
  extractSourceTables,
  tablesMatch,
};
