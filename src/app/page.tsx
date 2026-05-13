'use client';

import { useEffect } from 'react';
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
// Custom icon: document + SQL lines + spark — conveys AI SQL generation
function SqlForgeLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Document body */}
      <path
        d="M7 6C7 4.89543 7.89543 4 9 4H21L27 10V30C27 31.1046 26.1046 32 25 32H9C7.89543 32 7 31.1046 7 30V6Z"
        fill="white"
        fillOpacity="0.92"
      />
      {/* Page fold */}
      <path
        d="M21 4V8C21 9.10457 21.8954 10 23 10H27L21 4Z"
        fill="white"
        fillOpacity="0.6"
      />
      {/* SQL keyword lines */}
      <rect x="11" y="14" width="10" height="2" rx="1" fill="#F97316" />
      <rect x="11" y="19" width="14" height="2" rx="1" fill="#F97316" fillOpacity="0.7" />
      <rect x="11" y="24" width="8" height="2" rx="1" fill="#F97316" fillOpacity="0.5" />
      {/* Spark */}
      <path
        d="M30 4L31.5 7.5L35 9L31.5 10.5L30 14L28.5 10.5L25 9L28.5 7.5L30 4Z"
        fill="#F97316"
        fillOpacity="0.9"
      />
      {/* Brackets — code feel */}
      <path d="M9 14L7 18L9 22" stroke="#4285F4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function Home() {
  const resetSession = useAppStore((s) => s.resetSession);
  const hydrateSession = useAppStore((s) => s.hydrateSession);
  const sessionId = useAppStore((s) => s.sessionId);

  // Generate session ID client-side only (prevents hydration mismatch)
  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  const isReady = sessionId !== '__pending__';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="relative flex h-[52px] shrink-0 items-center justify-center border-b border-white/[0.06] px-5 shadow-[0_1px_4px_0_oklch(0_0_0/0.15)] animate-gradient-shift"
        style={{ background: 'linear-gradient(135deg, #1B2D4F 0%, #1E3A5F 25%, #1B2D4F 50%, #243B5F 75%, #1B2D4F 100%)' }}
      >
        {/* Subtle accent line at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F97316]/40 to-transparent" />

        {/* Center: Branding — main focus */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#F97316] to-[#EA580C] shadow-[0_2px_8px_0_oklch(0.65_0.22_45/0.45)] transition-transform duration-200 hover:scale-110 active:scale-95">
            <SqlForgeLogo className="size-6" />
          </div>
          <div className="flex flex-col items-start">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[19px] font-bold tracking-[-0.025em] text-white leading-none">
                SQLForge
              </span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.1em] text-[#F97316] sm:inline">
                Agent
              </span>
            </div>
            <span className="hidden text-[11px] font-semibold tracking-[0.01em] text-white/70 sm:block leading-none mt-1">
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
            <span className="text-[10px] font-mono tabular-nums text-white/60">
              {isReady ? sessionId.slice(0, 8) : '...'}
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
