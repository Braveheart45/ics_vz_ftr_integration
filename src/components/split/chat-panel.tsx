'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Bot, User, Loader2, Wrench, CheckCircle2, AlertCircle, MessageCircleQuestion } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { formatDistanceToNow } from 'date-fns';
import type { WorkflowStage, StmRow } from '@/lib/types';

// ── SSE Event Types ─────────────────────────────────────────
interface SSEStatusEvent {
  type: 'status';
  stage: WorkflowStage;
  message: string;
}

interface SSEToolCallEvent {
  type: 'tool_call';
  tool: string;
  args: Record<string, unknown>;
}

interface SSEToolResultEvent {
  type: 'tool_result';
  tool: string;
  success: boolean;
  summary: string;
}

interface SSEMessageEvent {
  type: 'message';
  content: string;
}

interface SSESQLEvent {
  type: 'sql';
  sql: string;
  fileName: string;
}

interface SSEErrorEvent {
  type: 'error';
  message: string;
}

interface SSEDoneEvent {
  type: 'done';
  success?: boolean;
}

interface SSEClarificationEvent {
  type: 'clarification';
  message: string;
  needsInput: boolean;
}

interface SSESStmEvent {
  type: 'stm';
  artifact: { rows: StmRow[]; title: string; description: string; source: string; jiraRef?: string; bqProject: string; generatedAt: string; version: number };
}

type SSEEvent =
  | SSEStatusEvent
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSEMessageEvent
  | SSESQLEvent
  | SSEErrorEvent
  | SSEDoneEvent
  | SSEClarificationEvent
  | SSESStmEvent;

// ── Streaming dots animation ──────────────────────────────────
function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
    </span>
  );
}

