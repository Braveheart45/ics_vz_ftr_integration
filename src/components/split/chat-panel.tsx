'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { formatDistanceToNow } from 'date-fns';

// ── Streaming dots animation ──────────────────────────────────
function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:0ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:150ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:300ms]" />
    </span>
  );
}

// ── Message Bubble ────────────────────────────────────────────
function MessageBubble({
  role,
  content,
  timestamp,
}: {
  role: string;
  content: string;
  timestamp: string;
}) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1.5">
        <span className="text-[11px] text-muted-foreground/50 font-medium">{content}</span>
      </div>
    );
  }

  const timeStr = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

  return (
    <div className={cn('flex gap-2.5 px-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground shadow-[0_1px_2px_0_oklch(0.55_0.15_264/0.2)]'
            : 'bg-secondary text-muted-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.04)]'
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      {/* Bubble */}
      <div className="flex max-w-[82%] flex-col gap-0.5">
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed transition-colors',
            isUser
              ? 'rounded-tr-md bg-primary text-primary-foreground shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.15)]'
              : 'rounded-tl-md bg-secondary/80 text-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:font-normal prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        <span
          className={cn(
            'px-1 text-[10px] text-muted-foreground/35 font-medium',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {timeStr}
        </span>
      </div>
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────
export function ChatPanel() {
  const messages = useAppStore((s) => s.messages);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const addMessage = useAppStore((s) => s.addMessage);
  const sessionId = useAppStore((s) => s.sessionId);
  const taskType = useAppStore((s) => s.taskType);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState('');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const sendFollowUp = useCallback(async () => {
    const trimmed = followUp.trim();
    if (!trimmed || isSending) return;

    setFollowUp('');
    setIsSending(true);
    addMessage({ role: 'user', content: trimmed });

    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    chatHistory.push({ role: 'user', content: trimmed });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory, sessionId, taskType }),
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
        content: `Error: ${errorMessage}`,
      });
    } finally {
      setIsSending(false);
    }
  }, [followUp, isSending, messages, sessionId, taskType, addMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFollowUp();
      }
    },
    [sendFollowUp]
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        {!hasMessages && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            {/* Decorative icon */}
            <div className="relative">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50 shadow-[0_2px_8px_0_oklch(0_0_0/0.04)]">
                <Bot className="size-6 text-muted-foreground/50" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-background bg-secondary shadow-[0_1px_2px_0_oklch(0_0_0/0.06)]">
                <SparkleIcon className="size-2.5 text-amber-500/80" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-foreground/80">
                SQLForge Assistant
              </h3>
              <p className="max-w-[220px] text-xs text-muted-foreground/55 leading-relaxed">
                Provide requirements above or type a message to begin.
              </p>
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="flex flex-col gap-3.5 py-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
              />
            ))}
            {isStreaming && (
              <div className="flex gap-2.5 px-4">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground shadow-[0_1px_2px_0_oklch(0_0_0/0.04)]">
                  <Bot className="size-3.5" />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-secondary/80 px-4 py-3 shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
                  <StreamingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border/40 bg-background/60 px-3 py-2.5 backdrop-blur-sm supports-[backdrop-filter]:bg-background/40">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Follow up or clarify..."
              className="min-h-[38px] max-h-[100px] resize-none text-sm leading-relaxed placeholder:text-muted-foreground/40 pr-10"
              rows={1}
              aria-label="Follow-up message"
            />
          </div>
          <Button
            size="icon"
            onClick={sendFollowUp}
            disabled={!followUp.trim() || isSending}
            className="shrink-0 size-9 rounded-lg shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.15)]"
          >
            {isSending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sparkle icon (inline SVG for minimal dependency) ──────────
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 0L9.41 6.59L16 8L9.41 9.41L8 16L6.59 9.41L0 8L6.59 6.59L8 0Z" />
    </svg>
  );
}
