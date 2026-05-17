'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
  FileJson,
  FileSpreadsheet,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/stores/use-app-store';
import { toast } from 'sonner';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import { postAndStream, processSSEStream } from '@/lib/sse-client';
import { validateBqDatasetId, validateBqProjectId } from '@/lib/target-scope';
import type { StmRow } from '@/lib/types';

const STM_COLUMNS: { key: keyof StmRow; label: string }[] = [
  { key: 'sourceField', label: 'Source Field' },
  { key: 'sourceTable', label: 'Source Table' },
  { key: 'sourceType', label: 'Src Type' },
  { key: 'targetColumn', label: 'Target Column' },
  { key: 'targetTable', label: 'Target Table' },
  { key: 'targetType', label: 'Tgt Type' },
  { key: 'transformation', label: 'Transformation' },
  { key: 'businessRule', label: 'Business Rule' },
  { key: 'notes', label: 'Notes' },
];

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
  const jiraInput = useAppStore((s) => s.jiraInput);
  const contextText = useAppStore((s) => s.contextText);
  const stmArtifact = useAppStore((s) => s.stmArtifact);

  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [sqlFlash, setSqlFlash] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const buildStmCsv = useCallback((rows: StmRow[]) => {
    const headers = STM_COLUMNS.map((column) => column.label);
    const csvRows = rows.map((row) => STM_COLUMNS.map((column) => row[column.key]));
    return [headers, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }, []);

  // Auto-exit edit mode and flash when new SQL arrives (keyed on fileName which changes per generation)
  useEffect(() => {
    if (!sqlOutput?.fileName) return;
    setIsEditing(false);
    setSqlFlash(true);
    const t = setTimeout(() => setSqlFlash(false), 1200);
    return () => clearTimeout(t);
  }, [sqlOutput?.fileName]);

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

  const handleDownloadStmCsv = useCallback(() => {
    if (!stmArtifact) return;
    const blob = new Blob([buildStmCsv(stmArtifact.rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `STM_${stmArtifact.title.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('STM downloaded as CSV');
  }, [buildStmCsv, stmArtifact]);

  const handleDownloadStmJson = useCallback(() => {
    if (!stmArtifact) return;
    const blob = new Blob([JSON.stringify(stmArtifact, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `STM_${stmArtifact.title.replace(/\s+/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('STM downloaded as JSON');
  }, [stmArtifact]);

  // ── Edit Toggle ──────────────────────────────────────────
  const handleEditToggle = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  // ── Regenerate (SSE streaming) ───────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!bqProjectInput.projectId.trim()) {
      toast.error('Target BigQuery Project ID is required.');
      return;
    }

    const projectValidation = validateBqProjectId(bqProjectInput.projectId);
    if (!projectValidation.ok) {
      toast.error(projectValidation.error);
      return;
    }

    if (!bqProjectInput.datasetId.trim()) {
      toast.error('Target BigQuery Dataset ID is required.');
      return;
    }

    const datasetValidation = validateBqDatasetId(bqProjectInput.datasetId);
    if (!datasetValidation.ok) {
      toast.error(datasetValidation.error);
      return;
    }

    setIsRegenerating(true);
    useAppStore.getState().setStreaming(true);
    useAppStore.getState().setAgentRunning(true);
    useAppStore.getState().setStmArtifact(null);
    useAppStore.getState().setValidationSummary(null);
    useAppStore.getState().clearActivityEvents();
    useAppStore.getState().setPendingClarification(null);
    useAppStore.getState().clearClarificationHistory();

    const abort = new AbortController();
    abortRef.current = abort;

    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await postAndStream('/api/generate', {
        messages: chatHistory,
        sessionId,
        taskType,
        jiraInput: jiraInput.project.trim() ? jiraInput : undefined,
        bqProjectId: bqProjectInput.projectId.trim() || undefined,
        bqDatasetId: bqProjectInput.datasetId.trim() || undefined,
        contextText: contextText.trim() || undefined,
      }, abort.signal);

      await processSSEStream(res);

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
  }, [messages, sessionId, taskType, bqProjectInput, jiraInput, contextText]);

  const handleDeployToGitHub = useCallback(async () => {
    if (!sqlOutput) return;

    if (!bqProjectInput.projectId.trim()) {
      toast.error('Target BigQuery Project ID is required.');
      return;
    }

    const projectValidation = validateBqProjectId(bqProjectInput.projectId);
    if (!projectValidation.ok) {
      toast.error(projectValidation.error);
      return;
    }

    if (!bqProjectInput.datasetId.trim()) {
      toast.error('Target BigQuery Dataset ID is required.');
      return;
    }

    const datasetValidation = validateBqDatasetId(bqProjectInput.datasetId);
    if (!datasetValidation.ok) {
      toast.error(datasetValidation.error);
      return;
    }

    setIsDeploying(true);
    useAppStore.getState().setStreaming(true);
    useAppStore.getState().setAgentRunning(true);
    useAppStore.getState().setStage('validation', 'Asking Claude Code to prepare GitHub deployment...', 'active');

    const abort = new AbortController();
    abortRef.current = abort;

    const deployRequest = [
      '[GitHub Deployment Request]',
      'Use the enabled native GitHub MCP connector to push this generated SQL to GitHub.',
      'If repository, branch, file path, or PR/commit expectation is unclear, ask a focused clarification with options where possible.',
      '',
      `[Target BigQuery Project] ${bqProjectInput.projectId.trim()}`,
      `[Target BigQuery Dataset] ${bqProjectInput.datasetId.trim()}`,
      jiraInput.project && jiraInput.storyNumber ? `[Jira] ${jiraInput.project}-${jiraInput.storyNumber}` : '',
      '',
      `[SQL File Name] ${sqlOutput.fileName}`,
      '```sql',
      sqlOutput.sql,
      '```',
      stmArtifact ? '\n[STM Artifact]\n```json\n' + JSON.stringify(stmArtifact, null, 2) + '\n```' : '',
    ].filter(Boolean).join('\n');

    const chatHistory = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: deployRequest },
    ];

    try {
      const res = await postAndStream('/api/deploy', {
        messages: chatHistory,
        sessionId,
        taskType: 'github_deploy',
        bqProjectId: bqProjectInput.projectId.trim(),
        bqDatasetId: bqProjectInput.datasetId.trim(),
        contextText: deployRequest,
      }, abort.signal);

      await processSSEStream(res);
      toast.success('GitHub deployment request completed');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(error instanceof Error ? error.message : 'Failed to deploy through GitHub MCP');
      useAppStore.getState().setInteractionState('error');
    } finally {
      setIsDeploying(false);
      useAppStore.getState().setStreaming(false);
      useAppStore.getState().setAgentRunning(false);
      abortRef.current = null;
    }
  }, [messages, sessionId, bqProjectInput, jiraInput, sqlOutput, stmArtifact]);

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
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClick}
              disabled={disabled}
              aria-label={title}
              className={cn(
                'h-7 w-7 rounded-md text-muted-foreground/55 transition-all duration-200',
                'hover:bg-secondary/80 hover:text-foreground/80',
                'hover:scale-110 active:scale-95',
                active && 'bg-secondary text-foreground/90'
              )}
            >
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="text-xs">
          {title}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ============================================================
  // Render
  // ============================================================

  const editorContent = (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)] transition-all duration-500',
        sqlFlash
          ? 'border-[#4285F4]/60 shadow-[0_0_0_3px_oklch(0.59_0.19_264/0.12),0_2px_8px_0_oklch(0_0_0/0.04)]'
          : 'border-border/60'
      )}
    >
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 bg-muted/40 px-3">
        {/* Left: File tab */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 rounded-md bg-[#4285F4] px-2.5 py-1 text-xs font-medium text-white shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
            <FileCode2 className="size-3 text-white/70" />
            <span className="truncate max-w-[160px]">{sqlOutput?.fileName || 'Output.sql'}</span>
          </div>
          {sqlOutput?.isEdited && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 font-medium text-muted-foreground border-border/60 bg-background"
            >
              Modified
            </Badge>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolBtn onClick={handleCopy} disabled={!sqlOutput} title="Copy">
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
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
          <ToolBtn onClick={handleDeployToGitHub} disabled={!sqlOutput || isDeploying} title="Deploy to GitHub through Claude Code">
            <Rocket className={cn('size-3.5', isDeploying && 'animate-pulse')} />
          </ToolBtn>

          <ToolBtn onClick={handleDownloadStmCsv} disabled={!stmArtifact} title="Download STM CSV">
            <FileSpreadsheet className="size-3.5" />
          </ToolBtn>
          <ToolBtn onClick={handleDownloadStmJson} disabled={!stmArtifact} title="Download STM JSON">
            <FileJson className="size-3.5" />
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
          <div className="flex h-full flex-col items-center justify-center text-center p-8 bg-background">
            <div className="relative animate-float">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/60 shadow-[0_2px_8px_0_oklch(0_0_0/0.03)] animate-breathe">
                <Terminal className="size-7 text-foreground/35" />
              </div>
              {/* Decorative orbiting dots */}
              <div className="absolute -top-1 -left-1 size-2 rounded-full bg-primary/20 animate-ping" />
              <div className="absolute -bottom-2 -right-2 size-1.5 rounded-full bg-primary/15 animate-ping" style={{ animationDelay: '1s' }} />
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
