'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Database,
  FileText,
  GitBranch,
  HelpCircle,
  Lightbulb,
  Maximize2,
  Minimize2,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '@/stores/use-app-store';
import type { AgentActivityEvent, AgentActivityStatus, AgentActivityType, WorkflowStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PipelineTracker } from '@/components/split/pipeline-tracker';

const STAGE_GROUPS: Array<{ stage: WorkflowStage; title: string; description: string }> = [
  { stage: 'intake', title: 'Request Intake', description: 'Jira story, file, and free-text intake — context consolidation' },
  { stage: 'analysis', title: 'Requirements Decomposition', description: 'Requirement classification, coverage gaps, assumptions, and confidence decisions' },
  { stage: 'schema_resolution', title: 'Schema Discovery', description: 'Dataset-scoped table and column candidates, confidence scoring, and gap identification' },
  { stage: 'sql_generation', title: 'Mapping & SQL Generation', description: 'Logical plan, source-to-target mappings, design decisions, and SQL artifact' },
  { stage: 'validation', title: 'Validation & Delivery', description: 'Dry-run checks, error diagnosis, fixes, Jira comment, and status transition' },
  { stage: 'ready', title: 'Delivery', description: 'SQL released and deployment actions' },
];

const TYPE_LABELS: Record<AgentActivityType, string> = {
  summary: 'Summary',
  observation: 'Observation',
  inference: 'Inference',
  decision: 'Decision',
  validation: 'Validation',
  error: 'Error',
  artifact: 'Artifact',
};

const TYPE_ICON: Record<AgentActivityType, typeof Bot> = {
  summary: ClipboardCheck,
  observation: Search,
  inference: Lightbulb,
  decision: GitBranch,
  validation: ShieldCheck,
  error: AlertTriangle,
  artifact: FileText,
};

const STATUS_ICON: Record<AgentActivityStatus, typeof CheckCircle2> = {
  running: CircleDashed,
  completed: CheckCircle2,
  warning: AlertTriangle,
  failed: XCircle,
  blocked: HelpCircle,
  pending: CircleDashed,
};

const STATUS_CLASS: Record<AgentActivityStatus, string> = {
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  blocked: 'border-orange-200 bg-orange-50 text-orange-700',
  pending: 'border-border bg-muted text-muted-foreground',
};

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function eventMatchesFilter(event: AgentActivityEvent, filter: AgentActivityType | 'all') {
  return filter === 'all' || event.type === filter;
}

// ── Compact Run Summary Card ─────────────────────────────────────
// Extracts review-worthy confidence items, key decisions, and key assumptions
// from the live activity stream so the architect sees a compact digest
// without mining the full activity log.

interface ConfidenceReviewItem {
  id: string;
  eventId?: string;
  filter: AgentActivityType;
  type: AgentActivityType;
  status: AgentActivityStatus;
  title: string;
  summary: string;
  confidence?: number;
  evidence?: string;
}

interface RunSummary {
  highlights: string[];
  decisions: string[];
  assumptions: string[];
  warnings: string[];
  reviewItems: ConfidenceReviewItem[];
}

