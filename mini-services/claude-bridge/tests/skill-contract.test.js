'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const skillsDir = path.join(repoRoot, 'skills');
// Collapse whitespace so prose assertions are tolerant of line wrapping in the
// markdown (a phrase may be split across two lines in the source).
const norm = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => norm(fs.readFileSync(path.join(skillsDir, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(skillsDir, rel));

const spine = read(path.join('sql-curator', 'SKILL.md'));
const confidenceGate = read(path.join('sql-curator', 'references', 'confidence-gate.md'));
const schemaRecon = read(path.join('sql-curator', 'references', 'schema-reconciliation.md'));
const bqIdioms = read(path.join('sql-curator', 'references', 'bigquery-idioms.md'));
const validator = read(path.join('validator', 'SKILL.md'));

test('skill layout: spine + references + validator exist; old monoliths are gone', () => {
  assert.ok(exists(path.join('sql-curator', 'SKILL.md')), 'spine missing');
  assert.ok(exists(path.join('sql-curator', 'references', 'confidence-gate.md')));
  assert.ok(exists(path.join('sql-curator', 'references', 'schema-reconciliation.md')));
  assert.ok(exists(path.join('sql-curator', 'references', 'bigquery-idioms.md')));
  assert.ok(exists(path.join('sql-curator', 'references', 'clarification.md')));
  assert.ok(exists(path.join('validator', 'SKILL.md')));
  assert.ok(exists(path.join('validator', 'references', 'inference-soundness.md')));
  assert.ok(!exists('generator.md'), 'old generator.md should be deleted');
  assert.ok(!exists('validator.md'), 'old flat validator.md should be deleted');
});

test('spine has skill frontmatter (name + description) for progressive disclosure', () => {
  assert.match(spine, /^---\s*name:\s*sql-curator\b/);
  assert.match(spine, /description:\s*\S/);
});

test('spine describes the strictly linear single-pass S01-S14 flow', () => {
  assert.match(spine, /strictly linear execution agent/i);
  assert.match(spine, /S11 Validation & Correction \(Neutral Validator Persona\)/);
  assert.match(spine, /S12 Dry-Run/);
  assert.match(spine, /S13 Jira Completion/);
  assert.match(spine, /S14 Ready/);
});

test('spine points at each reference rather than inlining the detail', () => {
  assert.match(spine, /references\/schema-reconciliation\.md/);
  assert.match(spine, /references\/confidence-gate\.md/);
  assert.match(spine, /references\/bigquery-idioms\.md/);
});

test('spine keeps the S01 zero-context hard block inline (control flow stays in the spine)', () => {
  assert.match(spine, /no free text, no files/i);
  assert.match(spine, /Do not proceed to S02\+ or schema reconciliation with zero business context/);
});

test('schema-reconciliation reference: no dataset listing + both rationale cards', () => {
  assert.doesNotMatch(schemaRecon, /list_dataset_ids/i);
  assert.match(schemaRecon, /Do not list datasets/i);
  assert.match(schemaRecon, /Candidate Source Tables Shortlisted/);
  assert.match(schemaRecon, /Source Table\(s\) Selected/);
});

test('bigquery-idioms reference mandates explicit AS alias matching the STM target column', () => {
  assert.match(bqIdioms, /Explicit `AS alias` on every SELECT expression/);
  assert.match(bqIdioms, /exactly match the `targetColumn`/);
});

test('confidence-gate reference states the two-tier policy and per-inference cards', () => {
  assert.match(confidenceGate, /Tier-1 gate/);
  assert.match(confidenceGate, /Tier-2 gate/);
  assert.match(confidenceGate, /One inference = one card/);
});

test('validator skill is the S11 persona with the three tasks and folds into validation block', () => {
  assert.match(validator, /S11 Validation & Correction step/);
  assert.match(validator, /Task 1 — Requirements Coverage/);
  assert.match(validator, /Task 2 — Inference Soundness/);
  assert.match(validator, /Task 3 — SQL ↔ STM Alignment/);
  assert.match(validator, /emit a standalone `verdict` block/);
  assert.match(validator, /fold .* into the run's `validation` block/i);
});

test('no skill file references the obsolete L1/L2/L3 layered model or follow-up pass', () => {
  for (const text of [spine, confidenceGate, schemaRecon, bqIdioms, validator]) {
    assert.doesNotMatch(text, /BRIDGE VALIDATION LAYERS/i);
    assert.doesNotMatch(text, /Deferred to bridge follow-up pass/i);
    assert.doesNotMatch(text, /cold (?:session|validator)/i);
  }
});
