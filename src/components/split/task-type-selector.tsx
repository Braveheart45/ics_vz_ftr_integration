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
    <div className="flex items-center justify-center px-3 py-2">
      <div className="flex items-center rounded-lg bg-muted/60 p-0.5">
        {segments.map((seg) => {
          const isActive = taskType === seg.value;
          return (
            <button
              key={seg.value}
              type="button"
              onClick={() => setTaskType(seg.value)}
              className={cn(
                'relative flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
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
