'use client';

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/use-app-store';
import { Download, Loader2 } from 'lucide-react';

// ── Component ─────────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);
  const setStage = useAppStore((s) => s.setStage);
  const addMessage = useAppStore((s) => s.addMessage);

  const [isFetching, setIsFetching] = useState(false);

  const handleFetch = useCallback(async () => {
    const { project, storyNumber } = jiraInput;
    if (!project.trim() || !storyNumber.trim()) return;

    setIsFetching(true);

    // Add system message
    addMessage({
      role: 'system',
      content: `Fetched Jira story ${storyNumber} from project ${project}. Analyzing requirements...`,
    });

    // Set stage to intake
    setStage('intake');

    // Simulate a delay and add a mock analysis response
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content:
          "I've analyzed **" + storyNumber + "** from the **" + project + "** project. Here's a summary of the requirements:\n\n" +
          "1. **Source**: The story describes a data pipeline from `" + project.toLowerCase() + "_raw` to `" + project.toLowerCase() + "_curated`\n" +
          "2. **Transformation**: Need to flatten nested JSON fields and apply business logic filters\n" +
          "3. **Target**: BigQuery table with partitioning on `event_date` and clustering on `customer_id`\n\n" +
          "A few clarifying questions before I proceed:\n" +
          "- What is the expected load frequency (daily/hourly/real-time)?\n" +
          "- Are there any downstream consumers I should consider for schema compatibility?\n" +
          "- Should I handle late-arriving data with a watermark?",
      });

      setIsFetching(false);
    }, 1200);
  }, [jiraInput, addMessage, setStage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isFetching) {
        handleFetch();
      }
    },
    [handleFetch, isFetching]
  );

  return (
    <div className="flex items-start gap-2">
      <Input
        placeholder="e.g., DATAENG"
        value={jiraInput.project}
        onChange={(e) => setJiraInput({ project: e.target.value })}
        onKeyDown={handleKeyDown}
        className="w-1/3 shrink-0 text-sm"
        aria-label="Jira project name"
      />
      <Input
        placeholder="e.g., DE-2847"
        value={jiraInput.storyNumber}
        onChange={(e) => setJiraInput({ storyNumber: e.target.value })}
        onKeyDown={handleKeyDown}
        className="flex-1 text-sm"
        aria-label="Jira story number"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={handleFetch}
        disabled={isFetching || !jiraInput.project.trim() || !jiraInput.storyNumber.trim()}
        className="shrink-0"
      >
        {isFetching ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        <span className="hidden sm:inline">Fetch</span>
      </Button>
    </div>
  );
}
