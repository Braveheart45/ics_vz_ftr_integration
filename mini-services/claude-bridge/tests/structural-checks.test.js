'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runStructuralChecks,
  extractFinalSelectColumns,
  extractSourceTables,
  tablesMatch,
} = require('../structural-checks');

const STM = JSON.stringify({
  rows: [
    { sourceTable: 'project.ds.broadband_usage', targetColumn: 'customer_id' },
    { sourceTable: 'project.ds.broadband_usage', targetColumn: 'usage_month' },
    { sourceTable: 'project.ds.customers', targetColumn: 'total_usage_gb' },
  ],
});

test('extractFinalSelectColumns picks aliases of the outermost SELECT', () => {
  const sql = `CREATE VIEW v AS
    WITH src AS (SELECT a, b FROM t)
    SELECT customer_id, usage_month, total_usage_gb FROM src`;
  assert.deepEqual(extractFinalSelectColumns(sql), ['customer_id', 'usage_month', 'total_usage_gb']);
});

test('extractFinalSelectColumns reads explicit AS aliases on expressions', () => {
  const sql = 'SELECT a - b AS delta, SUM(x) AS total FROM t';
  assert.deepEqual(extractFinalSelectColumns(sql), ['delta', 'total']);
});

test('extractFinalSelectColumns returns the trailing identifier when no AS alias', () => {
  // a bare expression with no alias resolves to its last identifier, which will
  // NOT match the STM targetColumn — that is the failure the alias rule prevents
  const sql = 'SELECT actual_rate - predicted_rate FROM t';
  assert.deepEqual(extractFinalSelectColumns(sql), ['predicted_rate']);
});

test('extractSourceTables finds FROM and JOIN tables lowercased, ignoring backticks', () => {
  const sql = 'SELECT 1 FROM `project.ds.broadband_usage` u JOIN project.ds.customers c ON u.id = c.id';
  const tables = extractSourceTables(sql);
  assert.ok(tables.includes('project.ds.broadband_usage'));
  assert.ok(tables.includes('project.ds.customers'));
});

test('tablesMatch tail-matches qualified vs unqualified', () => {
  assert.equal(tablesMatch('broadband_usage', 'project.ds.broadband_usage'), true);
  assert.equal(tablesMatch('project.ds.customers', 'customers'), true);
  assert.equal(tablesMatch('orders', 'customers'), false);
});

test('runStructuralChecks passes when SQL implements the STM', () => {
  const sql = `CREATE VIEW v AS SELECT
      customer_id,
      usage_month,
      SAFE_DIVIDE(bytes, 1024) AS total_usage_gb
    FROM project.ds.broadband_usage
    JOIN project.ds.customers USING (customer_id)`;
  const verdict = runStructuralChecks(sql, STM);
  assert.equal(verdict.status, 'pass');
});

test('runStructuralChecks fails when a target column has no matching alias', () => {
  // total_usage_gb computed without AS alias → not in output → fail
  const sql = `SELECT customer_id, usage_month, SAFE_DIVIDE(bytes, 1024)
    FROM project.ds.broadband_usage JOIN project.ds.customers USING (customer_id)`;
  const verdict = runStructuralChecks(sql, STM);
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.checks.find((c) => c.name === 'target_column_coverage').detail, /total_usage_gb/);
});

test('runStructuralChecks fails when a STM source table is not referenced', () => {
  const sql = `SELECT customer_id, usage_month, x AS total_usage_gb FROM project.ds.broadband_usage`;
  const verdict = runStructuralChecks(sql, STM);
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.checks.find((c) => c.name === 'source_table_coverage').detail, /customers/);
});

test('runStructuralChecks warns when STM is missing/unparsable', () => {
  assert.equal(runStructuralChecks('SELECT 1', null).status, 'warning');
  assert.equal(runStructuralChecks('SELECT 1', '{not json}').status, 'warning');
});
