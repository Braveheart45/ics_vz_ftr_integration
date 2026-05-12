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
    <div className="flex flex-col gap-4">
      {/* Jira Story (optional) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted-foreground">
          Jira Story <span className="text-muted-foreground/40 font-normal">(optional)</span>
        </Label>
        <JiraInput />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">and / or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* File Upload */}
      <FileUpload />

      {/* Context Text */}
      <ContextInput />

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full h-9"
        size="default"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Analyzing...
          </>
        ) : (
          <>
            <Sparkles className="size-3.5" />
            Submit & Analyze
          </>
        )}
      </Button>
    </div>
  );
}
