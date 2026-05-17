// ============================================================
// SQL Curator — SSE Helper + AgentRequest type
// SQL generation is handled exclusively by the Claude Code CLI
// bridge (mini-services/claude-bridge). This file provides the
// shared SSE streaming helper used by API routes and the type
// for the request payload forwarded to the bridge.
// ============================================================

import type { WorkflowStage } from '@/lib/types';

// ── SSE Helper ─────────────────────────────────────────────

export class SSEStream {
  private controller: ReadableStreamDefaultController;

  constructor(controller: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  send(event: string, data: unknown) {
    this.controller.enqueue(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    );
  }

  status(stage: WorkflowStage, message: string) {
    this.send('status', { stage, message, timestamp: Date.now() });
  }

  message(content: string) {
    this.send('message', { content });
  }

  sql(sql: string, fileName: string) {
    this.send('sql', { sql, fileName, timestamp: Date.now() });
  }

  done(success: boolean = true) {
    this.send('done', { timestamp: Date.now(), success });
  }

  error(message: string) {
    this.send('error', { message, timestamp: Date.now() });
  }
}

// ── Agent Request ──────────────────────────────────────────

export interface AgentRequest {
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  taskType: string;
  jiraInput?: { project: string; storyNumber: string };
  bqProjectId?: string;
  bqDatasetId?: string;
  contextText?: string;
  dryRun?: boolean | string;
}
