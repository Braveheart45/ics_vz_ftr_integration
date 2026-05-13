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
// BigQuery-inspired magnifying glass over database cylinder
// with AI sparkle neural nodes — orange color scheme
function SqlForgeLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Database cylinder body */}
      <ellipse cx="14" cy="9" rx="8" ry="3" fill="white" fillOpacity="0.95" />
      <rect x="6" y="9" width="16" height="16" fill="white" fillOpacity="0.9" />
      <ellipse cx="14" cy="25" rx="8" ry="3" fill="white" fillOpacity="0.85" />

      {/* Cylinder side edges */}
      <line x1="6" y1="9" x2="6" y2="25" stroke="white" strokeWidth="0.5" strokeOpacity="0.6" />
      <line x1="22" y1="9" x2="22" y2="25" stroke="white" strokeWidth="0.5" strokeOpacity="0.6" />

      {/* Top ellipse stroke */}
      <ellipse cx="14" cy="9" rx="8" ry="3" stroke="white" strokeWidth="0.75" fill="none" strokeOpacity="0.5" />

      {/* SQL code lines on database */}
      <rect x="9" y="13" width="10" height="1.5" rx="0.75" fill="#F97316" />
      <rect x="9" y="16.5" width="6" height="1.5" rx="0.75" fill="#F97316" fillOpacity="0.7" />
      <rect x="9" y="20" width="8" height="1.5" rx="0.75" fill="#F97316" fillOpacity="0.5" />

      {/* Magnifying glass */}
      <circle cx="21" cy="19" r="5.5" stroke="white" strokeWidth="1.8" fill="white" fillOpacity="0.15" />
      <line x1="25" y1="23" x2="30" y2="28" stroke="white" strokeWidth="2.2" strokeLinecap="round" />

      {/* AI sparkle — top right (large) */}
      <path
        d="M31 5L32 7.5L34.5 8.5L32 9.5L31 12L30 9.5L27.5 8.5L30 7.5L31 5Z"
        fill="#F97316"
      />
      {/* AI sparkle — small (mid right) */}
      <path
        d="M33 15L33.6 16.2L35 16.6L33.6 17L33 18.2L32.4 17L31 16.6L32.4 16.2L33 15Z"
        fill="#FB923C"
        fillOpacity="0.85"
      />
      {/* AI sparkle — tiny (bottom) */}
      <path
        d="M28 30L28.4 30.8L29.2 31L28.4 31.2L28 32L27.6 31.2L26.8 31L27.6 30.8L28 30Z"
        fill="#FDBA74"
        fillOpacity="0.9"
      />

      {/* Neural connection dots (AI feel) */}
      <circle cx="26" cy="4" r="0.8" fill="#F97316" fillOpacity="0.5" />
      <circle cx="29" cy="2" r="0.6" fill="#FDBA74" fillOpacity="0.4" />
      <circle cx="24" cy="1.5" r="0.5" fill="#FB923C" fillOpacity="0.3" />
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
      <header className="relative flex h-[52px] shrink-0 items-center justify-center border-b border-white/[0.06] px-5 shadow-[0_1px_4px_0_oklch(0_0_0/0.15)] bg-[#1B2D4F]">
        {/* Subtle accent line at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F97316]/40 to-transparent" />

        {/* Center: Branding — main focus */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-md transition-transform duration-200 hover:scale-110 active:scale-95">
            <SqlForgeLogo className="size-6" />
          </div>
          <div className="flex flex-col items-start">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[19px] font-bold tracking-[-0.025em] text-white leading-none">
                SQLForge
              </span>
              <span className="hidden text-[10px] font-bold uppercase tracking-[0.1em] text-orange-400 sm:inline">
                Agent
              </span>
            </div>
            <span className="hidden text-[11px] font-medium tracking-[0.01em] text-white/60 sm:block leading-none mt-1">
              AI-Powered BigQuery SQL Generation
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
