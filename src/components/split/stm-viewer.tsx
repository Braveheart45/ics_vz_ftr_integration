'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  Table2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { StmRow, StmArtifact } from '@/lib/types';

// ── Column Definitions ─────────────────────────────────────────

const STM_COLUMNS: { key: keyof StmRow; label: string; width: string }[] = [
  { key: 'sourceField', label: 'Source Field', width: 'w-[110px]' },
  { key: 'sourceTable', label: 'Source Table', width: 'w-[100px]' },
  { key: 'sourceType', label: 'Src Type', width: 'w-[80px]' },
  { key: 'targetColumn', label: 'Target Column', width: 'w-[110px]' },
  { key: 'targetTable', label: 'Target Table', width: 'w-[100px]' },
  { key: 'targetType', label: 'Tgt Type', width: 'w-[80px]' },
  { key: 'transformation', label: 'Transformation', width: 'w-[140px]' },
  { key: 'businessRule', label: 'Business Rule', width: 'w-[140px]' },
  { key: 'notes', label: 'Notes', width: 'w-[100px]' },
];

// ── CSV Export ─────────────────────────────────────────────────

function buildCsv(artifact: StmArtifact): string {
  const headers = STM_COLUMNS.map((c) => c.label);
  const rows = artifact.rows.map((r) => STM_COLUMNS.map((c) => r[c.key]));
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return lines.join('\n');
}

// ── Cell Renderer ─────────────────────────────────────────────

function StmCell({ value }: { value: string }) {
  if (!value) return <span className="text-muted-foreground/40 italic text-[10px]">—</span>;
  return (
    <span className="text-[10px] font-medium leading-tight text-foreground/85" title={value}>
      {value.length > 28 ? value.slice(0, 28) + '...' : value}
    </span>
  );
}

// ── STM Viewer Component ──────────────────────────────────────

export function StmViewer() {
  const stmArtifact = useAppStore((s) => s.stmArtifact);
  const sqlOutput = useAppStore((s) => s.sqlOutput);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // All hooks must be declared before any conditional returns
  const handleDownloadCsv = useCallback(() => {
    if (!stmArtifact) return;
    const csv = buildCsv(stmArtifact);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `STM_${stmArtifact.title.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('STM downloaded as CSV');
  }, [stmArtifact]);

  // No STM yet — show empty state
  if (!stmArtifact) {
    return (
      <div className="shrink-0 border-t border-border/40 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-5 rounded-md bg-muted/60">
            <Table2 className="size-3 text-muted-foreground/40" />
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-[0.08em]">
            Source-to-Target Mapping
          </span>
          {!sqlOutput && (
            <span className="text-[10px] font-medium text-muted-foreground/35 ml-auto">
              Generated after SQL
            </span>
          )}
        </div>
      </div>
    );
  }

  const rowCount = stmArtifact.rows.length;

  // ── Collapsed View ──────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div className="shrink-0 border-t border-border/40 bg-muted/20 px-3 py-2 animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-5 rounded-md bg-emerald-500/10">
            <Table2 className="size-3 text-emerald-600" />
          </div>
          <span className="text-[10px] font-bold text-foreground/70 uppercase tracking-[0.08em]">
            STM Ready
          </span>
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 font-semibold text-emerald-700 bg-emerald-50 border-emerald-200/50"
          >
            {rowCount} mappings
          </Badge>
          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadCsv}
              className="h-6 px-2 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1"
            >
              <Download className="size-3" />
              Download updated STM
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(false)}
              className="size-6 text-muted-foreground/50 hover:text-foreground/70"
            >
              <Eye className="size-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded View ───────────────────────────────────────────

  const displayRows = isExpanded ? stmArtifact.rows : stmArtifact.rows.slice(0, 3);

  return (
    <div className="shrink-0 border-t border-border/40 bg-muted/20 animate-fade-in">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
        <div className="flex items-center justify-center size-5 rounded-md bg-emerald-500/10">
          <Table2 className="size-3 text-emerald-600" />
        </div>
        <span className="text-[10px] font-bold text-foreground/70 uppercase tracking-[0.08em]">
          Source-to-Target Mapping
        </span>
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 font-semibold text-emerald-700 bg-emerald-50 border-emerald-200/50"
        >
          {rowCount} {rowCount === 1 ? 'mapping' : 'mappings'}
        </Badge>
        <span className="text-[9px] font-medium text-muted-foreground/40 hidden sm:inline truncate max-w-[200px]">
          {stmArtifact.title}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownloadCsv}
            className="h-6 px-2.5 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1.5 rounded-md shadow-[0_1px_2px_0_oklch(0.65_0.17_163/0.1)]"
          >
            <FileSpreadsheet className="size-3" />
            Download updated STM
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(true)}
            className="size-6 text-muted-foreground/50 hover:text-foreground/70"
            title="Collapse STM"
          >
            <EyeOff className="size-3" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className={cn(
        'overflow-x-auto custom-scrollbar transition-all duration-300',
        isExpanded ? 'max-h-[220px]' : 'max-h-[140px]'
      )}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/60 backdrop-blur-sm">
              {STM_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-[0.06em] text-foreground/50 whitespace-nowrap border-b border-border/40',
                    col.width
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-border/20 hover:bg-muted/30 transition-colors',
                  i % 2 === 0 ? 'bg-background/40' : 'bg-muted/10'
                )}
              >
                {STM_COLUMNS.map((col) => (
                  <td key={col.key} className={cn('px-2 py-1.5 whitespace-nowrap', col.width)}>
                    <StmCell value={String(row[col.key] ?? '')} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expand/Collapse toggle */}
      {rowCount > 3 && (
        <div className="border-t border-border/20 px-3 py-1 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-5 px-2 text-[9px] font-semibold text-muted-foreground/60 hover:text-foreground/70 gap-1"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-2.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="size-2.5" />
                Show all {rowCount} rows
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
