'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/use-app-store';
import { JiraInput } from './jira-input';
import { FileUpload } from './file-upload';
import { ContextInput } from './context-input';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// ── Component ─────────────────────────────────────────────────
export function InputSection() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const contextText = useAppStore((s) => s.contextText);
  const uploadedFiles = useAppStore((s) => s.uploadedFiles);
  const addMessage = useAppStore((s) => s.addMessage);
  const setStage = useAppStore((s) => s.setStage);
  const taskType = useAppStore((s) => s.taskType);
  const inputMode = useAppStore((s) => s.inputMode);
  const setInputMode = useAppStore((s) => s.setInputMode);
  const sessionId = useAppStore((s) => s.sessionId);
  const messages = useAppStore((s) => s.messages);
  const setStreaming = useAppStore((s) => s.setStreaming);
  const updateLastAssistantMessage = useAppStore((s) => s.updateLastAssistantMessage);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const buildUserMessage = useCallback((): string | null => {
    const parts: string[] = [];

    // Jira context
    if (jiraInput.project.trim() && jiraInput.storyNumber.trim()) {
      parts.push(
        `[Jira] Project: ${jiraInput.project}, Story: ${jiraInput.storyNumber}`
      );
    }

    // Context text
    if (contextText.trim()) {
      parts.push(contextText.trim());
    }

    // File references
    if (uploadedFiles.length > 0) {
      const fileNames = uploadedFiles.map((f) => f.name).join(', ');
      parts.push(`[Attached files: ${fileNames}]`);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }, [jiraInput, contextText, uploadedFiles]);

  const handleSubmit = useCallback(async () => {
    const userContent = buildUserMessage();
    if (!userContent) {
      toast.error('Please provide some input before submitting.');
      return;
    }

    setIsSubmitting(true);
    setStage('intake');

    // Add user message
    addMessage({ role: 'user', content: userContent });

    // Build messages payload for the API
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
          jiraInput: jiraInput.project.trim()
            ? jiraInput
            : undefined,
          contextText: contextText.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to get AI response');
      }

      const data = await res.json();

      // Add assistant message
      setStreaming(true);
      addMessage({ role: 'assistant', content: data.content });
      setStreaming(false);
    } catch (error) {
      setStreaming(false);
      const errorMessage =
        error instanceof Error ? error.message : 'Something went wrong';
      addMessage({
        role: 'assistant',
        content: `⚠️ Error: ${errorMessage}. Please try again.`,
      });
      toast.error('Failed to submit. Check the chat for details.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    buildUserMessage,
    messages,
    sessionId,
    taskType,
    jiraInput,
    contextText,
    addMessage,
    setStage,
    setStreaming,
    updateLastAssistantMessage,
  ]);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as 'jira' | 'contextual')}>
        <TabsList className="h-8 w-full">
          <TabsTrigger value="jira" className="flex-1 text-xs">
            Jira Story
          </TabsTrigger>
          <TabsTrigger value="contextual" className="flex-1 text-xs">
            Context
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jira" className="mt-2">
          <JiraInput />
        </TabsContent>

        <TabsContent value="contextual" className="mt-2 flex flex-col gap-3">
          <FileUpload />
          <ContextInput />
        </TabsContent>
      </Tabs>

      {/* Submit button */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full"
        size="default"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Analyzing...
          </>
        ) : (
          <>
            <Sparkles className="size-4" />
            Submit & Analyze
          </>
        )}
      </Button>
    </div>
  );
}
