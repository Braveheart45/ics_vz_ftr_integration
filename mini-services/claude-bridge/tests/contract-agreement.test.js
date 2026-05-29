'use strict';

// Locks the agent↔bridge interface: the JSON-Schema contracts under contracts/
// must agree with what the bridge parser actually reads/normalizes. No runtime
// JSON-Schema validator is bundled — this test is the agreement guard.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const contractsDir = path.join(repoRoot, 'contracts');

const readSchema = (name) => JSON.parse(fs.readFileSync(path.join(contractsDir, name), 'utf8'));

const { extractStm } = require('../output-parsers');
const { ACTIVITY_TYPES, ACTIVITY_STATUSES, ACTIVITY_SOURCES } = require('../activity');

test('activity.schema.json enums equal activity.js enum sets', () => {
  const schema = readSchema('activity.schema.json');
  assert.deepEqual(
    new Set(schema.properties.type.enum),
    ACTIVITY_TYPES,
    'activity type enum drifted from ACTIVITY_TYPES',
  );
  assert.deepEqual(
    new Set(schema.properties.status.enum),
    ACTIVITY_STATUSES,
    'activity status enum drifted from ACTIVITY_STATUSES',
  );
  assert.deepEqual(
    new Set(schema.properties.source.enum),
    ACTIVITY_SOURCES,
    'activity source enum drifted from ACTIVITY_SOURCES',
  );
});

test('stm.schema.json row properties equal the keys extractStm() returns', () => {
  const schema = readSchema('stm.schema.json');
  const schemaRowProps = Object.keys(schema.definitions.stmRow.properties).sort();

  const sampleStm = JSON.stringify({
    title: 't',
    description: 'd',
    rows: [{
      sourceField: 'a', sourceTable: 'b', sourceType: 'STRING',
      targetColumn: 'c', targetTable: 'd', targetType: 'STRING',
      transformation: 'x', businessRule: 'y', notes: 'z',
    }],
  });
  const block = '```stm\n' + sampleStm + '\n```';
  const parsed = extractStm(block, {}, 1);
  const parserRowKeys = Object.keys(parsed.rows[0]).sort();

  assert.deepEqual(parserRowKeys, schemaRowProps, 'STM row shape drifted between parser and contract');
});

test('validation.schema.json declares exactly the sections the bridge consumes', () => {
  const schema = readSchema('validation.schema.json');
  const sectionProps = Object.keys(schema.properties).sort();
  const expected = [
    'activityDetails',
    'activityLog',
    'inferences',
    'jiraTransition',
    'requirementCoverage',
    'schemaReconciliation',
    'sqlChecks',
    'stmCompleteness',
  ];
  assert.deepEqual(sectionProps, expected, 'validation block sections drifted from the contract');
});

test('validation section status enum matches the release-policy allowed set', () => {
  const schema = readSchema('validation.schema.json');
  assert.deepEqual(
    new Set(schema.definitions.sectionStatus.enum),
    new Set(['pass', 'warning', 'fail', 'not_run']),
  );
});

test('inference object shape is claim + confidence + evidence', () => {
  const schema = readSchema('validation.schema.json');
  assert.deepEqual(
    Object.keys(schema.definitions.inference.properties).sort(),
    ['claim', 'confidence', 'evidence'],
  );
});
