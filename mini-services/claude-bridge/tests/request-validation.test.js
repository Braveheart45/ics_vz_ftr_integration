'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateChatBody } = require('../request-validation');

function validBody(overrides = {}) {
  return {
    sessionId: 'session_abc123',
    messages: [{ role: 'user', content: 'top 3 customers' }],
    taskType: 'sql_generation',
    bqProjectId: 'my-bq-proj-1',
    bqDatasetId: 'curated',
    ...overrides,
  };
}

test('validateChatBody accepts a minimal valid payload', () => {
  const r = validateChatBody(validBody());
  assert.equal(r.ok, true);
  assert.equal(r.value.sessionId, 'session_abc123');
});

test('validateChatBody rejects non-object body', () => {
  const r = validateChatBody('not an object');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BODY_NOT_OBJECT');
});

test('validateChatBody rejects malformed sessionId', () => {
  const r = validateChatBody(validBody({ sessionId: 'has spaces' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SESSION_ID_FORMAT');
});

test('validateChatBody rejects empty messages array', () => {
  const r = validateChatBody(validBody({ messages: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MESSAGES_EMPTY');
});

test('validateChatBody rejects unknown taskType', () => {
  const r = validateChatBody(validBody({ taskType: 'legacy_sql_conversion' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TASK_TYPE_UNSUPPORTED');
});

test('validateChatBody rejects malformed BQ project id', () => {
  const r = validateChatBody(validBody({ bqProjectId: 'BAD UPPERCASE' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BQ_PROJECT_FORMAT');
});

test('validateChatBody accepts optional jiraInput', () => {
  const r = validateChatBody(validBody({ jiraInput: { project: 'SCRUM', storyNumber: '21' } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.jiraInput, { project: 'SCRUM', storyNumber: '21' });
});

test('validateChatBody drops empty jiraInput to undefined', () => {
  const r = validateChatBody(validBody({ jiraInput: { project: '', storyNumber: '' } }));
  assert.equal(r.ok, true);
  assert.equal(r.value.jiraInput, undefined);
});

test('validateChatBody rejects oversized contextText', () => {
  const r = validateChatBody(validBody({ contextText: 'x'.repeat(200_001) }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONTEXT_TEXT_TOO_LARGE');
});

test('validateChatBody rejects too many uploadedFiles', () => {
  const r = validateChatBody(validBody({
    uploadedFiles: Array.from({ length: 17 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' })),
  }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UPLOADED_FILES_TOO_MANY');
});

test('validateChatBody rejects malformed message role', () => {
  const r = validateChatBody(validBody({ messages: [{ role: 'robot', content: 'hi' }] }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MESSAGES_ROLE_INVALID');
});
