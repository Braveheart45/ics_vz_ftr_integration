'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  ChevronRight,
  FilterX,
  ArrowUpDown,
  Plus,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useAppStore } from '@/stores/use-app-store';
import { WORKFLOW_STAGES, STAGE_COLORS } from '@/lib/mock-data';
import type { WorkflowStage, JobStatus, SqlJob } from '@/lib/types';

// ============================================================
// Constants
// ============================================================

type SortOption = 'newest' | 'oldest' | 'priority' | 'progress';

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest First',
  oldest: 'Oldest First',
  priority: 'Priority (High to Low)',
  progress: 'Progress (High to Low)',
};

const PRIORITY_COLORS: Record<SqlJob['priority'], string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

const PRIORITY_ORDER: Record<SqlJob['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string }
> = {
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  needs_review: { label: 'Needs Review', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  needs_approval: { label: 'Needs Approval', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  blocked: { label: 'Blocked', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300' },
};

const INPUT_MODE_CONFIG: Record<string, { label: string; color: string }> = {
  jira: { label: 'JIRA', color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  stm: { label: 'STM', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
  legacy_sql: { label: 'SQL', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
};

const STATUS_DOT_COLORS: Record<JobStatus, string> = {
  in_progress: 'bg-blue-500',
  needs_review: 'bg-amber-500',
  needs_approval: 'bg-orange-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  blocked: 'bg-gray-500',
};

// ============================================================
// Helpers
// ============================================================

function getStageCount(jobs: SqlJob[], stage: WorkflowStage | 'all'): number {
  if (stage === 'all') return jobs.length;
  return jobs.filter((j) => j.currentStage === stage).length;
}

function getStatusCounts(jobs: SqlJob[]): Record<string, number> {
  const counts: Record<string, number> = {
    in_progress: 0,
    needs_review: 0,
    needs_approval: 0,
    completed: 0,
    failed: 0,
  };
  for (const job of jobs) {
    if (job.status in counts) {
      counts[job.status]++;
    }
  }
  return counts;
}

function sortJobs(jobs: SqlJob[], sort: SortOption): SqlJob[] {
  const sorted = [...jobs];
  switch (sort) {
    case 'newest':
      return sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case 'oldest':
      return sorted.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    case 'priority':
      return sorted.sort(
        (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      );
    case 'progress':
      return sorted.sort((a, b) => b.progress - a.progress);
    default:
      return sorted;
  }
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getStageLabel(stageId: WorkflowStage): string {
  return WORKFLOW_STAGES.find((s) => s.id === stageId)?.label ?? stageId;
}

// ============================================================
// Component
// ============================================================

export function PipelineView() {
  const jobs = useAppStore((s) => s.jobs);
  const stageFilter = useAppStore((s) => s.stageFilter);
  const setStageFilter = useAppStore((s) => s.setStageFilter);
  const selectJob = useAppStore((s) => s.selectJob);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const statusCounts = useMemo(() => getStatusCounts(jobs), [jobs]);

  const filteredJobs = useMemo(() => {
    const base =
      stageFilter === 'all'
        ? jobs
        : jobs.filter((j) => j.currentStage === stageFilter);
    return sortJobs(base, sortBy);
  }, [jobs, stageFilter, sortBy]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* ── Title ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Overview</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage all SQL generation jobs through their workflow stages
          </p>
        </div>
        <Button
          size="sm"
          className="mt-2 w-fit gap-1.5"
          onClick={() => setCurrentView('new-job')}
        >
          <Plus className="size-4" />
          New Job
        </Button>
      </div>

      {/* ── Stats Badges ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatBadge label="Total" count={jobs.length} dotColor="bg-foreground" />
        <StatBadge label="In Progress" count={statusCounts.in_progress} dotColor={STATUS_DOT_COLORS.in_progress} />
        <StatBadge label="Needs Review" count={statusCounts.needs_review} dotColor={STATUS_DOT_COLORS.needs_review} />
        <StatBadge label="Needs Approval" count={statusCounts.needs_approval} dotColor={STATUS_DOT_COLORS.needs_approval} />
        <StatBadge label="Completed" count={statusCounts.completed} dotColor={STATUS_DOT_COLORS.completed} />
        <StatBadge label="Failed" count={statusCounts.failed} dotColor={STATUS_DOT_COLORS.failed} />
      </div>

      {/* ── Stage Filter Tabs ────────────────────────────────── */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-2 pb-2">
          <StageTab
            label="All Jobs"
            count={jobs.length}
            active={stageFilter === 'all'}
            onClick={() => setStageFilter('all')}
            color="#6b7280"
          />
          {WORKFLOW_STAGES.map((stage) => (
            <StageTab
              key={stage.id}
              label={stage.label}
              count={getStageCount(jobs, stage.id)}
              active={stageFilter === stage.id}
              onClick={() => setStageFilter(stage.id)}
              color={STAGE_COLORS[stage.id]}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* ── Sort + Count ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''} found
        </p>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="size-4 text-muted-foreground" />
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortOption)}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Job List ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onClick={() => selectJob(job.id)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Empty State ──────────────────────────────────────── */}
      {filteredJobs.length === 0 && <EmptyState />}
    </div>
  );
}

// ============================================================
// Sub-Components
// ============================================================

function StatBadge({
  label,
  count,
  dotColor,
}: {
  label: string;
  count: number;
  dotColor: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm">
      <span className={`inline-block size-2 rounded-full ${dotColor}`} />
      <span className="font-medium">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function StageTab({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
        active
          ? 'border-transparent text-white shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      style={
        active
          ? { backgroundColor: color }
          : undefined
      }
    >
      {label}
      <span
        className={`inline-flex size-5 items-center justify-center rounded-full text-xs font-semibold ${
          active ? 'bg-white/25 text-white' : 'bg-muted text-muted-foreground'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function JobCard({
  job,
  onClick,
}: {
  job: SqlJob;
  onClick: () => void;
}) {
  const stageColor = STAGE_COLORS[job.currentStage];
  const statusCfg = STATUS_CONFIG[job.status];
  const inputCfg = INPUT_MODE_CONFIG[job.inputSource.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className="cursor-pointer p-4 transition-shadow hover:shadow-md"
        onClick={onClick}
      >
        <div className="flex gap-3">
          {/* ── Priority Bar ──────────────────────────────── */}
          <div
            className={`w-1 shrink-0 rounded-full ${PRIORITY_COLORS[job.priority]}`}
          />

          {/* ── Main Content ──────────────────────────────── */}
          <div className="min-w-0 flex-1 space-y-2">
            {/* Top row */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold leading-tight">
                {job.title}
              </h3>
              <Badge
                variant="secondary"
                className={`border-transparent text-xs ${inputCfg.color}`}
              >
                {inputCfg.label}
              </Badge>
              <Badge
                variant="outline"
                className="text-xs capitalize"
              >
                {job.priority}
              </Badge>
            </div>

            {/* Description */}
            <p className="line-clamp-1 text-sm text-muted-foreground">
              {job.description}
            </p>

            {/* Bottom row */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant="secondary"
                className="border-transparent text-xs"
                style={{ backgroundColor: `${stageColor}20`, color: stageColor }}
              >
                {getStageLabel(job.currentStage)}
              </Badge>
              <Badge
                variant="secondary"
                className={`border-transparent text-xs ${statusCfg.color}`}
              >
                {statusCfg.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {format(new Date(job.createdAt), 'MMM d, yyyy')}
              </span>
              {job.assignee && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {getInitials(job.assignee)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{job.assignee}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* ── Right Side: Progress + Chevron ───────────── */}
          <div className="flex shrink-0 flex-col items-end justify-between gap-2 py-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {job.progress}%
            </span>
            <Progress
              value={job.progress}
              className="h-1.5 w-20"
            />
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function EmptyState() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <FilterX className="size-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-medium">No jobs found in this stage</p>
        <p className="text-sm text-muted-foreground">
          Try selecting a different stage filter or create a new job.
        </p>
      </div>
      <Button
        variant="outline"
        className="gap-1.5"
        onClick={() => setCurrentView('new-job')}
      >
        <Plus className="size-4" />
        Create a new job
      </Button>
    </motion.div>
  );
}
