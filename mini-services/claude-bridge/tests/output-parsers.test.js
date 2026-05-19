'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSql,
  extractStm,
  isClarificationRequest,
  extractClarification,
  detectTerminalRunIssue,
} = require('../output-parsers');

// ── extractSql ────────────────────────────────────────────────

test('extractSql reads a fenced ```sql block', () => {
  const out = extractSql('Some prose\n```sql\nSELECT 1\n```\nafter');
  assert.equal(out, 'SELECT 1');
});

test('extractSql accepts ```bigquery and ```googlesql aliases', () => {
  assert.equal(extractSql('```bigquery\nSELECT 1\n```'), 'SELECT 1');
  assert.equal(extractSql('```googlesql\nSELECT 1\n```'), 'SELECT 1');
});

test('extractSql falls back to bare fence when body is SQL-shaped', () => {
  const out = extractSql('```\nWITH a AS (SELECT 1) SELECT * FROM a\n```');
  assert.match(out, /^WITH/);
});

test('extractSql returns null when no SQL-shaped block present', () => {
  assert.equal(extractSql('no fences here'), null);
  assert.equal(extractSql('```\njust prose\n```'), null);
});

// ── extractStm ────────────────────────────────────────────────

test('extractStm parses the fenced ```stm block and applies version', () => {
  const content = '```stm\n' + JSON.stringify({
    rows: [{ targetColumn: 'id', targetTable: 't', sourceField: 'f', sourceTable: 's' }],
    title: 'My Map',
  }) + '\n```';
  const stm = extractStm(content, { bqProjectId: 'p', bqDatasetId: 'd' }, 7);
  assert.equal(stm.version, 7);
  assert.equal(stm.title, 'My Map');
  assert.equal(stm.rows[0].targetColumn, 'id');
  assert.equal(stm.bqProject, 'p');
});

test('extractStm tags Jira-sourced runs', () => {
  const content = '```stm\n' + JSON.stringify({ rows: [{}] }) + '\n```';
  const stm = extractStm(content, { jiraInput: { project: 'SCRUM', storyNumber: '21' } }, 1);
  assert.equal(stm.source, 'jira');
  assert.equal(stm.jiraRef, 'SCRUM-21');
});

test('extractStm returns null for missing or malformed block', () => {
  assert.equal(extractStm('no stm', {}, 1), null);
  assert.equal(extractStm('```stm\nnot json\n```', {}, 1), null);
  assert.equal(extractStm('```stm\n{"no_rows": true}\n```', {}, 1), null);
});

// ── isClarificationRequest ────────────────────────────────────

test('isClarificationRequest detects the [CLARIFY] sentinel', () => {
  assert.equal(isClarificationRequest('Some text [CLARIFY] more'), true);
  assert.equal(isClarificationRequest('plain'), false);
  assert.equal(isClarificationRequest(null), false);
});

// ── extractClarification ──────────────────────────────────────

test('extractClarification parses a structured clarification block', () => {
  const content = '[CLARIFY]\n```clarification\n' + JSON.stringify({
    explanation: 'Schema unclear',
    question: 'Which table holds usage data?',
    options: ['broadband_usage', 'usage_daily'],
    allowFreeText: true,
  }) + '\n```';
  const out = extractClarification(content);
  assert.equal(out.message, 'Which table holds usage data?');
  assert.deepEqual(out.options, ['broadband_usage', 'usage_daily']);
  assert.equal(out.allowFreeText, true);
  assert.equal(out.needsInput, true);
});

test('extractClarification falls back to free text when no fenced block', () => {
  const out = extractClarification('[CLARIFY] please confirm the target dataset');
  assert.equal(out.needsInput, true);
  assert.match(out.message, /confirm the target dataset/);
});

// ── detectTerminalRunIssue ────────────────────────────────────

test('detectTerminalRunIssue identifies claude_limit signals', () => {
  const out = detectTerminalRunIssue('We hit your limit; resets at 3pm');
  assert.equal(out.kind, 'claude_limit');
});

test('detectTerminalRunIssue defaults to missing_sql', () => {
  const out = detectTerminalRunIssue('Completed without SQL');
  assert.equal(out.kind, 'missing_sql');
});
