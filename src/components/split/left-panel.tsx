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
    <div className="flex flex-col h-full bg-background border-r">
      {/* SQL Editor — takes remaining space */}
      <div className="flex-1 min-h-0 p-2">
        <SqlEditor />
      </div>

      {/* Pipeline Tracker — hidden when maximized */}
      {!isMaximized && (
        <>
          <div className="border-t" />
          <div className="shrink-0 h-24 overflow-hidden">
            <PipelineTracker />
          </div>
        </>
      )}
    </div>
  );
}
