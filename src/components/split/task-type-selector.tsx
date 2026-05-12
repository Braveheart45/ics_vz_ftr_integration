'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/use-app-store';
import type { TaskType } from '@/lib/types';
import { Sparkles, Code, ArrowLeftRight } from 'lucide-react';

// ── Segment Definitions ──────────────────────────────────────
const segments: { value: TaskType; label: string; icon: React.ReactNode }[] = [
  {
    value: 'auto_detect',
    label: 'Auto-detect',
    icon: <Sparkles className="size-3" />,
  },
  {
    value: 'sql_generation',
    label: 'Generate',
    icon: <Code className="size-3" />,
  },
  {
    value: 'legacy_sql_conversion',
    label: 'Convert',
    icon: <ArrowLeftRight className="size-3" />,
  },
];

// ── Component ─────────────────────────────────────────────────
export function TaskTypeSelector() {
  const taskType = useAppStore((s) => s.taskType);
  const setTaskType = useAppStore((s) => s.setTaskType);

  return (
    <div className="flex items-center justify-center px-4 py-2.5">
      <div className="relative flex items-center rounded-xl bg-muted/70 p-1 shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.04)]">
        {segments.map((seg) => {
          const isActive = taskType === seg.value;
          return (
            <button
              key={seg.value}
              type="button"
              onClick={() => setTaskType(seg.value)}
              className={cn(
                'relative flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-medium tracking-[-0.01em] transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.25)]'
                  : 'text-muted-foreground/70 hover:text-muted-foreground'
              )}
              aria-pressed={isActive}
              title={seg.label}
            >
              {seg.icon}
              <span className="hidden sm:inline">{seg.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
