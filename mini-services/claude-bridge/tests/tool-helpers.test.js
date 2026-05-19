'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeJsonStringify,
  safeJsonParse,
  tryParseJson,
  pickStrings,
  clipForActivity,
  canonicaliseToolResultContent,
} = require('../tool-helpers');

test('safeJsonStringify handles cycles without throwing', () => {
  const a = {};
  a.self = a;
  const out = safeJsonStringify(a);
  assert.equal(typeof out, 'string');
});

test('tryParseJson returns null for non-JSON input', () => {
  assert.equal(tryParseJson('plain text'), null);
  assert.equal(tryParseJson(''), null);
  assert.equal(tryParseJson(null), null);
});

test('tryParseJson parses leading-brace JSON only', () => {
  assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParseJson('[1,2]'), [1, 2]);
});

test('safeJsonParse accepts already-parsed objects', () => {
  const obj = { a: 1 };
  assert.equal(safeJsonParse(obj), obj);
});

test('pickStrings handles plain strings and object property selection', () => {
  const out = pickStrings(['a', { id: 'b' }, { name: 'c' }, { other: 'skip' }], ['id', 'name']);
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('pickStrings respects limit', () => {
  const out = pickStrings(['a', 'b', 'c', 'd'], [], 2);
  assert.deepEqual(out, ['a', 'b']);
});

test('clipForActivity collapses whitespace and clips long strings', () => {
  const out = clipForActivity('  multi   line\n\nstring   ', 10);
  assert.equal(out, 'multi line…');
});

test('clipForActivity returns short strings unchanged', () => {
  assert.equal(clipForActivity('short'), 'short');
});

// ── canonicaliseToolResultContent ─────────────────────────────

test('canonicaliseToolResultContent accepts a raw JSON string', () => {
  const out = canonicaliseToolResultContent('{"is_error":false,"foo":"bar"}');
  assert.deepEqual(out.json, { is_error: false, foo: 'bar' });
  assert.match(out.text, /is_error/);
});

test('canonicaliseToolResultContent accepts a parsed object', () => {
  const obj = { schema: { fields: [] } };
  const out = canonicaliseToolResultContent(obj);
  assert.equal(out.json, obj);
});

test('canonicaliseToolResultContent flattens Anthropic content blocks', () => {
  const blocks = [
    { type: 'text', text: '{"is_error":' },
    { type: 'text', text: 'true}' },
  ];
  const out = canonicaliseToolResultContent(blocks);
  assert.deepEqual(out.json, { is_error: true });
});

test('canonicaliseToolResultContent returns text only for plain prose', () => {
  const out = canonicaliseToolResultContent('Query is valid. Estimated 1.2 GB.');
  assert.equal(out.json, null);
  assert.match(out.text, /Estimated/);
});

test('canonicaliseToolResultContent handles null safely', () => {
  const out = canonicaliseToolResultContent(null);
  assert.equal(out.json, null);
  assert.equal(out.text, '');
});
