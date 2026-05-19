'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runStructuralChecks,
  parseStmRows,
  stripSqlLiteralsAndComments,
  extractFinalSelectColumns,
  extractSourceTables,
  extractTargetTable,
  parseDryRunOutputSchema,
  canonicalBqType,
  tablesMatch,
} = require('../structural-checks');

// ── parseStmRows ──────────────────────────────────────────────

test('parseStmRows returns normalised rows for a valid STM block', () => {
  const stm = JSON.stringify({
    rows: [
      { sourceField: 'id', sourceTable: 'customers', sourceType: 'integer',
        targetColumn: 'customer_id', targetTable: 'curated.dim_customer', targetType: 'int64' },
    ],
  });
  const rows = parseStmRows(stm);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, 'INTEGER');     // upper-cased
  assert.equal(rows[0].targetType, 'INT64');
  assert.equal(rows[0].targetColumn, 'customer_id');
});

test('parseStmRows returns null for invalid JSON', () => {
  assert.equal(parseStmRows('not json'), null);
  assert.equal(parseStmRows('{}'), null); // no rows array
  assert.equal(parseStmRows(null), null);
  assert.equal(parseStmRows(''), null);
});

// ── stripSqlLiteralsAndComments ───────────────────────────────

test('stripSqlLiteralsAndComments removes -- line comments', () => {
  const out = stripSqlLiteralsAndComments('SELECT a -- a comment\nFROM t');
  assert.match(out, /SELECT a/);
  assert.doesNotMatch(out, /a comment/);
});

test('stripSqlLiteralsAndComments removes /* block */ comments', () => {
  const out = stripSqlLiteralsAndComments('SELECT /* hide me */ a FROM t');
  assert.doesNotMatch(out, /hide me/);
});

test('stripSqlLiteralsAndComments collapses single-quoted strings', () => {
  const out = stripSqlLiteralsAndComments("SELECT 'foo bar' FROM t");
  assert.doesNotMatch(out, /foo bar/);
});

// ── extractFinalSelectColumns ─────────────────────────────────

test('extractFinalSelectColumns picks aliases of the outermost SELECT', () => {
  const sql = `
    WITH cte AS (SELECT id, name FROM customers)
    SELECT id AS customer_id, name AS customer_name FROM cte`;
  const cols = extractFinalSelectColumns(sql);
  assert.deepEqual(cols, ['customer_id', 'customer_name']);
});

test('extractFinalSelectColumns handles bare columns without AS', () => {
  const cols = extractFinalSelectColumns('SELECT id, name FROM t');
  assert.deepEqual(cols, ['id', 'name']);
});

test('extractFinalSelectColumns handles a single column with function call', () => {
  const cols = extractFinalSelectColumns('SELECT COUNT(*) AS total FROM t');
  assert.deepEqual(cols, ['total']);
});

test('extractFinalSelectColumns returns empty array for malformed SQL', () => {
  assert.deepEqual(extractFinalSelectColumns(''), []);
  assert.deepEqual(extractFinalSelectColumns('not a select'), []);
});

// ── extractSourceTables ───────────────────────────────────────

test('extractSourceTables finds FROM and JOIN tables, lowercases them', () => {
  const sql = 'SELECT * FROM Project.Dataset.Orders o JOIN customers c ON c.id = o.customer_id';
  const tables = extractSourceTables(sql);
  assert.ok(tables.includes('project.dataset.orders'));
  assert.ok(tables.includes('customers'));
});

test('extractSourceTables ignores backticks', () => {
  const sql = 'SELECT * FROM `proj.ds.table_a` JOIN `proj.ds.table_b` ON 1=1';
  const tables = extractSourceTables(sql);
  assert.ok(tables.includes('proj.ds.table_a'));
  assert.ok(tables.includes('proj.ds.table_b'));
});

// ── extractTargetTable ────────────────────────────────────────

test('extractTargetTable picks up CREATE TABLE', () => {
  assert.equal(
    extractTargetTable('CREATE TABLE proj.ds.target AS SELECT 1'),
    'proj.ds.target'
  );
});

