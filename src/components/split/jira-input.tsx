'use client';

import { Input } from '@/components/ui/input';
import { useAppStore } from '@/stores/use-app-store';

// ── Component ─────────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);

  return (
    <div className="flex items-center gap-0 rounded-lg border border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus-within:border-ring/40 focus-within:shadow-[0_1px_3px_0_oklch(0_22_0.012_60/0.08)] transition-all">
      <Input
        placeholder="Project"
        value={jiraInput.project}
        onChange={(e) => setJiraInput({ project: e.target.value })}
        className="h-9 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50 rounded-none first:rounded-l-lg"
        aria-label="Jira project name"
      />
      <div className="flex items-center px-1.5 text-muted-foreground/30">
        <span className="text-sm font-light">/</span>
      </div>
      <Input
        placeholder="Story number"
        value={jiraInput.storyNumber}
        onChange={(e) => setJiraInput({ storyNumber: e.target.value })}
        className="h-9 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50 rounded-none last:rounded-r-lg"
        aria-label="Jira story number"
      />
    </div>
  );
}
