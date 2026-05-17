'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/use-app-store';
import { Database } from 'lucide-react';

// ── Component ─────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);
  const setBqProjectInput = useAppStore((s) => s.setBqProjectInput);

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Jira Project Key + Story Number */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Jira Project Key
          </Label>
          <Input
            placeholder="e.g. SCRUM"
            value={jiraInput.project}
            onChange={(e) => setJiraInput({ project: e.target.value.toUpperCase() })}
            className="h-9 rounded-lg border-border bg-background text-sm font-medium shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] transition-all duration-200 focus-visible:border-primary/30 focus-visible:shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.08)]"
            aria-label="Jira project key"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Story No.
          </Label>
          <Input
            placeholder="e.g. 16"
            value={jiraInput.storyNumber}
            onChange={(e) => setJiraInput({ storyNumber: e.target.value })}
            className="h-9 rounded-lg border-border bg-background text-sm font-medium shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] transition-all duration-200 focus-visible:border-primary/30 focus-visible:shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.08)]"
            aria-label="Jira story number"
          />
        </div>
      </div>

      {/* Row 2: BigQuery Project ID + Dataset ID */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <Database className="inline size-3 mr-1 text-[#4285F4]" />
            BQ Project ID
            <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <Input
            placeholder="Target project ID"
            value={bqProjectInput.projectId}
            onChange={(e) => setBqProjectInput({ projectId: e.target.value.trim() })}
            className="h-9 rounded-lg border-border bg-background text-sm font-medium shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] transition-all duration-200 focus-visible:border-primary/30 focus-visible:shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.08)]"
            aria-label="BigQuery project ID"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Dataset ID
            <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <Input
            placeholder="Target dataset ID"
            value={bqProjectInput.datasetId}
            onChange={(e) => setBqProjectInput({ datasetId: e.target.value.trim() })}
            className="h-9 rounded-lg border-border bg-background text-sm font-medium shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] transition-all duration-200 focus-visible:border-primary/30 focus-visible:shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.08)]"
            aria-label="BigQuery dataset ID"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
