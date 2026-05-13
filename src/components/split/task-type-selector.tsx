'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/use-app-store';
import type { TaskType } from '@/lib/types';
import { Sparkles, Code, ArrowLeftRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// ── Segment Definitions ──────────────────────────────────────
const segments: { value: TaskType; label: string; icon: React.ReactNode }[] = [
  {
    value: 'auto_detect',
    label: 'Auto-detect',
    icon: <Sparkles className="size-4" />,
  },
  {
    value: 'sql_generation',
    label: 'Generate',
    icon: <Code className="size-4" />,
  },
  {
    value: 'legacy_sql_conversion',
    label: 'Convert',
    icon: <ArrowLeftRight className="size-4" />,
  },
];

// ── Component ─────────────────────────────────────────────────
export function TaskTypeSelector() {
  const taskType = useAppStore((s) => s.taskType);
  const setTaskType = useAppStore((s) => s.setTaskType);
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({ opacity: 0 });

  const activeIdx = segments.findIndex((seg) => seg.value === taskType);

  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>('[data-segment]');
    const btn = buttons[activeIdx];
    if (!btn) return;

    setIndicatorStyle({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
      opacity: 1,
    });
  }, [activeIdx]);

  return (
    <div className="flex items-center justify-center px-4 py-2.5 animate-fade-in-up">
      <div
        ref={containerRef}
        className="relative flex items-center rounded-xl bg-muted/70 p-1 shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.04)]"
      >
        {/* Sliding indicator pill — GCP Blue for active */}
        <div
          className="absolute top-1 z-0 h-[calc(100%-8px)] rounded-lg bg-[#4285F4] text-white shadow-[0_1px_4px_0_oklch(0.59_0.19_264/0.35)] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={indicatorStyle}
        />

        {segments.map((seg, idx) => {
          const isActive = taskType === seg.value;
          return (
            <button
              key={seg.value}
              data-segment
              type="button"
              onClick={() => setTaskType(seg.value)}
              className={cn(
                'relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-[12px] font-semibold tracking-[-0.01em] transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'hover:scale-[1.02] active:scale-[0.97]',
                isActive
                  ? 'text-white'
                  : 'text-foreground hover:text-foreground'
              )}
              aria-pressed={isActive}
              title={seg.label}
            >
              {/* Orange icon always — override text color for icon */}
              <span className={cn(
                'transition-colors duration-200',
                isActive ? 'text-white' : 'text-[#F97316]'
              )}>
                {seg.icon}
              </span>
              <span className="hidden sm:inline">{seg.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
