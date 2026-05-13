'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Copy,
  Check,
  Download,
  Pencil,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rocket,
  FileCode2,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/use-app-store';
import { toast } from 'sonner';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { WorkflowStage, StmRow } from '@/lib/types';

// ── SSE Event Types ─────────────────────────────────────────
interface SSEStatusEvent { type: 'status'; stage: WorkflowStage; message: string }
interface SSEToolCallEvent { type: 'tool_call'; tool: string; args: Record<string, unknown> }
interface SSEToolResultEvent { type: 'tool_result'; tool: string; success: boolean; summary: string }
interface SSEMessageEvent { type: 'message'; content: string }
interface SSESQLEvent { type: 'sql'; sql: string; fileName: string }
interface SSEErrorEvent { type: 'error'; message: string }
interface SSEDoneEvent { type: 'done'; success?: boolean }
interface SSEClarificationEvent { type: 'clarification'; message: string; needsInput: boolean }
interface SSESStmEvent { type: 'stm'; artifact: { rows: StmRow[]; title: string; description: string; source: string; jiraRef?: string; bqProject: string; generatedAt: string; version: number } }

type SSEEvent = SSEStatusEvent | SSEToolCallEvent | SSEToolResultEvent | SSEMessageEvent | SSESQLEvent | SSEErrorEvent | SSEDoneEvent | SSEClarificationEvent | SSESStmEvent;

// ============================================================
// SQL Editor Component
// ============================================================

