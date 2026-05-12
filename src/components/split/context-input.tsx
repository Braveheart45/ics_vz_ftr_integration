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
        placeholder="Describe your SQL requirements, provide mapping details, or paste context..."
        className={cn(
          'min-h-[100px] max-h-[200px] resize-y text-sm',
          'scrollbar-thin scrollbar-thumb-muted-foreground/20'
        )}
        aria-label="Context input"
        maxLength={MAX_CHARS}
      />
      {/* Character count */}
      <div className="absolute bottom-2 right-2.5 text-[10px] tabular-nums text-muted-foreground/50">
        {contextText.length.toLocaleString()}
        <span className="text-muted-foreground/30">/{MAX_CHARS.toLocaleString()}</span>
      </div>
    </div>
  );
}
