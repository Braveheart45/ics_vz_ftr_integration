'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/use-app-store';
import { JiraInput } from './jira-input';
import { FileUpload } from './file-upload';
import { ContextInput } from './context-input';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ── Component ─────────────────────────────────────────────────
export function InputSection() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const contextText = useAppStore((s) => s.contextText);
  const uploadedFiles = useAppStore((s) => s.uploadedFiles);
  const addMessage = useAppStore((s) => s.addMessage);
  const setStage = useAppStore((s) => s.setStage);
  const taskType = useAppStore((s) => s.taskType);
  const sessionId = useAppStore((s) => s.sessionId);
  const messages = useAppStore((s) => s.messages);

  const buildUserMessage = useCallback((): string | null => {
    const parts: string[] = [];

    if (jiraInput.project.trim() && jiraInput.storyNumber.trim()) {
      parts.push(
        `[Jira] Project: ${jiraInput.project}, Story: ${jiraInput.storyNumber}`
      );
    }

    if (contextText.trim()) {
      parts.push(contextText.trim());
    }

    if (uploadedFiles.length > 0) {
      const fileNames = uploadedFiles.map((f) => f.name).join(', ');
      parts.push(`[Attached files: ${fileNames}]`);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }, [jiraInput, contextText, uploadedFiles]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const userContent = buildUserMessage();
    if (!userContent) {
      toast.error('Please provide some input before submitting.');
      return;
    }

    setIsSubmitting(true);
    setStage('intake');
    addMessage({ role: 'user', content: userContent });

    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    chatHistory.push({ role: 'user', content: userContent });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          sessionId,
          taskType,
          jiraInput: jiraInput.project.trim() ? jiraInput : undefined,
          contextText: contextText.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to get AI response');
      }

      const data = await res.json();
      addMessage({ role: 'assistant', content: data.content });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Something went wrong';
      addMessage({
        role: 'assistant',
        content: `Error: ${errorMessage}. Please try again.`,
      });
      toast.error('Failed to submit. Check the chat for details.');
    } finally {
      setIsSubmitting(false);
    }
  }, [buildUserMessage, messages, sessionId, taskType, jiraInput, contextText, addMessage, setStage]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
      {/* Jira Story (optional) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Jira Story
          <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground/60">
            optional
          </span>
        </Label>
        <JiraInput />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-[0.1em]">
          or
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      {/* File Upload */}
      <FileUpload />

      {/* Context Text */}
      <ContextInput />

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className={cn(
          'w-full h-9.5 font-medium tracking-[-0.01em] relative overflow-hidden',
          'shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.2),inset_0_1px_0_0_oklch(1_0_0/0.1)]',
          'transition-all duration-200 hover:shadow-[0_2px_8px_0_oklch(0.55_0.15_264/0.3),inset_0_1px_0_0_oklch(1_0_0/0.1)] hover:scale-[1.01] active:scale-[0.99]',
          'group'
        )}
        size="default"
      >
        {/* Shimmer overlay */}
        <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-shimmer bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <span className="relative flex items-center gap-2">
        {isSubmitting ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            <span>Analyzing...</span>
          </>
        ) : (
          <>
            <Sparkles className="size-3.5" />
            <span>Submit &amp; Analyze</span>
          </>
        )}
        </span>
      </Button>
    </div>
  );
}
