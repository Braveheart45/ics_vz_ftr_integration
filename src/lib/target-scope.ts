import type { AgentRequest } from '@/lib/agent';

export const ALLOWED_TASK_TYPES = new Set([
  'sql_generation',
  'github_deploy',
]);

export const MAX_AGENT_REQUEST_BYTES = 1_500_000;

const BQ_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BQ_DATASET_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateBqProjectId(projectId: unknown): ValidationResult {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { ok: false, error: 'Target BigQuery Project ID is required' };
  }

  if (!BQ_PROJECT_ID_PATTERN.test(projectId.trim())) {
    return {
      ok: false,
      error: 'Target BigQuery Project ID must be a valid Google Cloud project ID',
    };
  }

  return { ok: true };
}

export function validateBqDatasetId(datasetId: unknown): ValidationResult {
  if (typeof datasetId !== 'string' || !datasetId.trim()) {
    return { ok: false, error: 'Target BigQuery Dataset ID is required' };
  }

  if (!BQ_DATASET_ID_PATTERN.test(datasetId.trim())) {
    return {
      ok: false,
      error: 'Target BigQuery Dataset ID must contain only letters, numbers, and underscores and cannot start with a number',
    };
  }

  return { ok: true };
}

export function validateAgentRequest(body: AgentRequest): ValidationResult {
  const byteLength = new TextEncoder().encode(JSON.stringify(body)).length;
  if (byteLength > MAX_AGENT_REQUEST_BYTES) {
    return {
      ok: false,
      error: `Request payload is too large. Maximum supported size is ${Math.floor(MAX_AGENT_REQUEST_BYTES / 1024)} KB.`,
    };
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: 'messages array is required' };
  }

  if (!body.messages.every((message) => typeof message?.role === 'string' && typeof message?.content === 'string')) {
    return { ok: false, error: 'messages must contain role and content strings' };
  }

  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }

  if (!body.taskType || typeof body.taskType !== 'string') {
    return { ok: false, error: 'taskType is required' };
  }

  if (!ALLOWED_TASK_TYPES.has(body.taskType)) {
    return { ok: false, error: 'Unsupported taskType' };
  }

  const projectValidation = validateBqProjectId(body.bqProjectId);
  if (!projectValidation.ok) return projectValidation;

  const datasetValidation = validateBqDatasetId(body.bqDatasetId);
  if (!datasetValidation.ok) return datasetValidation;

  return { ok: true };
}

export function validationErrorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
