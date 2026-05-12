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
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
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
      <div className="flex justify-center px-4 py-1">
        <span className="text-[11px] text-muted-foreground/50">{content}</span>
      </div>
    );
  }

  const timeStr = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

  return (
    <div className={cn('flex gap-2 px-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'mt-1 flex size-6 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-foreground/90 text-background'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {isUser ? <User className="size-3" /> : <Bot className="size-3" />}
      </div>

      {/* Bubble */}
      <div className="flex max-w-[85%] flex-col gap-0.5">
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-[13px] leading-relaxed',
            isUser
              ? 'rounded-tr-sm bg-foreground/90 text-background'
              : 'rounded-tl-sm bg-muted/80 text-foreground'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-code:rounded prose-code:bg-muted-foreground/10 prose-code:px-1 prose-a:text-foreground prose-strong:text-foreground">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        <span
          className={cn(
            'px-1 text-[10px] text-muted-foreground/40',
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
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/60">
              <Bot className="size-5 text-muted-foreground/60" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-foreground/80">
                SQLForge Assistant
              </h3>
              <p className="max-w-[240px] text-xs text-muted-foreground/60 leading-relaxed">
                Provide your requirements above, or type a message below to get started.
              </p>
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="flex flex-col gap-3 py-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
              />
            ))}
            {isStreaming && (
              <div className="flex gap-2 px-4">
                <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Bot className="size-3" />
                </div>
                <div className="rounded-xl rounded-tl-sm bg-muted/80 px-4 py-3">
                  <StreamingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t px-3 py-2.5">
        <div className="flex items-end gap-2">
          <Textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Follow up or clarify..."
            className="min-h-[36px] max-h-[100px] resize-none text-sm placeholder:text-muted-foreground/40"
            rows={1}
            aria-label="Follow-up message"
          />
          <Button
            size="icon"
            onClick={sendFollowUp}
            disabled={!followUp.trim() || isSending}
            className="shrink-0 size-9"
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
