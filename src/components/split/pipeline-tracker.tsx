'use client';

import {
  Inbox,
  Search,
  Database,
  Code,
  ShieldCheck,
  Rocket,
  Check,
  Loader2,
  Table2,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { useAppStore } from '@/stores/use-app-store';
import type { WorkflowStage, StmRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useCallback, useState } from 'react';

// ============================================================
// Stage Definitions — No 'idle' (pipeline only shows active stages)
// ============================================================

const STAGES: {
  id: WorkflowStage;
  label: string;
  shortLabel: string;
  icon: typeof Inbox;
}[] = [
  { id: 'intake', label: 'Intake', shortLabel: 'Intake', icon: Inbox },
  { id: 'analysis', label: 'Analysis', shortLabel: 'Analyze', icon: Search },
  { id: 'schema_resolution', label: 'Schema Resolution', shortLabel: 'Schema', icon: Database },
  { id: 'sql_generation', label: 'SQL Generation', shortLabel: 'Generate', icon: Code },
  { id: 'validation', label: 'Validation', shortLabel: 'Validate', icon: ShieldCheck },
  { id: 'ready', label: 'Ready to Deploy', shortLabel: 'Ready', icon: Rocket },
];

const STAGE_ORDER: WorkflowStage[] = STAGES.map((s) => s.id);

// ============================================================
// CSV Export Utility
// ============================================================

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

function buildCsv(artifact: { rows: StmRow[]; title: string }): string {
  const headers = STM_COLUMNS.map((c) => c.label);
  const rows = artifact.rows.map((r) => STM_COLUMNS.map((c) => r[c.key]));
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return lines.join('\n');
}

// ============================================================
// Component
// ============================================================

export function PipelineTracker() {
  const currentStage = useAppStore((s) => s.currentStage);
  const stageMessage = useAppStore((s) => s.stageMessage);
  const stmArtifact = useAppStore((s) => s.stmArtifact);
  const [showStmPopover, setShowStmPopover] = useState(false);

  // When idle, no stage is active — all appear as future
  const isIdle = currentStage === 'idle';
  const currentIdx = isIdle ? -1 : STAGE_ORDER.indexOf(currentStage);

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

  return (
    <div className="flex h-full flex-col justify-center gap-1 px-5">
      <div className="flex items-center w-full min-w-0">
        {/* Pipeline stages — takes remaining space */}
        <div className="flex items-center flex-1 min-w-0 stagger-children">
          {STAGES.map((stage, idx) => {
            const isCompleted = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            const Icon = stage.icon;

            return (
              <div key={stage.id} className="flex items-center animate-fade-in-up">
                {/* Stage indicator */}
                <div className="flex flex-col items-center gap-1.5 group cursor-default">
                  <div
                    className={cn(
                      'flex items-center justify-center size-7 rounded-full transition-all duration-300',
                      isCompleted
                        ? 'bg-[#F97316] text-white shadow-[0_1px_3px_0_oklch(0.65_0.2_45/0.3)] hover:scale-110'
                        : isCurrent
                          ? 'bg-[#4285F4] text-white shadow-[0_1px_3px_0_oklch(0.59_0.19_264/0.3)] animate-pulse-ring'
                          : isIdle
                            ? 'bg-muted text-foreground/30'
                            : 'bg-muted text-foreground/50 group-hover:bg-muted group-hover:text-foreground/70 transition-colors'
                    )}
                  >
                    {isCompleted ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : isCurrent ? (
                      <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[10px] leading-none font-bold tracking-[0.01em] whitespace-nowrap hidden md:block transition-colors duration-300',
                      isCompleted
                        ? 'text-foreground'
                        : isCurrent
                          ? 'text-foreground font-extrabold'
                          : isIdle
                            ? 'text-foreground/30'
                            : 'text-foreground/70 group-hover:text-foreground'
                    )}
                  >
                    {stage.shortLabel}
                  </span>
                </div>

                {/* Connector */}
                {idx < STAGES.length - 1 && (
                  <div className="flex items-center mx-0.5">
                    <div
                      className={cn(
                        'h-[2px] rounded-full transition-all duration-700',
                        'w-4 sm:w-10 lg:w-14',
                        isCompleted
                          ? 'bg-[#F97316]/50'
                          : isCurrent
                            ? 'animate-connector-pulse bg-[#4285F4]'
                            : isIdle
                              ? 'bg-border/40'
                              : 'bg-border'
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Vertical divider ── */}
        <div className="shrink-0 mx-3 h-8 w-px bg-border/50" />

        {/* ── STM Section (beside pipeline) ── */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          {stmArtifact ? (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownloadCsv}
                className="h-8 px-3 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1.5 rounded-lg shadow-[0_1px_3px_0_oklch(0.65_0.17_163/0.12)] border border-emerald-200/40 transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_2px_6px_0_oklch(0.65_0.17_163/0.18)]"
              >
                <FileSpreadsheet className="size-3.5" />
                <span>Download updated STM</span>
              </Button>
              <Badge
                variant="secondary"
                className="absolute -top-1.5 -right-1.5 text-[8px] px-1 py-0 font-bold text-white bg-emerald-500 border-0 min-w-[16px] text-center"
              >
                {stmArtifact.rows.length}
              </Badge>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-dashed border-border/60">
              <Table2 className="size-3 text-muted-foreground/35" />
              <span className="text-[10px] font-medium text-muted-foreground/40 whitespace-nowrap">
                STM pending
              </span>
            </div>
          )}
          {stmArtifact && (
            <span className="text-[9px] font-semibold text-emerald-600/60 hidden lg:block">
              {stmArtifact.rows.length} {stmArtifact.rows.length === 1 ? 'mapping' : 'mappings'} ready
            </span>
          )}
        </div>
      </div>

      {/* Stage message */}
      {stageMessage && !isIdle && (
        <div className="text-center animate-fade-in">
          <span className="text-[10px] font-semibold text-[#4285F4]/80 tracking-wide">
            {stageMessage}
          </span>
        </div>
      )}
    </div>
  );
}