function shortLine(value: string, limit = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function reviewPriority(event: AgentActivityEvent): number {
  const text = `${event.title} ${event.summary} ${(event.evidence || []).join(' ')}`.toLowerCase();
  const confidence = typeof event.confidence === 'number' ? event.confidence : 100;
  let score = 0;

  if (event.status === 'failed' || event.status === 'blocked') score += 1000;
  if (event.status === 'warning') score += 850;
  if (/validator|concern|unsupported|unsound|mismatch|risk|warning|failed/.test(text)) score += 700;
  if (event.type === 'inference') score += 180;
  if (event.type === 'decision') score += 90;
  if (typeof event.confidence === 'number') score += Math.max(0, 100 - confidence) * 5;
  if ((event.evidence || []).length > 0) score += 25;

  return score;
}

function buildRunSummary(events: AgentActivityEvent[]): RunSummary | null {
  const summaryEvents = events.filter((e) => e.type === 'summary');
  const decisionEvents = events.filter((e) => e.type === 'decision');
  const inferenceEvents = events.filter((e) => e.type === 'inference');
  const warningEvents = events.filter((e) => e.status === 'warning' || e.status === 'blocked' || e.status === 'failed');

  if (events.length === 0) return null;

  const compactLines = (items: AgentActivityEvent[], limit: number) => Array.from(new Set(
    items
      .map((e) => {
        const base = e.summary || e.title;
        const confidence = typeof e.confidence === 'number' ? ` (${e.confidence}% confidence)` : '';
        return `${base}${confidence}`;
      })
      .map((value) => value.trim())
      .filter(Boolean),
  )).slice(0, limit);

  const decisions = decisionEvents
    .sort((a, b) => b.timestamp - a.timestamp);

  const assumptions = inferenceEvents
    .sort((a, b) => b.timestamp - a.timestamp);

  const warnings = warningEvents
    .sort((a, b) => b.timestamp - a.timestamp);

  const reviewCandidates = Array.from(
    new Map(
      [...inferenceEvents, ...decisionEvents, ...warningEvents]
        .filter((event) => event.type === 'inference' || event.type === 'decision' || event.status !== 'completed')
        .map((event) => [event.id || `${event.timestamp}-${event.title}`, event]),
    ).values(),
  )
    .sort((a, b) => reviewPriority(b) - reviewPriority(a) || b.timestamp - a.timestamp)
    .slice(0, 3);

  const reviewItems = reviewCandidates.map((event) => ({
    id: event.id || `${event.timestamp}-${event.title}`,
    eventId: event.id,
    filter: event.type,
    type: event.type,
    status: event.status,
    title: shortLine(event.title, 72),
    summary: shortLine(event.summary || event.title, 130),
    confidence: typeof event.confidence === 'number' ? event.confidence : undefined,
    evidence: event.evidence?.[0] ? shortLine(event.evidence[0], 110) : undefined,
  }));

  return {
    highlights: compactLines(summaryEvents.sort((a, b) => b.timestamp - a.timestamp), 3),
    decisions: compactLines(decisions, 5),
    assumptions: compactLines(assumptions, 5),
    warnings: compactLines(warnings, 3),
    reviewItems,
  };
}

function SummaryList({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: typeof Bot;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/50 bg-background p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </p>
      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-2 text-[11px] font-medium leading-snug text-foreground/80">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#4285F4]/70" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] font-medium italic text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function RunSummaryCard({
  summary,
  onReviewItemClick,
}: {
  summary: RunSummary;
  onReviewItemClick: (item: ConfidenceReviewItem) => void;
}) {
  const { highlights, decisions, assumptions, warnings, reviewItems } = summary;

  return (
    <div className="shrink-0 rounded-lg border border-border/60 bg-muted/20 p-3 shadow-[0_1px_2px_0_oklch(0_0_0/0.04)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background text-muted-foreground">
            <ClipboardCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[12px] font-semibold text-foreground">Run Summary</h3>
            <p className="truncate text-[11px] font-medium text-muted-foreground">
              Confidence, assumptions, and decisions at a glance.
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-border/60 bg-background px-3 py-2 text-right">
          <p className="text-base font-bold tabular-nums leading-none text-foreground">{reviewItems.length}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Review items
          </p>
        </div>
      </div>

      <div className="mb-2 rounded-lg border border-border/50 bg-background p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Top Confidence Review Items
        </p>
        {reviewItems.length > 0 ? (
          <div className="grid gap-1.5">
            {reviewItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onReviewItemClick(item)}
                className="group flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <span className={cn(
                  'h-5 min-w-9 shrink-0 rounded border px-1.5 py-0.5 text-center text-[9px] font-bold tabular-nums',
                  item.status === 'warning' || item.status === 'blocked' ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : item.status === 'failed' ? 'border-red-200 bg-red-50 text-red-600'
                  : 'border-border bg-background text-muted-foreground',
                )}>
                  {typeof item.confidence === 'number' ? `${item.confidence}%` : TYPE_LABELS[item.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-foreground/85 group-hover:text-foreground">
                    {item.title}
                  </span>
                  <span className="block truncate text-[10px] font-medium text-muted-foreground">
                    {item.evidence || item.summary}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] font-medium italic text-muted-foreground">
            No confidence-scored assumptions or decisions have been reported yet.
          </p>
        )}
      </div>

      <div className="grid gap-2 xl:grid-cols-3">
        <SummaryList
          icon={ClipboardCheck}
          title="Highlights"
          items={highlights}
          empty="No compact run summary has been reported yet."
        />
        <SummaryList
          icon={Lightbulb}
          title="Assumptions"
          items={assumptions}
          empty="No explicit assumptions have been reported yet."
        />
        <SummaryList
          icon={GitBranch}
          title="Decisions"
          items={decisions}
          empty="No explicit decisions have been reported yet."
        />
      </div>

      {warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em]">
            <AlertTriangle className="size-3.5" />
            Review Notes
          </p>
          <ul className="space-y-1">
            {warnings.map((warning, index) => (
              <li key={`warning-${index}`} className="flex gap-2 text-[11px] font-medium leading-snug">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 break-words">{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function ActivityCard({ event, highlighted }: { event: AgentActivityEvent; highlighted?: boolean }) {
  const TypeIcon = TYPE_ICON[event.type];
  const StatusIcon = STATUS_ICON[event.status];

  return (
    <article
      id={event.id ? `activity-${event.id}` : undefined}
      className={cn(
        'rounded-xl border border-border/60 bg-background p-3 shadow-[0_1px_2px_0_oklch(0.2_0_0/0.04)] transition-colors',
        highlighted && 'border-primary/50 bg-primary/5 shadow-[0_0_0_2px_oklch(0.59_0.19_264/0.16)]',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground">
            <TypeIcon className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="text-[11px] font-semibold tracking-[-0.01em] text-foreground">
                {event.title}
              </h4>
              <span className="rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                {TYPE_LABELS[event.type]}
              </span>
              <span className="rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[9px] font-semibold capitalize text-muted-foreground">
                {event.source}
              </span>
              {typeof event.confidence === 'number' && (
                <span className="rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {event.confidence}% confidence
                </span>
              )}
            </div>
            <p className="mt-1 text-[10.5px] font-medium leading-relaxed text-foreground/80">
              {event.summary}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold capitalize', STATUS_CLASS[event.status])}>
            <StatusIcon className="size-3" />
            {event.status}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {formatTime(event.timestamp)}
          </span>
        </div>
      </div>

      {(event.details?.length || event.evidence?.length) && (
        <div className="space-y-2 border-t border-border/40 pt-2">
          {event.details?.length ? (
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
              <ul className="space-y-1">
                {event.details.map((detail, index) => (
                  <li key={index} className="flex gap-1.5 text-[10px] leading-snug text-muted-foreground">
                    <span className="mt-[5px] size-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {event.evidence?.length ? (
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
              <ul className="space-y-1">
                {event.evidence.map((item, index) => (
                  <li key={index} className="flex gap-1.5 text-[10px] leading-snug text-muted-foreground">
                    <span className="mt-[5px] size-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function ValidationSummaryPane() {
  const activityEvents = useAppStore((state) => state.activityEvents);
  const isAgentRunning = useAppStore((state) => state.isAgentRunning);
  const interactionState = useAppStore((state) => state.interactionState);
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<AgentActivityType | 'all'>('all');
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const visibleEvents = useMemo(
    () => activityEvents.filter((event) => (event.type as string) !== 'tool'),
    [activityEvents],
  );
  const filteredEvents = useMemo(
    () => filter === 'summary' ? [] : visibleEvents.filter((event) => eventMatchesFilter(event, filter)),
    [visibleEvents, filter],
  );
  const runSummary = useMemo(() => buildRunSummary(visibleEvents), [visibleEvents]);
  const showRunSummary = (filter === 'all' || filter === 'summary') && Boolean(runSummary);

  const handleReviewItemClick = (item: ConfidenceReviewItem) => {
    setFilter(item.filter);
    if (!item.eventId) return;

    setHighlightedEventId(item.eventId);
    window.setTimeout(() => {
      document.getElementById(`activity-${item.eventId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedEventId(null);
      highlightTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isExpanded]);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  return (
    <section
      className={cn(
        'h-full min-h-0 overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]',
        isExpanded && 'fixed inset-0 z-50 shadow-2xl',
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border/40 bg-muted/40 px-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#4285F4] px-2.5 py-1 text-xs font-semibold text-white shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
              <ClipboardCheck className="size-3 text-white/80" />
              <span>Activity Feed</span>
            </div>
            <PipelineTracker variant="compact" />
            {isAgentRunning && (
              <Badge variant="outline" className="border-border/70 bg-background text-muted-foreground">
                Running
              </Badge>
            )}
            {interactionState === 'awaiting_clarification' && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                Needs clarification
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  onClick={() => setIsExpanded((expanded) => !expanded)}
                >
                  {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  <span className="sr-only">{isExpanded ? 'Minimize activity pane' : 'Maximize activity pane'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className="text-xs">
                {isExpanded ? 'Minimize activity pane' : 'Maximize activity pane'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-border/40 bg-background px-3 py-2 custom-scrollbar">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            className="h-7 shrink-0 rounded-full px-2.5 text-[10px]"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          {(Object.keys(TYPE_LABELS) as AgentActivityType[]).map((type) => (
            <Button
              key={type}
              size="sm"
              variant={filter === type ? 'default' : 'outline'}
              className="h-7 shrink-0 rounded-full px-2.5 text-[10px]"
              onClick={() => setFilter(type)}
            >
              {TYPE_LABELS[type]}
            </Button>
          ))}
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto bg-background p-3 custom-scrollbar">
          {showRunSummary && runSummary ? (
            <RunSummaryCard summary={runSummary} onReviewItemClick={handleReviewItemClick} />
          ) : null}

          {filteredEvents.length === 0 && !showRunSummary ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center">
              <div>
                <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  {isAgentRunning ? <Sparkles className="size-4 animate-pulse" /> : <Database className="size-4" />}
                </div>
                <p className="text-xs font-semibold text-foreground">
                  {isAgentRunning ? 'Waiting for core Claude activity' : 'No activity events yet'}
                </p>
                <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                  Claude-reported findings, inferences, decisions, validations, and artifacts appear here with evidence and confidence. Pipeline milestones stay in the pipeline matrix.
                </p>
              </div>
            </div>
          ) : (
            STAGE_GROUPS.map((group) => {
              const groupEvents = filteredEvents.filter((event) => event.stage === group.stage);
              if (groupEvents.length === 0) return null;

              return (
                <section key={group.stage} className="space-y-2">
                  <div className="sticky top-0 z-10 rounded-lg border border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-[11px] font-semibold text-foreground">{group.title}</h3>
                        <p className="text-[10px] text-muted-foreground">{group.description}</p>
                      </div>
                      <Badge variant="outline" className="border-border/70 bg-background text-muted-foreground">
                        {groupEvents.length}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {groupEvents.map((event) => (
                      <ActivityCard
                        key={event.id || `${event.timestamp}-${event.title}`}
                        event={event}
                        highlighted={Boolean(event.id && event.id === highlightedEventId)}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
