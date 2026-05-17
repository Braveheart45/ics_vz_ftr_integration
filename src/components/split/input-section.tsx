'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/use-app-store';
import { JiraInput } from './jira-input';
import { FileUpload } from './file-upload';
import { ContextInput } from './context-input';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { postAndStream, processSSEStream } from '@/lib/sse-client';
import { validateBqDatasetId, validateBqProjectId } from '@/lib/target-scope';

// ── Component ─────────────────────────────────────────────────
export function InputSection() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);
  const contextText = useAppStore((s) => s.contextText);
  const uploadedFiles = useAppStore((s) => s.uploadedFiles);
  const addMessage = useAppStore((s) => s.addMessage);
  const taskType = useAppStore((s) => s.taskType);
  const sessionId = useAppStore((s) => s.sessionId);
  const messages = useAppStore((s) => s.messages);
  const isAgentRunning = useAppStore((s) => s.isAgentRunning);

  const abortRef = useRef<AbortController | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const buildUserMessage = useCallback((): string | null => {
    const parts: string[] = [];

    if (jiraInput.project.trim() && jiraInput.storyNumber.trim()) {
      parts.push(`[Jira] Project: ${jiraInput.project}, Story: ${jiraInput.storyNumber}`);
    }

    if (bqProjectInput.projectId.trim()) {
      parts.push(`[BigQuery] Project: ${bqProjectInput.projectId}`);
    }

    if (bqProjectInput.datasetId.trim()) {
      parts.push(`[BigQuery] Dataset: ${bqProjectInput.datasetId}`);
      parts.push(`[BigQuery Scope] Schema reconciliation and any inference must stay within ${bqProjectInput.projectId}.${bqProjectInput.datasetId}. Do not crawl or infer from other datasets.`);
    }

    if (contextText.trim()) {
      parts.push(contextText.trim());
    }

    if (uploadedFiles.length > 0) {
      const fileParts = uploadedFiles.flatMap((f) => {
        if (!f.content) return [];
        const body = f.content.length > 8000
          ? f.content.slice(0, 8000) + '\n...(truncated)'
          : f.content;
        return [`[File: ${f.name}]\n${body}`];
      });
      if (fileParts.length > 0) {
        parts.push(fileParts.join('\n\n'));
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }, [jiraInput, bqProjectInput, contextText, uploadedFiles]);

  const handleSubmit = useCallback(async () => {
    if (!bqProjectInput.projectId.trim()) {
      toast.error('Target BigQuery Project ID is required.');
      return;
    }

    const projectValidation = validateBqProjectId(bqProjectInput.projectId);
    if (!projectValidation.ok) {
      toast.error(projectValidation.error);
      return;
    }

    if (!bqProjectInput.datasetId.trim()) {
      toast.error('Target BigQuery Dataset ID is required.');
      return;
    }

    const datasetValidation = validateBqDatasetId(bqProjectInput.datasetId);
    if (!datasetValidation.ok) {
      toast.error(datasetValidation.error);
      return;
    }

    const userContent = buildUserMessage();
    if (!userContent) {
      toast.error('Please provide some input before submitting.');
      return;
    }

    // Build message history
    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    chatHistory.push({ role: 'user', content: userContent });

    // Add user message to chat
    addMessage({ role: 'user', content: userContent });

    // Start agent — clear all prior-run state
    setIsSubmitting(true);
    useAppStore.getState().clearPipeline();
    useAppStore.getState().clearActivityEvents();
    useAppStore.getState().clearStreamingContent();
    useAppStore.getState().setStmArtifact(null);
    useAppStore.getState().setValidationSummary(null);
    useAppStore.getState().setPendingClarification(null);
    useAppStore.getState().clearClarificationHistory();
    useAppStore.getState().setStreaming(true);
    useAppStore.getState().setAgentRunning(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await postAndStream('/api/chat', {
        messages: chatHistory,
        sessionId,
        taskType,
        jiraInput: jiraInput.project.trim() ? jiraInput : undefined,
        bqProjectId: bqProjectInput.projectId.trim() || undefined,
        bqDatasetId: bqProjectInput.datasetId.trim() || undefined,
        contextText: contextText.trim() || undefined,
      }, abort.signal);

      await processSSEStream(res);

      const state = useAppStore.getState();
      if (state.sqlOutput?.sql) {
        toast.success('SQL generation complete');
      } else if (state.pendingClarification) {
        toast.info('Claude needs clarification before SQL generation.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Reset agent state in case processSSEStream never ran (network error before response)
      useAppStore.getState().setStreaming(false);
      useAppStore.getState().setAgentRunning(false);
      const msg = error instanceof Error ? error.message : 'Something went wrong';
      const msgs = useAppStore.getState().messages;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      if (!lastAssistant?.content.includes('Error')) {
        addMessage({ role: 'assistant', content: `Error: ${msg}. Please try again.` });
      }
      toast.error('Failed to generate. Check the chat for details.');
    } finally {
      setIsSubmitting(false);
      abortRef.current = null;
    }
  }, [buildUserMessage, messages, sessionId, taskType, jiraInput, bqProjectInput, contextText, addMessage]);

  return (
    <div className="flex flex-col gap-3.5 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
      {/* Jira Project, Story No. & BigQuery target scope */}
      <JiraInput />

      {/* File Upload */}
      <FileUpload />

      {/* Context Text */}
      <ContextInput />

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || isAgentRunning}
        className={cn(
          'w-full h-9.5 font-medium tracking-[-0.01em] relative overflow-hidden rounded-lg',
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
            <span>Processing...</span>
          </>
        ) : (
          <>
            <Sparkles className="size-3.5" />
            <span>Submit &amp; Generate</span>
          </>
        )}
        </span>
      </Button>
    </div>
  );
}