export function SqlEditor() {
  const sqlOutput = useAppStore((s) => s.sqlOutput);
  const isMaximized = useAppStore((s) => s.isMaximized);
  const toggleMaximize = useAppStore((s) => s.toggleMaximize);
  const updateSql = useAppStore((s) => s.updateSql);
  const messages = useAppStore((s) => s.messages);
  const sessionId = useAppStore((s) => s.sessionId);
  const taskType = useAppStore((s) => s.taskType);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);

  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Copy to Clipboard ────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!sqlOutput) return;
    try {
      await navigator.clipboard.writeText(sqlOutput.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied to clipboard');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = sqlOutput.sql;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied to clipboard');
    }
  }, [sqlOutput]);

  // ── Download as .sql file ────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!sqlOutput) return;
    const blob = new Blob([sqlOutput.sql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sqlOutput.fileName || 'generated_sql.sql';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Downloaded');
  }, [sqlOutput]);

  // ── Edit Toggle ──────────────────────────────────────────
  const handleEditToggle = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  // ── Regenerate (SSE streaming) ───────────────────────────
  const handleRegenerate = useCallback(async () => {
    setIsRegenerating(true);
    useAppStore.getState().setStreaming(true);
    useAppStore.getState().setAgentRunning(true);
    useAppStore.getState().clearToolLogs();

    const abort = new AbortController();
    abortRef.current = abort;

    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          sessionId,
          taskType,
          bqProjectId: bqProjectInput.projectId.trim() || undefined,
        }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
              handleRegenerateEvent(parsed);
            } catch { /* skip */ }
            currentEvent = '';
            currentData = '';
          } else if (line !== '') {
            buffer = line + '\n';
            break;
          }
        }
      }

      toast.success('Regenerated');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error('Failed to regenerate');
    } finally {
      setIsRegenerating(false);
      useAppStore.getState().setStreaming(false);
      useAppStore.getState().setAgentRunning(false);
      abortRef.current = null;
    }
  }, [messages, sessionId, taskType, bqProjectInput]);

  function handleRegenerateEvent(event: SSEEvent) {
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
        store.addMessage({ role: 'assistant', content: `Error regenerating: ${event.message}` });
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

  // ── Deploy (placeholder) ─────────────────────────────────
  const handleDeploy = useCallback(() => {
    toast.info('Deployment coming soon');
  }, []);

  // ── Edit SQL ─────────────────────────────────────────────
  const handleSqlChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateSql(e.target.value);
    },
    [updateSql]
  );

  // ── Toolbar button ───────────────────────────────────────
  function ToolBtn({
    onClick,
    disabled,
    title,
    children,
    active,
  }: {
    onClick: () => void;
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
    active?: boolean;
  }) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          'h-7 w-7 rounded-md text-muted-foreground/55 transition-all duration-200',
          'hover:bg-secondary/80 hover:text-foreground/80',
          'hover:scale-110 active:scale-95',
          active && 'bg-secondary text-foreground/90'
        )}
      >
        {children}
      </Button>
    );
  }

  // ============================================================
  // Render
  // ============================================================

  const editorContent = (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/40 px-3 py-1.5 shrink-0">
        {/* Left: File tab */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 rounded-md bg-background px-2.5 py-1 text-xs font-medium text-foreground/70 border border-border/50 shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
            <FileCode2 className="size-3 text-muted-foreground/50" />
            <span className="truncate max-w-[160px]">{sqlOutput?.fileName || 'output.sql'}</span>
          </div>
          {sqlOutput?.isEdited && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 font-medium text-amber-600/80 border-amber-300/40 bg-amber-50/50"
            >
              Modified
            </Badge>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolBtn onClick={handleCopy} disabled={!sqlOutput} title="Copy">
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          </ToolBtn>
          <ToolBtn onClick={handleDownload} disabled={!sqlOutput} title="Download">
            <Download className="size-3.5" />
          </ToolBtn>
          <ToolBtn onClick={handleEditToggle} disabled={!sqlOutput} title={isEditing ? 'View' : 'Edit'} active={isEditing}>
            <Pencil className="size-3.5" />
          </ToolBtn>
          <ToolBtn onClick={toggleMaximize} title={isMaximized ? 'Minimize' : 'Maximize'}>
            {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </ToolBtn>

          <div className="mx-1 h-3.5 w-px bg-border/50" />

          <ToolBtn onClick={handleRegenerate} disabled={!sqlOutput || isRegenerating} title="Regenerate">
            <RefreshCw className={cn('size-3.5', isRegenerating && 'animate-spin')} />
          </ToolBtn>
          <ToolBtn onClick={handleDeploy} disabled title="Deploy (coming soon)">
            <Rocket className="size-3.5" />
          </ToolBtn>
        </div>
      </div>

      {/* ── Code Area ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        {sqlOutput ? (
          isEditing ? (
            <Textarea
              value={sqlOutput.sql}
              onChange={handleSqlChange}
              className="h-full w-full min-h-full border-0 rounded-none resize-none p-4 font-mono text-sm leading-relaxed focus-visible:ring-0"
              style={{
                backgroundColor: '#282c34',
                color: '#abb2bf',
              }}
              spellCheck={false}
            />
          ) : (
            <SyntaxHighlighter
              language="sql"
              style={oneDark}
              showLineNumbers
              lineNumberStyle={{
                minWidth: '2.5em',
                paddingRight: '1em',
                color: '#636d83',
                userSelect: 'none',
              }}
              customStyle={{
                margin: 0,
                padding: '1rem',
                borderRadius: 0,
                fontSize: '0.8125rem',
                lineHeight: '1.625rem',
                background: '#282c34',
                height: '100%',
              }}
              wrapLongLines
            >
              {sqlOutput.sql}
            </SyntaxHighlighter>
          )
        ) : (
          /* ── Empty State ───────────────────────────────── */
          <div className="flex h-full flex-col items-center justify-center text-center p-8 bg-muted/20">
            <div className="relative animate-float">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/60 shadow-[0_2px_8px_0_oklch(0_0_0/0.03)] animate-breathe">
                <Terminal className="size-7 text-foreground/35" />
              </div>
              {/* Decorative orbiting dots */}
              <div className="absolute -top-1 -left-1 size-2 rounded-full bg-primary/20 animate-ping" />
              <div className="absolute -bottom-2 -right-2 size-1.5 rounded-full bg-[#F97316]/20 animate-ping" style={{ animationDelay: '1s' }} />
            </div>
            <div className="mt-4 animate-fade-in-up flex flex-col gap-1.5" style={{ animationDelay: '200ms' }}>
              <p className="text-sm font-semibold text-foreground">
                Generated SQL will appear here
              </p>
              <p className="text-xs font-medium text-foreground/70">
                Submit your requirements to get started
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Maximized overlay ────────────────────────────────────
  if (isMaximized) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={toggleMaximize}
        />
        <div className="fixed inset-4 z-50 rounded-xl overflow-hidden shadow-2xl">{editorContent}</div>
      </>
    );
  }

  return editorContent;
}
