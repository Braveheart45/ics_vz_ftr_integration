'use strict';

// ============================================================
// claude-bridge — request payload validation
// ============================================================
//
// Centralised, schema-driven validation for inbound HTTP request bodies.
// Each endpoint declares the field shape it expects; validateBody returns
// either { ok: true, value } with a normalised, type-safe object, or
// { ok: false, code, message, field } that the handler can return as a
// structured 400 response.
//
// Design choices:
//   • No external dependency (no zod / ajv) — the bridge stays slim and
//     ergonomic for ops to read.
//   • Validators check shape AND coerce: strings are trimmed, optional
//     fields fall back to undefined, arrays of objects are checked element
//     by element. The handler can rely on the returned `value` having the
//     declared types — no casting / coalescing at call sites.
//   • Errors include a field path and a stable code so frontends can show
//     useful feedback.
// ============================================================

const BQ_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BQ_DATASET_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const ALLOWED_TASK_TYPES = new Set(['sql_generation', 'github_deploy']);
const ALLOWED_MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);

function fail(code, message, field) {
  return { ok: false, code, message, field };
}

function isPlainString(v) {
  return typeof v === 'string';
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return fail('MESSAGES_NOT_ARRAY', 'messages must be an array of {role, content} objects', 'messages');
  }
  if (messages.length === 0) {
    return fail('MESSAGES_EMPTY', 'messages must contain at least one entry', 'messages');
  }
  if (messages.length > 200) {
    return fail('MESSAGES_TOO_MANY', `messages array exceeds 200 entries (got ${messages.length})`, 'messages');
  }
  const normalised = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') {
      return fail('MESSAGES_ELEMENT_INVALID', `messages[${i}] must be an object`, `messages[${i}]`);
    }
    const role = String(m.role || '').toLowerCase();
    if (!ALLOWED_MESSAGE_ROLES.has(role)) {
      return fail('MESSAGES_ROLE_INVALID', `messages[${i}].role must be one of ${[...ALLOWED_MESSAGE_ROLES].join(', ')}`, `messages[${i}].role`);
    }
    if (!isPlainString(m.content)) {
      return fail('MESSAGES_CONTENT_INVALID', `messages[${i}].content must be a string`, `messages[${i}].content`);
    }
    normalised.push({ role, content: m.content });
  }
  return { ok: true, value: normalised };
}

function validateBqProjectId(value) {
  if (value === undefined || value === null || value === '') {
    return fail('BQ_PROJECT_REQUIRED', 'BigQuery projectId is required', 'bqProjectId');
  }
  if (!isPlainString(value)) {
    return fail('BQ_PROJECT_TYPE', 'bqProjectId must be a string', 'bqProjectId');
  }
  const trimmed = value.trim();
  if (!BQ_PROJECT_ID_PATTERN.test(trimmed)) {
    return fail(
      'BQ_PROJECT_FORMAT',
      'bqProjectId must match BigQuery project ID rules (6–30 chars, lowercase letters, digits, hyphens; must start with a letter and end alphanumeric)',
      'bqProjectId'
    );
  }
  return { ok: true, value: trimmed };
}

function validateBqDatasetId(value) {
  if (value === undefined || value === null || value === '') {
    return fail('BQ_DATASET_REQUIRED', 'BigQuery datasetId is required', 'bqDatasetId');
  }
  if (!isPlainString(value)) {
    return fail('BQ_DATASET_TYPE', 'bqDatasetId must be a string', 'bqDatasetId');
  }
  const trimmed = value.trim();
  if (!BQ_DATASET_ID_PATTERN.test(trimmed)) {
    return fail(
      'BQ_DATASET_FORMAT',
      'bqDatasetId must start with a letter or underscore and contain only letters, digits, and underscores (max 1024 chars)',
      'bqDatasetId'
    );
  }
  return { ok: true, value: trimmed };
}

function validateSessionId(value) {
  if (!isPlainString(value)) {
    return fail('SESSION_ID_REQUIRED', 'sessionId is required and must be a string', 'sessionId');
  }
  const trimmed = value.trim();
  if (!SESSION_ID_PATTERN.test(trimmed)) {
    return fail(
      'SESSION_ID_FORMAT',
      'sessionId must be 4–128 characters of [A-Za-z0-9_-]',
      'sessionId'
    );
  }
  return { ok: true, value: trimmed };
}

function validateTaskType(value) {
  if (!isPlainString(value)) {
    return fail('TASK_TYPE_REQUIRED', 'taskType is required and must be a string', 'taskType');
  }
  if (!ALLOWED_TASK_TYPES.has(value)) {
    return fail(
      'TASK_TYPE_UNSUPPORTED',
      `taskType "${value}" is not supported. Allowed: ${[...ALLOWED_TASK_TYPES].join(', ')}`,
      'taskType'
    );
  }
  return { ok: true, value };
}

