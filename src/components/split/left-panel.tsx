'use client';

import { SqlEditor } from '@/components/split/sql-editor';
import { PipelineTracker } from '@/components/split/pipeline-tracker';
import { useAppStore } from '@/stores/use-app-store';

// ============================================================
// Left Panel — SQL Editor + Pipeline Tracker
// ============================================================

export function LeftPanel() {
  const isMaximized = useAppStore((s) => s.isMaximized);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* SQL Editor — takes remaining space */}
      <div className="flex-1 min-h-0 p-2.5">
        <SqlEditor />
      </div>

      {/* Pipeline Tracker — hidden when maximized */}
      {!isMaximized && (
        <div className="shrink-0 border-t border-border/40 bg-muted/20">
          <div className="h-[88px] overflow-hidden">
            <PipelineTracker />
          </div>
        </div>
      )}
    </div>
  );
}
