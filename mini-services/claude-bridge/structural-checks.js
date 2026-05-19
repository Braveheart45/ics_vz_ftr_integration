'use strict';

// ============================================================
// claude-bridge — L2 structural validation (SQL ↔ STM)
// ============================================================
// Deterministic, LLM-free checks that compare the generated SQL against the
// declared STM. The bridge owns these verdicts. No interpretation. No bias.
//
//   Check 1 — target_column_coverage: every STM target column appears in
//             the SQL's outermost SELECT.
//   Check 2 — source_table_coverage:  every STM source table appears in a
//             FROM / JOIN clause.
//   Check 3 — target_table_match:     CREATE TABLE/VIEW target matches STM.
//   Check 4 — output_schema_vs_stm:   column count/names/types from the
//             BigQuery dry-run response match the STM target rows.
//
// The SQL parser is intentionally lightweight — full SQL parsing is not the
// goal. The checks are robust enough to catch the common ways a passes-
// dry-run query is still semantically wrong.
// ============================================================

const { canonicaliseToolResultContent } = require('./tool-helpers');

/**
 * Parse the raw STM JSON block into normalised rows (target column / source
 * table / type fields are upper-cased for type comparison). Returns null on
 * malformed input so the caller surfaces a `not_run` for L2.
 *
 * @param {string|null} stmBlock
 * @returns {Array<{sourceField:string, sourceTable:string, sourceType:string, targetColumn:string, targetTable:string, targetType:string}>|null}
 */
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

/**
 * Strip SQL string literals and comments so table/column parsing isn't
 * fooled by line-comment (--) or block-comment (slash-star...star-slash)
 * constructs that contain SQL-shaped tokens.
 * @param {string} sql
 * @returns {string}
 */
function stripSqlLiteralsAndComments(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ')              // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''") // single-quoted strings
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');// double-quoted identifiers
}

/**
 * Identify the column aliases of the outermost SELECT — the columns the
 * query actually returns to its caller. Walks the SQL at depth 0 to locate
 * the last top-level SELECT…FROM pair, then splits the column segment by
 * top-level commas and extracts each expression's trailing alias.
 *
 * @param {string} sql
 * @returns {string[]} list of output column names (alias or bare identifier)
 */
function extractFinalSelectColumns(sql) {
  const stripped = stripSqlLiteralsAndComments(sql);
  let depth = 0;
  const selects = [];
  const upper = stripped.toUpperCase();
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
 * Best-effort detection of the SQL's target object from a CREATE TABLE/VIEW
 * statement. Returns null when the SQL is a bare SELECT (caller falls back to
 * the request's mandatory project.dataset scope).
 * @param {string} sql
 * @returns {string|null}
 */
function extractTargetTable(sql) {
  const stripped = stripSqlLiteralsAndComments(sql).replace(/`/g, '');
  const m = stripped.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*){0,2})/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pull `statistics.query.schema.fields[]` (or its aliases) from a BigQuery
 * dry-run tool_result. Returns null when the MCP wrapper hides the schema.
 * @param {unknown} resultText
 * @returns {Array<{name:string,type:string}>|null}
 */
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

/**
 * Normalise BigQuery scalar type aliases. STM authors often write "INTEGER"
 * where BigQuery returns "INT64"; treat those as equivalent for L2.
 * @param {string} t
 * @returns {string}
 */
function canonicalBqType(t) {
  const v = String(t || '').toUpperCase();
  if (v === 'INTEGER' || v === 'INT') return 'INT64';
  if (v === 'FLOAT' || v === 'DOUBLE') return 'FLOAT64';
  if (v === 'BOOL') return 'BOOLEAN';
  return v;
}

/**
 * Tail-match two qualified or unqualified table references. STM may declare
 * `customer_orders` while the SQL writes `project.dataset.customer_orders`;
 * both count as a match.
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
 * Run all four L2 structural checks. Returns a verdict suitable for use as
 * `validationSummary.stmCompleteness`.
 *
 * @param {string} sqlBlock                  Final SQL extracted from Claude.
 * @param {string|null} stmBlock             Raw STM JSON (fenced block body).
 * @param {unknown} lastDryRunResultText     Last L1 tool_result content for
 *                                           output-schema extraction.
 * @returns {{
 *   status: 'pass'|'warning'|'fail',
 *   summary: string,
 *   checks: Array<{name:string,status:string,detail:string}>,
 * }}
 */
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

module.exports = {
  runStructuralChecks,
  // exported for unit tests
  parseStmRows,
  stripSqlLiteralsAndComments,
  extractFinalSelectColumns,
  extractSourceTables,
  extractTargetTable,
  parseDryRunOutputSchema,
  canonicalBqType,
  tablesMatch,
};