// ── Tool Call Indicator ──────────────────────────────────────
function ToolCallItem({ tool, summary, status }: { tool: string; summary?: string; status: 'running' | 'success' | 'error' }) {
  const toolLabel: Record<string, string> = {
    fetch_jira_story: 'Fetching Jira Story',
    list_bq_datasets: 'Listing BQ Datasets',
    get_table_schema: 'Reading Table Schema',
    dry_run_sql: 'Validating SQL',
  };

  return (
    <div className="flex items-start gap-2 px-4 py-1 animate-fade-in">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted/80">
        {status === 'running' ? (
          <Wrench className="size-3 text-[#F97316] animate-spin" />
        ) : status === 'success' ? (
          <CheckCircle2 className="size-3 text-emerald-600" />
        ) : (
          <AlertCircle className="size-3 text-red-500" />
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[11px] font-semibold text-foreground/70">
          {toolLabel[tool] || tool}
        </span>
        {summary && (
          <span className="text-[10px] text-foreground/50 font-medium leading-snug">
            {summary}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────
function MessageBubble({
  role,
  content,
  timestamp,
}: {
  role: string;
  content: string;
  timestamp: string;
}) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1.5">
        <span className="text-[11px] text-muted-foreground/50 font-medium">{content}</span>
      </div>
    );
  }

  const timeStr = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

  return (
    <div className={cn('flex gap-2.5 px-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground shadow-[0_1px_2px_0_oklch(0.55_0.15_264/0.2)]'
            : 'bg-secondary text-muted-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.04)]'
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      {/* Bubble */}
      <div className="flex max-w-[82%] flex-col gap-0.5">
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed transition-colors',
            isUser
              ? 'rounded-tr-md bg-primary text-primary-foreground shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.15)]'
              : 'rounded-tl-md bg-secondary/80 text-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:font-normal prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        <span
          className={cn(
            'px-1 text-[10px] text-muted-foreground/35 font-medium',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {timeStr}
        </span>
      </div>
    </div>
  );
}

// ── SSE Stream Processor ─────────────────────────────────────
function useSSEStream() {
  const abortRef = useRef<AbortController | null>(null);

  const processStream = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      const abort = new AbortController();
      abortRef.current = abort;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Stream failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      const processEvent = (event: SSEEvent) => {
        switch (event.type) {
          case 'status':
            useAppStore.getState().setStage(event.stage, event.message);
            break;
          case 'tool_call':
            useAppStore.getState().addToolLog({
              tool: event.tool,
              args: event.args,
              status: 'running',
            });
            break;
          case 'tool_result':
            useAppStore.getState().updateToolLog(event.tool, event.success ? 'success' : 'error', event.summary);
            break;
          case 'message':
            useAppStore.getState().addMessage({ role: 'assistant', content: event.content });
            useAppStore.getState().setStreaming(false);
            break;
          case 'sql':
            useAppStore.getState().setSqlOutput({
              sql: event.sql,
              isEdited: false,
              fileName: event.fileName,
              generatedAt: new Date().toISOString(),
            });
            break;
          case 'error':
            useAppStore.getState().addMessage({
              role: 'assistant',
              content: `**Error:** ${event.message}`,
            });
            useAppStore.getState().setStreaming(false);
            useAppStore.getState().setAgentRunning(false);
            useAppStore.getState().setInteractionState('error');
            break;
          case 'clarification':
            useAppStore.getState().setPendingClarification({
              message: event.message,
              needsInput: event.needsInput,
            });
            break;
          case 'stm':
            useAppStore.getState().setStmArtifact(event.artifact);
            break;
          case 'done':
            useAppStore.getState().setStreaming(false);
            useAppStore.getState().setAgentRunning(false);
            if (event.success) {
              useAppStore.getState().setInteractionState('sql_generated');
            }
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
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
              processEvent(parsed);
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
    },
    []
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    useAppStore.getState().setStreaming(false);
    useAppStore.getState().setAgentRunning(false);
  }, []);

  return { processStream, abort };
}

// ── Chat Panel ────────────────────────────────────────────────
export function ChatPanel() {
  const messages = useAppStore((s) => s.messages);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const toolLogs = useAppStore((s) => s.toolLogs);
  const isAgentRunning = useAppStore((s) => s.isAgentRunning);
  const sessionId = useAppStore((s) => s.sessionId);
  const taskType = useAppStore((s) => s.taskType);
  const pendingClarification = useAppStore((s) => s.pendingClarification);
  const interactionState = useAppStore((s) => s.interactionState);
  const addMessage = useAppStore((s) => s.addMessage);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { processStream, abort } = useSSEStream();

  // Auto-scroll on new messages or tool updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolLogs, isStreaming]);

  const sendFollowUp = useCallback(async () => {
    const trimmed = followUp.trim();
    if (!trimmed || isSending || isAgentRunning) return;

    setFollowUp('');
    setIsSending(true);
    addMessage({ role: 'user', content: trimmed });

    // Clear any pending clarification since user is responding
    useAppStore.getState().setPendingClarification(null);

    useAppStore.getState().setStreaming(true);
    useAppStore.getState().setAgentRunning(true);
    useAppStore.getState().clearToolLogs();

    const chatHistory = useAppStore.getState().messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await processStream('/api/chat', {
        messages: chatHistory,
        sessionId,
        taskType,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to get response';
      addMessage({ role: 'assistant', content: `Error: ${msg}` });
    } finally {
      setIsSending(false);
    }
  }, [followUp, isSending, isAgentRunning, sessionId, taskType, addMessage, processStream]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFollowUp();
      }
    },
    [sendFollowUp]
  );

  const isAwaitingClarification = interactionState === 'awaiting_clarification' && pendingClarification;

  const hasMessages = messages.length > 0;
  const hasToolLogs = toolLogs.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        {!hasMessages && !isAgentRunning && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            {/* Decorative icon */}
            <div className="relative animate-float">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50 shadow-[0_2px_8px_0_oklch(0_0_0/0.04)] animate-breathe">
                <Bot className="size-6 text-foreground/40" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-background bg-secondary shadow-[0_1px_2px_0_oklch(0_0_0/0.06)]">
                <SparkleIcon className="size-2.5 text-[#F97316]/80" />
              </div>
            </div>

            <div className="animate-fade-in-up flex flex-col gap-1.5" style={{ animationDelay: '150ms' }}>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-foreground">
                SQLForge Assistant
              </h3>
              <p className="max-w-[260px] text-xs font-medium text-foreground/80 leading-relaxed">
                Provide requirements above or type a message to begin.
              </p>
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="flex flex-col gap-3.5 py-4">
            {messages.map((msg, i) => (
              <div key={msg.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}>
                <MessageBubble
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                />
              </div>
            ))}
          </div>
        )}

        {/* Clarification prompt — shows when Claude needs more info */}
        {isAwaitingClarification && (
          <div className="px-4 pb-2 animate-fade-in">
            <div className="rounded-xl border border-[#F97316]/20 bg-[#FFF7ED]/80 px-3.5 py-2.5 shadow-[0_1px_3px_0_oklch(0.65_0.2_45/0.08)]">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#F97316]/10">
                  <MessageCircleQuestion className="size-3 text-[#F97316]" />
                </div>
                <span className="text-[11px] font-bold text-[#F97316]/90 uppercase tracking-[0.05em]">
                  Claude needs more information
                </span>
              </div>
              <p className="text-xs font-medium text-foreground/70 leading-relaxed">
                Type your response in the input below to continue.
              </p>
            </div>
          </div>
        )}

        {/* Tool call progress */}
        {hasToolLogs && (
          <div className="flex flex-col gap-1.5 pb-2">
            {toolLogs.map((log) => (
              <ToolCallItem
                key={log.id}
                tool={log.tool}
                summary={log.summary}
                status={log.status}
              />
            ))}
          </div>
        )}

        {/* Streaming indicator */}
        {(isStreaming || isAgentRunning) && !hasToolLogs && (
          <div className="flex gap-2.5 px-4 py-2">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.04)]">
              <Bot className="size-3.5" />
            </div>
            <div className="rounded-2xl rounded-tl-md bg-secondary/80 px-4 py-3 shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] animate-fade-in">
              <StreamingDots />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border/40 bg-background/60 px-3 py-2.5 backdrop-blur-sm supports-[backdrop-filter]:bg-background/40">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isAwaitingClarification ? "Respond to Claude's question..." : "Follow up or clarify..."}
              className="min-h-[38px] max-h-[100px] resize-none text-sm leading-relaxed placeholder:text-foreground/50 pr-10"
              rows={1}
              aria-label="Follow-up message"
            />
          </div>
          <Button
            size="icon"
            onClick={sendFollowUp}
            disabled={!followUp.trim() || isSending || isAgentRunning}
            className="shrink-0 size-9 rounded-lg shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.15)] transition-all duration-200 hover:scale-110 hover:shadow-[0_2px_6px_0_oklch(0.55_0.15_264/0.25)] active:scale-95"
          >
            {isSending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sparkle icon (inline SVG for minimal dependency) ──────────
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 0L9.41 6.59L16 8L9.41 9.41L8 16L6.59 9.41L0 8L6.59 6.59L8 0Z" />
    </svg>
  );
}
