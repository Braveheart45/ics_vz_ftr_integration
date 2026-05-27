'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Eye, EyeOff, Maximize2, Minimize2, Table2 } from 'lucide-react';
import { SqlEditor } from '@/components/split/sql-editor';
import { useAppStore } from '@/stores/use-app-store';
import { cn } from '@/lib/utils';
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

const PREVIEW_ROWS = 4;

function StmTableViewer() {
  const stmArtifact = useAppStore((s) => s.stmArtifact);
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isMaximized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMaximized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMaximized]);

  if (!stmArtifact) return null;

  const rows = showAll ? stmArtifact.rows : stmArtifact.rows.slice(0, PREVIEW_ROWS);
  const hasMore = stmArtifact.rows.length > PREVIEW_ROWS;

  const renderTable = (tableRows: StmRow[]) => (
    <table className="w-full min-w-[900px] text-[10.5px]">
      <thead>
        <tr className="bg-muted/40">
          {STM_COLUMNS.map((col) => (
            <th
              key={col.key}
              className="whitespace-nowrap border-b border-r border-border/30 px-2 py-1.5 text-left font-semibold text-muted-foreground last:border-r-0"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tableRows.map((row, idx) => (
          <tr
            key={idx}
            className={cn(
              'border-b border-border/20 hover:bg-muted/20 transition-colors',
              idx % 2 === 0 ? 'bg-background' : 'bg-muted/10',
            )}
          >
            {STM_COLUMNS.map((col) => (
              <td
                key={col.key}
                className="max-w-[180px] truncate border-r border-border/20 px-2 py-1.5 align-top font-medium text-foreground/75 last:border-r-0"
                title={String(row[col.key] || '')}
              >
                {String(row[col.key] || '-')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="shrink-0 border-t border-border/40 bg-background">
      {/* Header row */}
      <div className="flex h-9 items-center gap-2 overflow-hidden px-3">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Table2 className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className="text-[11px] font-semibold text-foreground/80 truncate">
            STM - {stmArtifact.title}
          </span>
          <span className="ml-1 shrink-0 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            {stmArtifact.rows.length} rows
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsVisible((v) => !v)}
          title={isVisible ? 'Hide table' : 'Show table'}
          className="flex size-6 shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {isVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setIsMaximized(true)}
          title="Maximize table"
          className="flex size-6 shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      {/* Table body */}
      {isExpanded && isVisible && (
        <div className="overflow-x-auto border-t border-border/30 custom-scrollbar">
          {renderTable(rows)}

          {hasMore && (
            <div className="flex items-center justify-center border-t border-border/20 py-1.5">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[10px] font-semibold text-primary/70 hover:text-primary transition-colors"
              >
                {showAll
                  ? 'Show fewer rows'
                  : `Show all ${stmArtifact.rows.length} rows`}
              </button>
            </div>
          )}
        </div>
      )}

      {isMaximized && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl">
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border/40 bg-muted/40 px-3">
            <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-[#4285F4] px-2.5 py-1 text-xs font-semibold text-white shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
              <Table2 className="size-3 text-white/80" />
              <span className="truncate">STM - {stmArtifact.title}</span>
              <span className="text-white/75">{stmArtifact.rows.length} rows</span>
            </div>
            <button
              type="button"
              onClick={() => setIsMaximized(false)}
              title="Restore (Esc)"
              className="flex size-6 shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Minimize2 className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
            {renderTable(stmArtifact.rows)}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function LeftPanel() {
  return (
    <div className="flex h-full flex-col bg-background relative">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent z-10" />

      <div className="flex-1 min-h-0 p-2.5">
        <SqlEditor />
      </div>

      <StmTableViewer />
    </div>
  );
}
