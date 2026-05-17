'use client';

// ============================================================
// SQL Curator — Shared SSE Client Utilities
// Used by input-section, sql-editor, and chat-panel.
// Single source of truth for SSE parsing + event dispatch.
// ============================================================

import type { WorkflowStage, StmArtifact, StageStatus, ValidationSummary, AgentActivityEvent } from '@/lib/types';
import { validationSummaryToActivityEvents } from '@/lib/activity';

// ── SSE Event Types ─────────────────────────────────────────

export interface SSEStatusEvent        { type: 'status';          stage: WorkflowStage; message: string; status?: StageStatus }
export interface SSEMessageStartEvent  { type: 'message_start' }
export interface SSEMessageDeltaEvent  { type: 'message_delta';   content: string }
export interface SSEMessageEvent       { type: 'message';         content: string }
export interface SSESQLEvent           { type: 'sql';             sql: string; fileName: string }
export interface SSEErrorEvent         { type: 'error';           message: string; hint?: string }
export interface SSEDoneEvent          { type: 'done';            success?: boolean }
export interface SSEClarificationEvent {
  type: 'clarification';
  message: string;
  explanation?: string;
  details?: string;
  options?: string[];
  allowFreeText?: boolean;
  needsInput: boolean;
}
export interface SSESStmEvent          { type: 'stm';             artifact: StmArtifact }
export interface SSEValidationEvent    { type: 'validation_summary'; summary: ValidationSummary }
export interface SSEActivityEvent      { type: 'activity_event';  event: AgentActivityEvent }

export type SSEEvent =
  | SSEStatusEvent
  | SSEMessageStartEvent
  | SSEMessageDeltaEvent
  | SSEMessageEvent
  | SSESQLEvent
  | SSEErrorEvent
  | SSEDoneEvent
  | SSEClarificationEvent
  | SSESStmEvent
  | SSEValidationEvent
  | SSEActivityEvent;

// ── SSE Event Dispatcher ────────────────────────────────────
// Dispatches a parsed SSE event to the Zustand store.

import { useAppStore } from '@/stores/use-app-store';

export function dispatchSSEEvent(event: SSEEvent): void {
  const store = useAppStore.getState();

  switch (event.type) {
    case 'status':
      store.setStage(event.stage, event.message, event.status);
      break;

    case 'message_start':
      store.clearStreamingContent();
      break;

    case 'message_delta':
      store.appendStreamingContent(event.content);
      break;

    case 'message': {
      // Final complete message — update the streaming bubble if one exists,
      // otherwise add a fresh assistant message.
      const currentMsgs = useAppStore.getState().messages;
      const lastIdx = currentMsgs.reduceRight(
        (found: number, m, i) => (found === -1 && m.role === 'assistant' ? i : found),
        -1,
      );
      if (lastIdx !== -1) {
        store.updateLastAssistantMessage(event.content);
      } else {
        store.addMessage({ role: 'assistant', content: event.content });
      }
      store.setStreaming(false);
      break;
    }

    case 'sql':
      store.setSqlOutput({
        sql:         event.sql,
        isEdited:    false,
        fileName:    event.fileName,
        generatedAt: new Date().toISOString(),
      });
      break;

    case 'error':
      // If a streaming bubble was started, update it with the error text
      {
        const errMsgs = useAppStore.getState().messages;
        const lastErrIdx = errMsgs.reduceRight(
          (found: number, m, i) => (found === -1 && m.role === 'assistant' ? i : found),
          -1,
        );
        const errorContent = `**Error:** ${event.message}${event.hint ? `\n\n*${event.hint}*` : ''}`;
        if (lastErrIdx !== -1 && errMsgs[lastErrIdx].content === '') {
          store.updateLastAssistantMessage(errorContent);
        } else {
          store.addMessage({ role: 'assistant', content: errorContent });
        }
      }
      // Attribute the error to whatever stage was last reported by the
      // bridge — not hardcoded to 'validation'. Hardcoding fakes prior
      // stages as completed via the previousWorkflowStages cascade and
      // paints a red Validate cell for every error, including bridge
      // connection failures that never reached validation.
      {
        const liveStage = useAppStore.getState().currentStage;
        const errorStage = (liveStage === 'idle' || liveStage === 'ready')
          ? 'intake'
          : liveStage;
        store.setStage(errorStage, event.message, 'failed');
      }
      store.setStreaming(false);
      store.setAgentRunning(false);
      store.setInteractionState('error');
      break;

    case 'clarification':
      store.clearStreamingContent();
      store.setPendingClarification({
        message: event.message,
        explanation: event.explanation,
        details: event.details,
        options: event.options,
        allowFreeText: event.allowFreeText,
        needsInput: event.needsInput,
      });
      break;

    case 'stm':
      store.setStmArtifact(event.artifact);
      break;

    case 'validation_summary':
      store.setValidationSummary(event.summary);
      store.addActivityEvents(validationSummaryToActivityEvents(event.summary));
      break;

    case 'activity_event':
      store.addActivityEvent(event.event);
      break;

    case 'done':
      store.setStreaming(false);
      store.setAgentRunning(false);
      if (event.success && store.interactionState !== 'awaiting_clarification') {
        store.setInteractionState('sql_generated');
      }
      break;
  }
}

// ── SSE Stream Processor ────────────────────────────────────
// Reads an SSE stream from a POST fetch response and dispatches events.

export async function processSSEStream(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData  = '';
  let sawDone = false;

  const flushCurrentEvent = () => {
    if (!currentEvent || !currentData) return;

    try {
      const parsed = JSON.parse(currentData) as SSEEvent;
      parsed.type  = currentEvent as SSEEvent['type'];
      dispatchSSEEvent(parsed);
      if (currentEvent === 'done') sawDone = true;
    } catch (error) {
      console.warn('[SQL Curator SSE] Skipped malformed event:', error);
    } finally {
      currentEvent = '';
      currentData  = '';
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const data = line.slice(5);
      const normalizedData = data.startsWith(' ') ? data.slice(1) : data;
      currentData += `${currentData ? '\n' : ''}${normalizedData}`;
    } else if (line === '') {
      flushCurrentEvent();
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep only the last (possibly incomplete) line in the buffer
      buffer = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        processLine(lines[i]);
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      buffer.split('\n').forEach(processLine);
      buffer = '';
    }
    flushCurrentEvent();
  } finally {
    // Ensure agent state is reset even if the stream ends abruptly.
    const store = useAppStore.getState();
    if (store.isAgentRunning || store.isStreaming) {
      store.setStreaming(false);
      store.setAgentRunning(false);
      if (!sawDone && store.interactionState === 'processing') {
        store.setInteractionState('error');
        store.addMessage({
          role: 'assistant',
          content: 'Error: Claude stream ended before SQL Curator received a completion event. Please retry the run.',
        });
      }
    }
  }
}

// ── Convenience: POST + SSE stream ─────────────────────────

export async function postAndStream(
  url:    string,
  body:   Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Stream failed' })) as Record<string, string>;
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res;
}
