'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCircle2, Loader2, MessageCircleQuestion, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { postAndStream, processSSEStream } from '@/lib/sse-client';
import { useAppStore } from '@/stores/use-app-store';
import { toast } from 'sonner';
import { validateBqDatasetId, validateBqProjectId } from '@/lib/target-scope';

export function ChatPanel() {
  const isStreaming = useAppStore((s) => s.isStreaming);
  const isAgentRunning = useAppStore((s) => s.isAgentRunning);
  const sessionId = useAppStore((s) => s.sessionId);
  const taskType = useAppStore((s) => s.taskType);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);
  const jiraInput = useAppStore((s) => s.jiraInput);
  const contextText = useAppStore((s) => s.contextText);
  const pendingClarification = useAppStore((s) => s.pendingClarification);
  const interactionState = useAppStore((s) => s.interactionState);
  const messages = useAppStore((s) => s.messages);
  const clarificationHistory = useAppStore((s) => s.clarificationHistory);
  const addMessage = useAppStore((s) => s.addMessage);
  const recordClarificationAnswer = useAppStore((s) => s.recordClarificationAnswer);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const isAwaitingClarification =
    interactionState === 'awaiting_clarification' && pendingClarification;
  const isErrored = interactionState === 'error';
  const latestErrorMessage = isErrored
    ? [...messages].reverse().find((m) => m.role === 'assistant' && m.content.toLowerCase().includes('error'))?.content
    : undefined;

  useEffect(() => {
    if (isAwaitingClarification) {
      setSelectedOptions([]);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isAwaitingClarification]);

  const toggleOption = useCallback((option: string) => {
    setSelectedOptions((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [pendingClarification, isStreaming]);

  const sendFollowUp = useCallback(
    async (explicitAnswer?: string) => {
      const composedAnswer = explicitAnswer ?? [
        selectedOptions.length > 0 ? `Selected option(s):\n${selectedOptions.map((option) => `- ${option}`).join('\n')}` : '',
        followUp.trim() ? `Additional context:\n${followUp.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      const trimmed = composedAnswer.trim();
      if (!trimmed || isSending || isAgentRunning) return;

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

      // Pin the architect's answer onto the latest clarification history
      // entry BEFORE clearing the pending clarification — otherwise the
      // entry stays unanswered in the visible dialog.
      recordClarificationAnswer(selectedOptions, followUp.trim());

      setFollowUp('');
      setSelectedOptions([]);
      setIsSending(true);
      addMessage({ role: 'user', content: trimmed });

      useAppStore.getState().setPendingClarification(null);
      // Drop the prior round's validation summary so stale pass/fail badges
      // don't bleed into the new run before its own summary arrives.
      useAppStore.getState().setValidationSummary(null);
      useAppStore.getState().setStreaming(true);
      useAppStore.getState().setAgentRunning(true);

      const chatHistory = useAppStore.getState().messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const res = await postAndStream(
          '/api/chat',
          {
            messages: chatHistory,
            sessionId,
            taskType,
            // Preserve Jira + context across clarification roundtrips so the
            // bridge keeps treating the run as Jira-backed so the validation-
            // gated Jira follow-up pass remains eligible.
            jiraInput: jiraInput.project.trim() ? jiraInput : undefined,
            bqProjectId: bqProjectInput.projectId.trim(),
            bqDatasetId: bqProjectInput.datasetId.trim(),
            contextText: contextText.trim() || undefined,
          },
          abort.signal,
        );

        await processSSEStream(res);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        useAppStore.getState().setStreaming(false);
        useAppStore.getState().setAgentRunning(false);
        const message = error instanceof Error ? error.message : 'Failed to get response';
        addMessage({ role: 'assistant', content: `Error: ${message}` });
      } finally {
        setIsSending(false);
        abortRef.current = null;
      }
    },
    [followUp, selectedOptions, isSending, isAgentRunning, sessionId, taskType, bqProjectInput, jiraInput, contextText, addMessage, recordClarificationAnswer],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendFollowUp();
      }
    },
    [sendFollowUp],
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    useAppStore.getState().setStreaming(false);
    useAppStore.getState().setAgentRunning(false);
  }, []);

  const answeredHistory = clarificationHistory.filter((e) => e.answeredAt);
  const hasHistory = answeredHistory.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background custom-scrollbar">
        {hasHistory && (
          <div className="px-4 pt-4 pb-2 space-y-2 animate-fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Clarifications this session
            </p>
            {answeredHistory.map((entry, idx) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="flex size-4 shrink-0 items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-50">
                    <CheckCircle2 className="size-2.5 text-emerald-600" />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    Q{idx + 1} · Answered
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-foreground/90 leading-snug whitespace-pre-wrap break-words">
                  {entry.message}
                </p>
                {entry.selectedOptions && entry.selectedOptions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {entry.selectedOptions.map((opt) => (
                      <span
                        key={opt}
                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/85"
                      >
                        <Check className="size-2.5" />
                        {opt}
                      </span>
                    ))}
                  </div>
                )}
                {entry.freeText && (
                  <div className="mt-1.5 rounded border border-border/40 bg-background/60 px-2 py-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-muted-foreground mb-0.5">
                      Your context
                    </p>
                    <p className="text-[10.5px] font-medium text-foreground/80 leading-snug whitespace-pre-wrap break-words">
                      {entry.freeText}
                    </p>
                  </div>
                )}
                {!entry.selectedOptions?.length && !entry.freeText && (
                  <p className="mt-1.5 text-[10px] italic text-muted-foreground">
                    (Answered with no selection or context)
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {!isAwaitingClarification && !isErrored && !hasHistory && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="relative animate-float">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50 shadow-[0_2px_8px_0_oklch(0_0_0/0.04)] animate-breathe">
                <Bot className="size-6 text-foreground/40" />
              </div>
            </div>
            <div className="animate-fade-in-up flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-foreground">
                SQL Curator Assistant
              </h3>
              <p className="max-w-[260px] text-xs font-medium text-foreground/80 leading-relaxed">
                Clarifications, options, and confirmation requests from Claude appear here.
              </p>
            </div>
          </div>
        )}

        {isErrored && !isAwaitingClarification && (
          <div className="px-4 py-4 animate-fade-in">
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-3.5 py-3 shadow-[0_2px_8px_0_oklch(0_0_0/0.04)]">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-red-300/60 bg-red-100">
                  <AlertTriangle className="size-3 text-red-600" />
                </div>
                <span className="text-[11px] font-semibold text-red-700 uppercase tracking-[0.05em]">
                  Run Failed
                </span>
              </div>
              <p className="text-xs font-medium text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">
                {latestErrorMessage || 'The run ended in an error. Check the Activity Feed for diagnosis.'}
              </p>
              <p className="mt-2 text-[10px] font-medium text-muted-foreground">
                Resolve the issue above, then click <span className="font-semibold">Submit &amp; Generate</span> to retry. The session is preserved so Claude resumes the same conversation.
              </p>
            </div>
          </div>
        )}

        {isAwaitingClarification && pendingClarification && (
          <div className="px-4 py-4 animate-fade-in">
            <div className="rounded-xl border border-border/60 bg-background px-3.5 py-3 shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40">
                  <MessageCircleQuestion className="size-3 text-muted-foreground" />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.05em]">
                  Input required
                </span>
              </div>
              {(pendingClarification.details || pendingClarification.explanation) && (
                <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border/40 bg-muted/20 p-2.5 custom-scrollbar">
                  <p className="text-xs font-medium text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                    {pendingClarification.details || pendingClarification.explanation}
                  </p>
                </div>
              )}
              {pendingClarification.message && (
                <p className="mt-2 text-xs font-semibold text-foreground/85 whitespace-pre-wrap">
                  {pendingClarification.message}
                </p>
              )}
              {pendingClarification.options && pendingClarification.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pendingClarification.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleOption(option)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors',
                        selectedOptions.includes(option)
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-border/60 bg-background text-foreground/80 hover:bg-muted/40',
                      )}
                    >
                      <span className={cn(
                        'flex size-3.5 shrink-0 items-center justify-center rounded border',
                        selectedOptions.includes(option)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background',
                      )}>
                        {selectedOptions.includes(option) && <Check className="size-2.5" />}
                      </span>
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {pendingClarification.allowFreeText !== false && (
                <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                  Select one or more options, add optional context below, then send.
                </p>
              )}
            </div>
          </div>
        )}

      </div>

      {isAwaitingClarification && (
        <div
          className={cn(
            'border-t px-3 py-2.5 backdrop-blur-sm transition-all duration-300',
            'border-border/40 bg-background/80 supports-[backdrop-filter]:bg-background/60',
          )}
        >
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isAgentRunning || isSending || Boolean(pendingClarification?.allowFreeText === false)}
              placeholder="Provide clarification or extra context..."
              className="min-h-[38px] max-h-[100px] resize-none text-sm leading-relaxed placeholder:text-foreground/50 transition-all duration-300 ring-2 ring-ring/20 border-primary/30 focus-visible:ring-ring/30"
              rows={1}
              aria-label="Clarification response"
            />
            {isAgentRunning ? (
              <Button
                size="icon"
                onClick={handleAbort}
                className="shrink-0 size-9 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600 transition-all duration-200 hover:scale-110 active:scale-95"
                title="Cancel"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => sendFollowUp()}
                disabled={(!followUp.trim() && selectedOptions.length === 0) || isSending || isAgentRunning}
                className="shrink-0 size-9 rounded-lg shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.15)] transition-all duration-200 hover:scale-110 hover:shadow-[0_2px_6px_0_oklch(0.55_0.15_264/0.25)] active:scale-95"
              >
                {isSending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
