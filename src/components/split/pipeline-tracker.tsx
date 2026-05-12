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
import { cn } from '@/lib/utils';

// ============================================================
// Stage Definitions
// ============================================================

const STAGES: {
  id: WorkflowStage;
  label: string;
  shortLabel: string;
  icon: typeof Circle;
}[] = [
  { id: 'idle', label: 'Idle', shortLabel: 'Idle', icon: Circle },
  { id: 'intake', label: 'Intake', shortLabel: 'Intake', icon: Inbox },
  { id: 'analysis', label: 'Analysis', shortLabel: 'Analyze', icon: Search },
  { id: 'schema_resolution', label: 'Schema Resolution', shortLabel: 'Schema', icon: Database },
  { id: 'sql_generation', label: 'SQL Generation', shortLabel: 'Generate', icon: Code },
  { id: 'validation', label: 'Validation', shortLabel: 'Validate', icon: ShieldCheck },
  { id: 'ready', label: 'Ready to Deploy', shortLabel: 'Ready', icon: Rocket },
];

const STAGE_ORDER: WorkflowStage[] = STAGES.map((s) => s.id);

// ============================================================
// Component
// ============================================================

export function PipelineTracker() {
  const currentStage = useAppStore((s) => s.currentStage);
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <div className="flex h-full items-center gap-1 px-5">
      <div className="flex items-center flex-1 min-w-0 stagger-children">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const Icon = stage.icon;

          return (
            <div key={stage.id} className="flex items-center animate-fade-in-up">
              {/* Stage indicator */}
              <div className="flex flex-col items-center gap-1.5 group cursor-default">
                <div
                  className={cn(
                    'flex items-center justify-center size-7 rounded-full transition-all duration-300',
                    isCompleted
                      ? 'bg-[#F97316] text-white shadow-[0_1px_3px_0_oklch(0.65_0.2_45/0.3)] hover:scale-110'
                      : isCurrent
                        ? 'bg-[#4285F4] text-white shadow-[0_1px_3px_0_oklch(0.59_0.19_264/0.3)] animate-pulse-ring'
                        : 'bg-muted text-foreground/50 group-hover:bg-muted group-hover:text-foreground/70 transition-colors'
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-3.5" strokeWidth={2.5} />
                  ) : (
                    <Icon className={cn('size-3.5', isCurrent && 'animate-pulse')} strokeWidth={1.75} />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] leading-none font-bold tracking-[0.01em] whitespace-nowrap hidden md:block transition-colors duration-300',
                    isCompleted
                      ? 'text-foreground'
                      : isCurrent
                        ? 'text-foreground font-extrabold'
                        : 'text-foreground/70 group-hover:text-foreground'
                  )}
                >
                  {stage.shortLabel}
                </span>
              </div>

              {/* Connector */}
              {idx < STAGES.length - 1 && (
                <div className="flex items-center mx-0.5">
                  <div
                    className={cn(
                      'h-[2px] rounded-full transition-all duration-700',
                      'w-4 sm:w-10 lg:w-14',
                      isCompleted
                        ? 'bg-[#F97316]/50'
                        : isCurrent
                          ? 'animate-connector-pulse bg-[#4285F4]'
                          : 'bg-border'
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
