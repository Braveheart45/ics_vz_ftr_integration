'use client';

import { LeftPanel } from '@/components/split/left-panel';
import { RightPanel } from '@/components/split/right-panel';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/stores/use-app-store';

// ── SQLForge Logo Mark ────────────────────────────────────────
// A custom SVG logo that conveys SQL generation / data flow
function SqlForgeLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Stylized SQL bracket + spark */}
      <path
        d="M6 8C6 6.89543 6.89543 6 8 6H14C15.1046 6 16 6.89543 16 8V12L18 16L16 20V24C16 25.1046 15.1046 26 14 26H8C6.89543 26 6 25.1046 6 24V8Z"
        fill="white"
        opacity="0.9"
      />
      <path
        d="M26 8L24 12L22 8L20 12L22 16L24 12L26 16L28 12L26 8Z"
        fill="white"
        opacity="0.6"
      />
      {/* SQL text lines */}
      <rect x="8.5" y="10" width="5" height="1.2" rx="0.6" fill="#F97316" />
      <rect x="8.5" y="13" width="5" height="1.2" rx="0.6" fill="#F97316" opacity="0.7" />
      <rect x="8.5" y="16" width="3.5" height="1.2" rx="0.6" fill="#F97316" opacity="0.5" />
    </svg>
  );
}

export default function Home() {
  const resetSession = useAppStore((s) => s.resetSession);
  const sessionId = useAppStore((s) => s.sessionId);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="relative flex h-14 shrink-0 items-center justify-center border-b border-white/[0.06] px-5 shadow-[0_1px_4px_0_oklch(0_0_0/0.15)] animate-gradient-shift"
        style={{ background: 'linear-gradient(135deg, #1B2D4F 0%, #1E3A5F 25%, #1B2D4F 50%, #243B5F 75%, #1B2D4F 100%)' }}
      >
        {/* Subtle accent line at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F97316]/40 to-transparent" />

        {/* Center: Branding — main focus */}
        <div className="flex items-center gap-3">
          <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#F97316] to-[#EA580C] shadow-[0_2px_6px_0_oklch(0.65_0.22_45/0.4)] transition-transform duration-200 hover:scale-110 active:scale-95">
            <SqlForgeLogo className="size-5" />
          </div>
          <div className="flex flex-col items-start">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-[-0.02em] text-white leading-none">
                SQLForge
              </span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.1em] text-[#F97316]/90 sm:inline">
                Agent
              </span>
            </div>
            <span className="hidden text-[10px] font-medium tracking-[0.02em] text-white/45 sm:block leading-none mt-0.5">
              AI-Powered SQL Generation &amp; Conversion
            </span>
          </div>
        </div>

        {/* Left: Session (absolute positioned) */}
        <div className="absolute left-5 hidden items-center gap-2 md:flex">
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

        {/* Right: Reset (absolute positioned) */}
        <div className="absolute right-5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-white/40 hover:text-white hover:bg-white/[0.08] transition-all duration-200"
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
        </div>
      </header>

      {/* ── Split Layout ────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left — SQL Output & Pipeline */}
        <div className="animate-slide-in-left relative flex min-h-0 flex-1 flex-col border-r border-border/50 md:flex-[58]">
          <LeftPanel />
        </div>

        {/* Right — Intake & Interaction */}
        <div className="animate-slide-in-right relative flex min-h-0 flex-1 flex-col md:flex-[42] md:max-w-[520px] lg:max-w-[580px]">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
