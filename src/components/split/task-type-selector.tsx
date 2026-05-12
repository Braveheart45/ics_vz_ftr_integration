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
    icon: <Sparkles className="size-3.5" />,
  },
  {
    value: 'sql_generation',
    label: 'SQL Generation',
    icon: <Code className="size-3.5" />,
  },
  {
    value: 'legacy_sql_conversion',
    label: 'Legacy Conversion',
    icon: <ArrowLeftRight className="size-3.5" />,
  },
];

// ── Component ─────────────────────────────────────────────────
export function TaskTypeSelector() {
  const taskType = useAppStore((s) => s.taskType);
  const detectedTask = useAppStore((s) => s.detectedTask);
  const setTaskType = useAppStore((s) => s.setTaskType);

  const handleSelect = (value: TaskType) => {
    setTaskType(value);
  };

  // Detected task type label for auto-detect badge
  const detectedLabel =
    detectedTask?.taskType === 'sql_generation'
      ? 'SQL Generation detected'
      : detectedTask?.taskType === 'legacy_sql_conversion'
        ? 'Legacy Conversion detected'
        : null;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      {/* Segmented control */}
      <div className="flex items-center justify-center rounded-full bg-muted p-1">
        {segments.map((seg) => {
          const isActive = taskType === seg.value;
          return (
            <button
              key={seg.value}
              type="button"
              onClick={() => handleSelect(seg.value)}
              className={cn(
                'relative flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-pressed={isActive}
              title={seg.label}
            >
              {seg.icon}
              {/* Label hidden on mobile (icons only) */}
              <span className="hidden sm:inline">{seg.label}</span>
            </button>
          );
        })}
      </div>

      {/* Detected task badge (only for auto-detect) */}
      {taskType === 'auto_detect' && detectedLabel && detectedTask && (
        <div className="flex items-center justify-center gap-1.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-muted-foreground">
            {detectedLabel}{' '}
            <span className="text-muted-foreground/60">
              ({Math.round(detectedTask.confidence * 100)}% confidence)
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
