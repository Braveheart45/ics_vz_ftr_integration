'use client';

import { useState, useCallback } from 'react';
import {
  Copy,
  Check,
  Download,
  Pencil,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rocket,
  Code,
  FileCode2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/use-app-store';
import { toast } from 'sonner';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';

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

  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

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

  // ── Regenerate ───────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId, taskType }),
      });

      if (!res.ok) throw new Error('Generation failed');

      const data = await res.json();
      if (data.sql) {
        useAppStore.getState().setSqlOutput({
          sql: data.sql,
          isEdited: false,
          fileName: 'generated_sql.sql',
          generatedAt: new Date().toISOString(),
        });
        toast.success('Regenerated');
      }
    } catch {
      toast.error('Failed to regenerate');
    } finally {
      setIsRegenerating(false);
    }
  }, [messages, sessionId, taskType]);

  // ── Deploy ───────────────────────────────────────────────
  const handleDeploy = useCallback(() => {
    toast.success('Deployment initiated');
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
          'h-7 w-7 p-0 text-muted-foreground/70 hover:text-foreground',
          active && 'text-foreground'
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
    <div className="flex h-full flex-col overflow-hidden rounded-lg border">
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-2.5 py-1.5 shrink-0">
        {/* Left: File tab */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 rounded-md bg-background px-2 py-0.5 text-xs font-medium text-foreground/80 border">
            <FileCode2 className="size-3 text-muted-foreground/60" />
            <span className="truncate max-w-[160px]">{sqlOutput?.fileName || 'output.sql'}</span>
          </div>
          {sqlOutput?.isEdited && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground/70 border-muted-foreground/20"
            >
              Modified
            </Badge>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolBtn onClick={handleCopy} disabled={!sqlOutput} title="Copy">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
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

          <div className="mx-1 h-4 w-px bg-border" />

          <ToolBtn onClick={handleRegenerate} disabled={!sqlOutput || isRegenerating} title="Regenerate">
            <RefreshCw className={cn('size-3.5', isRegenerating && 'animate-spin')} />
          </ToolBtn>
          <ToolBtn onClick={handleDeploy} disabled={!sqlOutput} title="Deploy">
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
          <div className="flex h-full flex-col items-center justify-center text-center p-8">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
              <Code className="size-5 text-muted-foreground/50" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground/60">
              Generated SQL will appear here
            </p>
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
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
          onClick={toggleMaximize}
        />
        <div className="fixed inset-4 z-50">{editorContent}</div>
      </>
    );
  }

  return editorContent;
}
