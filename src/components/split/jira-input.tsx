'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/stores/use-app-store';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// ── Component ─────────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);

  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="Project"
        value={jiraInput.project}
        onChange={(e) => setJiraInput({ project: e.target.value })}
        className="h-8 text-sm placeholder:text-muted-foreground/50"
        aria-label="Jira project name"
      />
      <span className="text-muted-foreground/40 text-sm">/</span>
      <Input
        placeholder="Story number"
        value={jiraInput.storyNumber}
        onChange={(e) => setJiraInput({ storyNumber: e.target.value })}
        className="h-8 text-sm placeholder:text-muted-foreground/50"
        aria-label="Jira story number"
      />
    </div>
  );
}
