'use client';

import {
  Inbox,
  Search,
  Database,
  Code,
  Shield,
  Rocket,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import type { WorkflowStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const STAGES: {
  id: WorkflowStage;
  shortLabel: string;
  icon: typeof Inbox;
}[] = [
  { id: 'intake', shortLabel: 'Intake', icon: Inbox },
  { id: 'analysis', shortLabel: 'Analyze', icon: Search },
  { id: 'schema_resolution', shortLabel: 'Schema', icon: Database },
  { id: 'sql_generation', shortLabel: 'Generate', icon: Code },
  { id: 'validation', shortLabel: 'Validate', icon: Shield },
  { id: 'ready', shortLabel: 'Ready', icon: Rocket },
];

interface PipelineTrackerProps {
  variant?: 'full' | 'compact';
  className?: string;
}

export function PipelineTracker({ variant = 'full', className }: PipelineTrackerProps) {
  const currentStage = useAppStore((state) => state.currentStage);
  const stageMessage = useAppStore((state) => state.stageMessage);
  const activeStages = useAppStore((state) => state.activeStages);
  const completedStages = useAppStore((state) => state.completedStages);
  const interactionState = useAppStore((state) => state.interactionState);
  const stageHistory = useAppStore((state) => state.stageHistory);
  const isAgentRunning = useAppStore((state) => state.isAgentRunning);

  const [now, setNow] = useState(Date.now());

  const isIdle = currentStage === 'idle';
  const isError = interactionState === 'error';

  const currentStageStartedAt = useMemo(() => {
    const currentEntries = stageHistory.filter((e) => e.stage === currentStage);
    return currentEntries.at(-1)?.timestamp ?? Date.now();
  }, [currentStage, stageHistory]);

  const elapsedSeconds = Math.max(0, Math.floor((now - currentStageStartedAt) / 1000));
  const showHeartbeat = isAgentRunning && !isIdle && !isError && elapsedSeconds >= 20;

  useEffect(() => {
    if (!isAgentRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isAgentRunning]);

  if (variant === 'compact') {
    return (
      <div className={cn('flex min-w-0 items-center gap-1 rounded-md border border-border/50 bg-background/75 px-1.5 py-1', className)}>
        {STAGES.map((stage, idx) => {
          const isCompleted = completedStages.includes(stage.id);
          const isActive = activeStages.includes(stage.id);
          const isCurrentError = isError && stage.id === currentStage;
          const Icon = stage.icon;

          const dotStyle = isCurrentError
            ? 'bg-red-500 text-white'
            : isCompleted
              ? 'bg-[#4285F4] text-white'
              : isActive
                ? 'bg-[#4285F4] text-white animate-pulse-ring'
                : isIdle
                  ? 'bg-muted text-foreground/35'
                  : 'bg-muted text-foreground/55';

          const connectorStyle = isCompleted
            ? 'bg-[#4285F4]/50'
            : isActive
              ? isCurrentError ? 'bg-red-400/50' : 'animate-connector-pulse bg-[#4285F4]'
              : isIdle ? 'bg-border/40' : 'bg-border';

          const statusText = isCurrentError
            ? 'failed'
            : isCompleted
              ? 'completed'
              : isActive
                ? 'active'
                : 'pending';

          return (
            <div key={stage.id} className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn('flex size-6 cursor-default items-center justify-center rounded-full transition-all duration-300', dotStyle)}
                    aria-label={`${stage.shortLabel} ${statusText}`}
                  >
                    {isCurrentError ? (
                      <AlertTriangle className="size-3.5" strokeWidth={2.5} />
                    ) : isCompleted ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : isActive ? (
                      <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="text-xs">
                  {stage.shortLabel} · {statusText}
                </TooltipContent>
              </Tooltip>

              {idx < STAGES.length - 1 && (
                <div className={cn('mx-0.5 h-[2px] w-3 rounded-full transition-all duration-700', connectorStyle)} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-3 rounded-md border border-border/40 bg-background/70 px-2 py-1', className)}>
      <div className="flex min-w-0 items-center">
        {STAGES.map((stage, idx) => {
          const isCompleted = completedStages.includes(stage.id);
          const isActive = activeStages.includes(stage.id);
          const isCurrentError = isError && stage.id === currentStage;
          const Icon = stage.icon;

          const dotStyle = isCurrentError
            ? 'bg-red-500 text-white'
            : isCompleted
              ? 'bg-[#4285F4] text-white'
              : isActive
                ? 'bg-[#4285F4] text-white animate-pulse-ring'
                : isIdle
                  ? 'bg-muted text-foreground/30'
                  : 'bg-muted text-foreground/50';

          const labelStyle = isCurrentError
            ? 'text-red-500'
            : isCompleted || isActive
              ? 'text-foreground'
              : 'text-foreground/50';

          const connectorStyle = isCompleted
            ? 'bg-[#4285F4]/50'
            : isActive
              ? isCurrentError ? 'bg-red-400/50' : 'animate-connector-pulse bg-[#4285F4]'
              : isIdle ? 'bg-border/40' : 'bg-border';

          return (
            <div key={stage.id} className="flex items-center">
              <div className="flex items-center gap-1">
                <div className={cn('flex size-5 items-center justify-center rounded-full transition-all duration-300', dotStyle)}>
                  {isCurrentError ? (
                    <AlertTriangle className="size-3" strokeWidth={2.5} />
                  ) : isCompleted ? (
                    <Check className="size-3" strokeWidth={2.5} />
                  ) : isActive ? (
                    <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                  ) : (
                    <Icon className="size-3" strokeWidth={1.75} />
                  )}
                </div>
                <span className={cn('hidden text-[9px] font-bold leading-none tracking-[0.01em] md:block', labelStyle)}>
                  {stage.shortLabel}
                </span>
              </div>

              {idx < STAGES.length - 1 && (
                <div className={cn('mx-1 h-[2px] w-3 rounded-full transition-all duration-700 lg:w-5', connectorStyle)} />
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden min-w-[120px] max-w-[260px] truncate text-[10px] font-semibold text-[#4285F4]/80 lg:block">
        {isError
          ? stageMessage || 'Generation failed'
          : showHeartbeat
            ? `${stageMessage || 'Claude Code is working'} · ${elapsedSeconds}s`
            : stageMessage || ''}
      </div>
    </div>
  );
}
