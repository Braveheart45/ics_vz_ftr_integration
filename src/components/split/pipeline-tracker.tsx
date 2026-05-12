'use client';

import {
  Circle,
  Inbox,
  Search,
  Database,
  Code,
  ShieldCheck,
  Rocket,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/stores/use-app-store';
import type { WorkflowStage } from '@/lib/types';

// ============================================================
// Stage Definitions
// ============================================================

const STAGES: {
  id: WorkflowStage;
  label: string;
  icon: typeof Circle;
}[] = [
  { id: 'idle', label: 'Idle', icon: Circle },
  { id: 'intake', label: 'Intake', icon: Inbox },
  { id: 'analysis', label: 'Analysis', icon: Search },
  { id: 'schema_resolution', label: 'Schema', icon: Database },
  { id: 'sql_generation', label: 'Generate', icon: Code },
  { id: 'validation', label: 'Validate', icon: ShieldCheck },
  { id: 'ready', label: 'Ready', icon: Rocket },
];

const STAGE_ORDER: WorkflowStage[] = STAGES.map((s) => s.id);

// ============================================================
// Component
// ============================================================

export function PipelineTracker() {
  const currentStage = useAppStore((s) => s.currentStage);

  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  const totalStages = STAGES.length;

  // Progress percentage based on how many stages have been reached
  const progressPct =
    currentIdx <= 0 ? 0 : Math.round((currentIdx / (totalStages - 1)) * 100);

  return (
    <div className="flex items-center gap-3 px-4 py-3 h-24">
      {/* Pipeline stages */}
      <div className="flex items-center flex-1 min-w-0">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;

          const Icon = stage.icon;

          return (
            <div key={stage.id} className="flex items-center">
              {/* Stage pill */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`
                    flex items-center justify-center size-7 rounded-full
                    text-[11px] font-medium transition-all duration-300
                    ${
                      isCompleted
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : isCurrent
                          ? 'bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30 animate-pulse'
                          : 'bg-muted text-muted-foreground'
                    }
                  `}
                >
                  {isCompleted ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : (
                    <Icon className="size-3.5" strokeWidth={2} />
                  )}
                </div>
                {/* Label */}
                <span
                  className={`
                    text-[10px] leading-none font-medium whitespace-nowrap
                    hidden sm:block
                    ${
                      isCompleted
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : isCurrent
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                    }
                  `}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {idx < STAGES.length - 1 && (
                <div className="flex items-center mx-1 h-5">
                  <div
                    className={`
                      w-6 sm:w-10 lg:w-14 h-[2px] rounded-full transition-colors duration-300
                      ${
                        isCompleted || (isCurrent && idx < currentIdx)
                          ? 'bg-emerald-400 dark:bg-emerald-500'
                          : 'bg-border border border-dashed border-muted-foreground/30'
                      }
                    `}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress indicator */}
      <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
        <span className="text-xs font-semibold text-foreground tabular-nums">
          {progressPct}%
        </span>
        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
