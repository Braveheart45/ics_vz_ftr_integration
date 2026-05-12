'use client';

import { LeftPanel } from '@/components/split/left-panel';
import { RightPanel } from '@/components/split/right-panel';
import { Database, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/stores/use-app-store';

export default function Home() {
  const resetSession = useAppStore((s) => s.resetSession);
  const sessionId = useAppStore((s) => s.sessionId);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ── Top Header Bar ──────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
        {/* Left: Branding */}
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
            <Database className="size-3.5 text-primary-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">SQLForge</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-widest text-muted-foreground sm:inline">
              AI SQL Agent
            </span>
          </div>
        </div>

        {/* Center: Session info */}
        <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
          <span>Session Active</span>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-[10px]">{sessionId.slice(0, 8)}</span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => resetSession()}
              >
                <RotateCcw className="size-3.5" />
                <span className="sr-only">New Session</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>New Session</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Split Panel Layout ──────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left Panel — SQL Output & Pipeline (~58%) */}
        <div className="relative flex min-h-0 flex-1 flex-col border-r md:flex-[58]">
          <LeftPanel />
        </div>

        {/* Right Panel — Intake & Interaction (~42%) */}
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-[42] md:max-w-[520px] lg:max-w-[580px]">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
