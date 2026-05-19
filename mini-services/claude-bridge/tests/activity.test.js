'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeActivityEvent,
  inferActivityType,
  inferActivityStage,
  normalizeActivityStatus,
  normalizeActivitySource,
  normalizeStringList,
} = require('../activity');

test('inferActivityType classifies error language', () => {
  assert.equal(inferActivityType('Dry run failed: column not found'), 'error');
});

test('inferActivityType classifies inference language', () => {
  assert.equal(inferActivityType('Inferred target table from acceptance criteria with 75% confidence'), 'inference');
});

test('inferActivityType defaults to observation', () => {
  assert.equal(inferActivityType('Fetched SCRUM-21 description'), 'observation');
});

test('inferActivityStage routes Jira/intake to analysis', () => {
  assert.equal(inferActivityStage('Fetched Jira story SCRUM-21'), 'analysis');
});

test('inferActivityStage routes schema/dataset to schema_resolution', () => {
  assert.equal(inferActivityStage('Inspected schema of orders table'), 'schema_resolution');
});

test('inferActivityStage routes STM/SQL to sql_generation', () => {
  assert.equal(inferActivityStage('Built STM with 5 rows'), 'sql_generation');
});

test('normalizeActivityStatus maps validation aliases', () => {
  assert.equal(normalizeActivityStatus('pass'), 'completed');
  assert.equal(normalizeActivityStatus('fail'), 'failed');
  assert.equal(normalizeActivityStatus('not_run'), 'pending');
  assert.equal(normalizeActivityStatus('active'), 'running');
});

test('normalizeActivitySource falls back to fallback for unknown', () => {
  assert.equal(normalizeActivitySource('claude'), 'claude');
  assert.equal(normalizeActivitySource('made-up'), 'fallback');
});

test('normalizeStringList trims, dedupes-by-empty, caps at 8', () => {
  const out = normalizeStringList(['  a  ', '', null, 'b', '1', '2', '3', '4', '5', '6', '7', '8']);
  assert.equal(out.length, 8);
  assert.equal(out[0], 'a');
});

test('makeActivityEvent canonicalises a free-form event', () => {
  const ev = makeActivityEvent({
    title: 'Found candidate table',
    summary: 'orders ranks highest among 3 candidates',
    type: 'inference',
    status: 'pass',
    source: 'bigquery',
    confidence: 85,
  });
  assert.equal(ev.type, 'inference');
  assert.equal(ev.status, 'completed');
  assert.equal(ev.source, 'bigquery');
  assert.equal(ev.confidence, 85);
  assert.equal(ev.stage, 'schema_resolution');
  assert.ok(ev.timestamp > 0);
});

test('makeActivityEvent rejects forbidden "tool" type and re-infers', () => {
  const ev = makeActivityEvent({
    title: 'Dry run failed',
    summary: 'column missing',
    type: 'tool',
  });
  assert.equal(ev.type, 'error');
});