test('extractTargetTable handles CREATE OR REPLACE VIEW', () => {
  assert.equal(
    extractTargetTable('CREATE OR REPLACE VIEW dataset.my_view AS SELECT 1'),
    'dataset.my_view'
  );
});

test('extractTargetTable handles MATERIALIZED VIEW', () => {
  assert.equal(
    extractTargetTable('CREATE MATERIALIZED VIEW mv AS SELECT 1'),
    'mv'
  );
});

test('extractTargetTable returns null for bare SELECT', () => {
  assert.equal(extractTargetTable('SELECT * FROM t'), null);
});

// ── tablesMatch ───────────────────────────────────────────────

test('tablesMatch is true for exact match', () => {
  assert.equal(tablesMatch('orders', 'orders'), true);
});

test('tablesMatch is true for tail match (qualified vs unqualified)', () => {
  assert.equal(tablesMatch('proj.ds.orders', 'orders'), true);
  assert.equal(tablesMatch('orders', 'proj.ds.orders'), true);
  assert.equal(tablesMatch('ds.orders', 'proj.ds.orders'), true);
});

test('tablesMatch is false for different last segments', () => {
  assert.equal(tablesMatch('proj.ds.orders', 'proj.ds.customers'), false);
});

test('tablesMatch is case-insensitive', () => {
  assert.equal(tablesMatch('Orders', 'orders'), true);
});

// ── canonicalBqType ───────────────────────────────────────────

test('canonicalBqType normalises numeric aliases', () => {
  assert.equal(canonicalBqType('INTEGER'), 'INT64');
  assert.equal(canonicalBqType('int'), 'INT64');
  assert.equal(canonicalBqType('FLOAT'), 'FLOAT64');
  assert.equal(canonicalBqType('Double'), 'FLOAT64');
});

test('canonicalBqType normalises BOOL alias', () => {
  assert.equal(canonicalBqType('bool'), 'BOOLEAN');
  assert.equal(canonicalBqType('BOOLEAN'), 'BOOLEAN');
});

test('canonicalBqType passes through unknown types', () => {
  assert.equal(canonicalBqType('STRING'), 'STRING');
  assert.equal(canonicalBqType('TIMESTAMP'), 'TIMESTAMP');
});

// ── parseDryRunOutputSchema ───────────────────────────────────

test('parseDryRunOutputSchema reads statistics.query.schema.fields', () => {
  const raw = JSON.stringify({
    statistics: { query: { schema: { fields: [
      { name: 'id', type: 'INT64' },
      { name: 'name', type: 'STRING' },
    ] } } },
  });
  const out = parseDryRunOutputSchema(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'id');
  assert.equal(out[0].type, 'INT64');
});

test('parseDryRunOutputSchema accepts already-parsed object', () => {
  const obj = { schema: { fields: [{ name: 'a', type: 'string' }] } };
  const out = parseDryRunOutputSchema(obj);
  assert.equal(out[0].type, 'STRING');
});

test('parseDryRunOutputSchema returns null when no recognisable shape', () => {
  assert.equal(parseDryRunOutputSchema('plain text'), null);
  assert.equal(parseDryRunOutputSchema(null), null);
  assert.equal(parseDryRunOutputSchema('{}'), null);
});

// ── runStructuralChecks: top-level pass scenario ──────────────

