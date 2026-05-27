'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const generator = fs.readFileSync(path.join(repoRoot, 'skills', 'generator.md'), 'utf8');
const validator = fs.readFileSync(path.join(repoRoot, 'skills', 'validator.md'), 'utf8');

test('generator skill does not instruct Claude to list datasets', () => {
  assert.doesNotMatch(generator, /list_dataset_ids/i);
  assert.match(generator, /Do not list datasets/i);
  assert.match(generator, /target-dataset table\/schema calls/i);
});

test('generator skill describes a strictly linear single-pass flow with S11 validator persona, S12 dry-run, S13 Jira', () => {
  assert.match(generator, /strictly linear execution agent/i);
  assert.match(generator, /S11 Validation & Correction \(Neutral Validator Persona\)/);
  assert.match(generator, /S12 Dry-Run/);
  assert.match(generator, /S13 Jira Completion/);
  assert.match(generator, /S14 Ready/);
});

test('generator skill mandates explicit AS alias matching STM target column', () => {
  assert.match(generator, /Explicit `AS alias` on every SELECT expression/);
  assert.match(generator, /exactly match the `targetColumn`/);
});

test('generator skill blocks intake when Jira fails and no other context is available', () => {
  assert.match(generator, /If no other context exists/);
  assert.match(generator, /Do not proceed to S02, S05, or schema reconciliation with zero business context/);
});

test('generator skill no longer references the obsolete L1/L2/L3 bridge layers', () => {
  assert.doesNotMatch(generator, /BRIDGE VALIDATION LAYERS/i);
  assert.doesNotMatch(generator, /L1 — Executional/);
  assert.doesNotMatch(generator, /L2 — Structural/);
  assert.doesNotMatch(generator, /L3 — Comprehensive/);
  assert.doesNotMatch(generator, /Deferred to bridge follow-up pass/);
});

test('validator skill is a self-contained S11 persona with the three tasks', () => {
  assert.match(validator, /S11 Validation & Correction step/);
  assert.match(validator, /Task 1 — Requirements Coverage/);
  assert.match(validator, /Task 2 — Inference Soundness/);
  assert.match(validator, /Task 3 — SQL ↔ STM Alignment/);
  assert.match(validator, /correct the SQL accordingly/i);
});
