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
    <div className="flex h-full items-center gap-1 px-4">
      <div className="flex items-center flex-1 min-w-0">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const Icon = stage.icon;

          return (
            <div key={stage.id} className="flex items-center">
              {/* Stage indicator */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    'flex items-center justify-center size-6 rounded-full transition-all duration-300',
                    isCompleted
                      ? 'bg-foreground text-background'
                      : isCurrent
                        ? 'bg-foreground text-background ring-2 ring-foreground/20'
                        : 'bg-muted text-muted-foreground/40'
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : (
                    <Icon className="size-3" strokeWidth={1.5} />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[9px] leading-none font-medium whitespace-nowrap hidden md:block',
                    isCompleted
                      ? 'text-foreground/70'
                      : isCurrent
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
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
                      'w-4 sm:w-8 lg:w-12 h-px transition-colors duration-300',
                      isCompleted
                        ? 'bg-foreground/30'
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