function validateOptionalJiraInput(value) {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'object') {
    return fail('JIRA_INPUT_TYPE', 'jiraInput must be an object', 'jiraInput');
  }
  const project = value.project !== undefined ? String(value.project).trim() : '';
  const storyNumber = value.storyNumber !== undefined ? String(value.storyNumber).trim() : '';
  // Both empty → omit. Partial supply (project without story or vice versa)
  // is suspicious but not fatal — surface for the operator without rejecting.
  if (!project && !storyNumber) return { ok: true, value: undefined };
  if (project && project.length > 64) {
    return fail('JIRA_PROJECT_TOO_LONG', 'jiraInput.project exceeds 64 characters', 'jiraInput.project');
  }
  if (storyNumber && storyNumber.length > 32) {
    return fail('JIRA_STORY_TOO_LONG', 'jiraInput.storyNumber exceeds 32 characters', 'jiraInput.storyNumber');
  }
  return { ok: true, value: { project, storyNumber } };
}

function validateOptionalContextText(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (!isPlainString(value)) {
    return fail('CONTEXT_TEXT_TYPE', 'contextText must be a string', 'contextText');
  }
  if (value.length > 200_000) {
    return fail('CONTEXT_TEXT_TOO_LARGE', `contextText length ${value.length} exceeds 200000 characters`, 'contextText');
  }
  return { ok: true, value };
}

function validateOptionalUploadedFiles(value) {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return fail('UPLOADED_FILES_TYPE', 'uploadedFiles must be an array', 'uploadedFiles');
  }
  if (value.length > 16) {
    return fail('UPLOADED_FILES_TOO_MANY', 'uploadedFiles may contain at most 16 entries', 'uploadedFiles');
  }
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const f = value[i];
    if (!f || typeof f !== 'object') {
      return fail('UPLOADED_FILE_INVALID', `uploadedFiles[${i}] must be an object`, `uploadedFiles[${i}]`);
    }
    const name = isPlainString(f.name) ? f.name.slice(0, 256) : 'unnamed';
    const content = isPlainString(f.content) ? f.content : '';
    if (content.length > 200_000) {
      return fail('UPLOADED_FILE_TOO_LARGE', `uploadedFiles[${i}].content exceeds 200000 characters`, `uploadedFiles[${i}].content`);
    }
    out.push({ name, content });
  }
  return { ok: true, value: out };
}

function validateOptionalBoolean(value, field) {
  if (value === undefined || value === null) return { ok: true, value: false };
  if (value === true || value === 'true') return { ok: true, value: true };
  if (value === false || value === 'false') return { ok: true, value: false };
  return fail('BOOLEAN_INVALID', `${field} must be a boolean`, field);
}

/**
 * Validate a POST /chat or /generate body. Returns the normalised payload
 * with the fields the rest of the bridge consumes.
 */
function validateChatBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'object') {
    return fail('BODY_NOT_OBJECT', 'Request body must be a JSON object', null);
  }

  const sessionId = validateSessionId(rawBody.sessionId);
  if (!sessionId.ok) return sessionId;

  const messages = validateMessages(rawBody.messages);
  if (!messages.ok) return messages;

  const taskType = validateTaskType(rawBody.taskType);
  if (!taskType.ok) return taskType;

  const bqProjectId = validateBqProjectId(rawBody.bqProjectId);
  if (!bqProjectId.ok) return bqProjectId;

  const bqDatasetId = validateBqDatasetId(rawBody.bqDatasetId);
  if (!bqDatasetId.ok) return bqDatasetId;

  const jiraInput = validateOptionalJiraInput(rawBody.jiraInput);
  if (!jiraInput.ok) return jiraInput;

  const contextText = validateOptionalContextText(rawBody.contextText);
  if (!contextText.ok) return contextText;

  const uploadedFiles = validateOptionalUploadedFiles(rawBody.uploadedFiles);
  if (!uploadedFiles.ok) return uploadedFiles;

  const dryRun = validateOptionalBoolean(rawBody.dryRun, 'dryRun');
  if (!dryRun.ok) return dryRun;

  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      messages: messages.value,
      taskType: taskType.value,
      bqProjectId: bqProjectId.value,
      bqDatasetId: bqDatasetId.value,
      jiraInput: jiraInput.value,
      contextText: contextText.value,
      uploadedFiles: uploadedFiles.value,
      dryRun: dryRun.value,
    },
  };
}

module.exports = {
  validateChatBody,
  validateBqProjectId,
  validateBqDatasetId,
  validateSessionId,
  validateTaskType,
};
