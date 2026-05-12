'use client';

import { useAppStore } from '@/stores/use-app-store';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const MAX_CHARS = 5000;

// ── Component ─────────────────────────────────────────────────
export function ContextInput() {
  const contextText = useAppStore((s) => s.contextText);
  const setContextText = useAppStore((s) => s.setContextText);

  return (
    <div className="relative">
      <Textarea
        value={contextText}
        onChange={(e) => setContextText(e.target.value)}
        placeholder="Describe requirements, mappings, or paste context..."
        className={cn(
          'min-h-[80px] max-h-[160px] resize-y text-sm leading-relaxed',
          'placeholder:text-muted-foreground/45',
          'border-border shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]',
          'focus-visible:border-ring/30'
        )}
        aria-label="Context input"
        maxLength={MAX_CHARS}
      />
      <div className="absolute bottom-2 right-2.5 text-[10px] tabular-nums text-muted-foreground/35">
        {contextText.length.toLocaleString()}
        <span className="text-muted-foreground/20">/{MAX_CHARS.toLocaleString()}</span>
      </div>
    </div>
  );
}
