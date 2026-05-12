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
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#1B2D4F] px-5 shadow-[0_1px_3px_0_oklch(0_0_0/0.12)]">
        {/* Left: Branding */}
        <div className="flex items-center gap-3">
          <div className="relative flex size-7 items-center justify-center rounded-lg bg-[#F97316] shadow-[0_1px_3px_0_oklch(0.65_0.2_45/0.35)]">
            <Database className="size-3.5 text-white" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-white">
              SQLForge
            </span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.08em] text-white/50 sm:inline">
              Agent
            </span>
          </div>
        </div>

        {/* Center: Session */}
        <div className="hidden items-center gap-2 md:flex">
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.06] px-2.5 py-1">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-mono tabular-nums text-white/50">
              {sessionId.slice(0, 8)}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-white/50 hover:text-white hover:bg-white/[0.08]"
              onClick={() => resetSession()}
            >
              <RotateCcw className="size-3.5" />
              <span className="sr-only">New Session</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>New Session</p>
          </TooltipContent>
        </Tooltip>
      </header>

      {/* ── Split Layout ────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left — SQL Output & Pipeline */}
        <div className="relative flex min-h-0 flex-1 flex-col border-r border-border/50 md:flex-[58]">
          <LeftPanel />
        </div>

        {/* Right — Intake & Interaction */}
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-[42] md:max-w-[520px] lg:max-w-[580px]">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