test('runStructuralChecks passes when SQL implements STM faithfully', () => {
  const stm = JSON.stringify({
    rows: [
      { targetColumn: 'customer_id', targetTable: 'proj.curated.dim_customer', targetType: 'INT64',
        sourceTable: 'proj.raw.customers', sourceField: 'id', sourceType: 'INT64' },
      { targetColumn: 'customer_name', targetTable: 'proj.curated.dim_customer', targetType: 'STRING',
        sourceTable: 'proj.raw.customers', sourceField: 'name', sourceType: 'STRING' },
    ],
  });
  const sql = `
    CREATE OR REPLACE TABLE proj.curated.dim_customer AS
    SELECT id AS customer_id, name AS customer_name
    FROM proj.raw.customers`;
  const verdict = runStructuralChecks(sql, stm, null);
  // No dry-run schema supplied → output_schema_vs_stm is not_run (warning),
  // but the three deterministic checks all pass.
  const colCheck = verdict.checks.find((c) => c.name === 'target_column_coverage');
  const tblCheck = verdict.checks.find((c) => c.name === 'source_table_coverage');
  const tgtCheck = verdict.checks.find((c) => c.name === 'target_table_match');
  assert.equal(colCheck.status, 'pass');
  assert.equal(tblCheck.status, 'pass');
  assert.equal(tgtCheck.status, 'pass');
  // Overall status is warning because schema check is not_run.
  assert.equal(verdict.status, 'warning');
});

test('runStructuralChecks fails when SQL is missing a declared target column', () => {
  const stm = JSON.stringify({
    rows: [
      { targetColumn: 'customer_id', targetTable: 't', targetType: 'INT64',
        sourceTable: 's', sourceField: 'id', sourceType: 'INT64' },
      { targetColumn: 'forgotten_col', targetTable: 't', targetType: 'STRING',
        sourceTable: 's', sourceField: 'x', sourceType: 'STRING' },
    ],
  });
  const sql = 'CREATE TABLE t AS SELECT id AS customer_id FROM s';
  const verdict = runStructuralChecks(sql, stm, null);
  const colCheck = verdict.checks.find((c) => c.name === 'target_column_coverage');
  assert.equal(colCheck.status, 'fail');
  assert.match(colCheck.detail, /forgotten_col/);
  assert.equal(verdict.status, 'fail');
});

test('runStructuralChecks fails when SQL references different source table than STM', () => {
  const stm = JSON.stringify({
    rows: [{ targetColumn: 'id', targetTable: 't', targetType: 'INT64',
             sourceTable: 'customers', sourceField: 'id', sourceType: 'INT64' }],
  });
  const sql = 'CREATE TABLE t AS SELECT id FROM unrelated_table';
  const verdict = runStructuralChecks(sql, stm, null);
  const tblCheck = verdict.checks.find((c) => c.name === 'source_table_coverage');
  assert.equal(tblCheck.status, 'fail');
  assert.match(tblCheck.detail, /customers/);
});

test('runStructuralChecks fails when SQL target object differs from STM', () => {
  const stm = JSON.stringify({
    rows: [{ targetColumn: 'id', targetTable: 'curated.dim_customer', targetType: 'INT64',
             sourceTable: 'raw.customers', sourceField: 'id', sourceType: 'INT64' }],
  });
  const sql = 'CREATE TABLE curated.wrong_table AS SELECT id FROM raw.customers';
  const verdict = runStructuralChecks(sql, stm, null);
  const tgtCheck = verdict.checks.find((c) => c.name === 'target_table_match');
  assert.equal(tgtCheck.status, 'fail');
});

test('runStructuralChecks fails when dry-run schema type mismatches STM', () => {
  const stm = JSON.stringify({
    rows: [{ targetColumn: 'customer_id', targetTable: 't', targetType: 'STRING',
             sourceTable: 's', sourceField: 'id', sourceType: 'INTEGER' }],
  });
  const sql = 'CREATE TABLE t AS SELECT id AS customer_id FROM s';
  const dryRunResult = JSON.stringify({
    statistics: { query: { schema: { fields: [{ name: 'customer_id', type: 'INT64' }] } } },
  });
  const verdict = runStructuralChecks(sql, stm, dryRunResult);
  const schemaCheck = verdict.checks.find((c) => c.name === 'output_schema_vs_stm');
  assert.equal(schemaCheck.status, 'fail');
  assert.match(schemaCheck.detail, /STRING.*INT64|INT64.*STRING/);
});

test('runStructuralChecks warns when STM is missing entirely', () => {
  const verdict = runStructuralChecks('SELECT 1', null, null);
  assert.equal(verdict.status, 'warning');
  assert.match(verdict.summary, /STM/);
});
