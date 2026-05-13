// ============================================================
// SQLForge — Shared SSE Client Utilities
// Used by input-section, sql-editor, and chat-panel.
// Single source of truth for SSE parsing + event dispatch.
// ============================================================

import type { WorkflowStage, StmRow } from '@/lib/types';

// ── SSE Event Types ─────────────────────────────────────────

export interface SSEStatusEvent { type: 'status'; stage: WorkflowStage; message: string }
export interface SSEToolCallEvent { type: 'tool_call'; tool: string; args: Record<string, unknown> }
export interface SSEToolResultEvent { type: 'tool_result'; tool: string; success: boolean; summary: string }
export interface SSEMessageEvent { type: 'message'; content: string }
export interface SSESQLEvent { type: 'sql'; sql: string; fileName: string }
export interface SSEErrorEvent { type: 'error'; message: string }
export interface SSEDoneEvent { type: 'done'; success?: boolean }
export interface SSEClarificationEvent { type: 'clarification'; message: string; needsInput: boolean }
export interface SSESStmEvent {
  type: 'stm';
  artifact: {
    rows: StmRow[];
    title: string;
    description: string;
    source: string;
    jiraRef?: string;
    bqProject: string;
    generatedAt: string;
    version: number;
  };
}

export type SSEEvent =
  | SSEStatusEvent
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSEMessageEvent
  | SSESQLEvent
  | SSEErrorEvent
  | SSEDoneEvent
  | SSEClarificationEvent
  | SSESStmEvent;

// ── SSE Event Dispatcher ────────────────────────────────────
// Dispatches a parsed SSE event to the Zustand store.

import { useAppStore } from '@/stores/use-app-store';

export function dispatchSSEEvent(event: SSEEvent): void {
  const store = useAppStore.getState();
  switch (event.type) {
    case 'status':
      store.setStage(event.stage, event.message);
      break;
    case 'tool_call':
      store.addToolLog({ tool: event.tool, args: event.args, status: 'running' });
      break;
    case 'tool_result':
      store.updateToolLog(event.tool, event.success ? 'success' : 'error', event.summary);
      break;
    case 'message':
      store.addMessage({ role: 'assistant', content: event.content });
      store.setStreaming(false);
      break;
    case 'sql':
      store.setSqlOutput({
        sql: event.sql,
        isEdited: false,
        fileName: event.fileName,
        generatedAt: new Date().toISOString(),
      });
      break;
    case 'error':
      store.addMessage({ role: 'assistant', content: `**Error:** ${event.message}` });
      store.setStreaming(false);
      store.setAgentRunning(false);
      store.setInteractionState('error');
      break;
    case 'clarification':
      store.setPendingClarification({ message: event.message, needsInput: event.needsInput });
      break;
    case 'stm':
      store.setStmArtifact(event.artifact);
      break;
    case 'done':
      store.setStreaming(false);
      store.setAgentRunning(false);
      if (event.success) store.setInteractionState('sql_generated');
      break;
  }
}

// ── SSE Stream Processor ────────────────────────────────────
// Reads an SSE stream from a POST fetch response and dispatches events.

export async function processSSEStream(
  res: Response,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = '';

    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6).trim();
      } else if (line === '' && currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData) as SSEEvent;
          parsed.type = currentEvent as SSEEvent['type'];
          dispatchSSEEvent(parsed);
        } catch {
          // Skip malformed events
        }
        currentEvent = '';
        currentData = '';
      } else if (line !== '') {
        // Incomplete line — put back in buffer
        buffer = line + '\n';
        break;
      }
    }
  }
}

// ── Convenience: POST + SSE stream ─────────────────────────

export async function postAndStream(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Stream failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res;
}
