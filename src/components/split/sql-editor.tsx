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
  FileCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/use-app-store';
import { toast } from 'sonner';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
      toast.success('SQL copied to clipboard');
    } catch {
      // Fallback for older browsers
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
      toast.success('SQL copied to clipboard');
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
    toast.success('SQL file downloaded');
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
        body: JSON.stringify({
          messages,
          sessionId,
          taskType,
        }),
      });

      if (!res.ok) {
        throw new Error('Generation failed');
      }

      const data = await res.json();
      if (data.sql) {
        useAppStore.getState().setSqlOutput({
          sql: data.sql,
          isEdited: false,
          fileName: 'generated_sql.sql',
          generatedAt: new Date().toISOString(),
        });
        toast.success('SQL regenerated successfully');
      }
    } catch {
      toast.error('Failed to regenerate SQL');
    } finally {
      setIsRegenerating(false);
    }
  }, [messages, sessionId, taskType]);

  // ── Deploy ───────────────────────────────────────────────
  const handleDeploy = useCallback(() => {
    toast.success('SQL deployment initiated');
  }, []);

  // ── Edit SQL ─────────────────────────────────────────────
  const handleSqlChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateSql(e.target.value);
    },
    [updateSql]
  );

  // ============================================================
  // Render
  // ============================================================

  const editorContent = (
    <div className="flex flex-col h-full bg-background rounded-lg border overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-muted/50 border-b px-3 py-2 shrink-0">
        {/* Left: File tab */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background border text-sm font-medium text-foreground">
            <FileCode className="size-3.5 text-blue-500" />
            <span className="truncate">{sqlOutput?.fileName || 'generated_sql.sql'}</span>
          </div>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            BigQuery SQL
          </Badge>
          {sqlOutput?.isEdited && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">
              Modified
            </Badge>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={!sqlOutput}
            title="Copy SQL"
            className="h-7 w-7 p-0"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={!sqlOutput}
            title="Download .sql"
            className="h-7 w-7 p-0"
          >
            <Download className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleEditToggle}
            disabled={!sqlOutput}
            title={isEditing ? 'View mode' : 'Edit mode'}
            className={`h-7 w-7 p-0 ${isEditing ? 'text-primary' : ''}`}
          >
            <Pencil className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMaximize}
            title={isMaximized ? 'Minimize' : 'Maximize'}
            className="h-7 w-7 p-0"
          >
            {isMaximized ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>

          <div className="w-px h-4 bg-border mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRegenerate}
            disabled={!sqlOutput || isRegenerating}
            title="Regenerate SQL"
            className="h-7 w-7 p-0"
          >
            <RefreshCw
              className={`size-3.5 ${isRegenerating ? 'animate-spin' : ''}`}
            />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeploy}
            disabled={!sqlOutput}
            title="Deploy SQL"
            className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
          >
            <Rocket className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Code Area ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
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
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="rounded-2xl border-2 border-dashed border-muted-foreground/20 p-10 flex flex-col items-center gap-3 max-w-sm">
              <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                <Code className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                Generated SQL will appear here
              </p>
              <p className="text-xs text-muted-foreground/70">
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
        {/* Dark backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={toggleMaximize}
        />
        {/* Maximized editor */}
        <div className="fixed inset-4 z-50">{editorContent}</div>
      </>
    );
  }

  return editorContent;
}
