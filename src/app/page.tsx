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
      {/* ── Header ─────────────────────────────────────── */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <Database className="size-3 text-background" />
          </div>
          <span className="text-sm font-semibold tracking-tight">SQLForge</span>
        </div>

        <div className="hidden items-center gap-2 text-[11px] text-muted-foreground/50 md:flex">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono">{sessionId.slice(0, 8)}</span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/60 hover:text-foreground"
              onClick={() => resetSession()}
            >
              <RotateCcw className="size-3" />
              <span className="sr-only">New Session</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">New Session</p>
          </TooltipContent>
        </Tooltip>
      </header>

      {/* ── Split Layout ──────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left — SQL Output & Pipeline */}
        <div className="relative flex min-h-0 flex-1 flex-col border-r md:flex-[58]">
          <LeftPanel />
        </div>

        {/* Right — Intake & Interaction */}
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-[42] md:max-w-[520px] lg:max-w-[560px]">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
