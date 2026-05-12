'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Plus,
  GitBranch,
  Activity,
  ChevronRight,
  FileText,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Code,
  Package,
  Inbox,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/stores/use-app-store';
import { WORKFLOW_STAGES, STAGE_COLORS } from '@/lib/mock-data';
import type { WorkflowStage, SqlJob, ActivityEntry } from '@/lib/types';

// ============================================================
// Animation Variants
// ============================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: 'easeOut' },
  },
};

// ============================================================
// Helpers
// ============================================================

function getPriorityColor(priority: SqlJob['priority']): string {
  switch (priority) {
    case 'critical':
      return 'border-l-red-500';
    case 'high':
      return 'border-l-orange-500';
    case 'medium':
      return 'border-l-yellow-500';
    case 'low':
      return 'border-l-green-500';
  }
}

function getPriorityBadgeClass(priority: SqlJob['priority']): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'high':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'low':
      return 'bg-green-100 text-green-700 border-green-200';
  }
}

function getStageColorStyle(stage: WorkflowStage): React.CSSProperties {
  const color = STAGE_COLORS[stage];
  return {
    backgroundColor: `${color}18`,
    color: color,
    borderColor: `${color}40`,
  };
}

function getInputModeBadge(mode: string): { label: string; className: string } {
  switch (mode) {
    case 'jira':
      return { label: 'JIRA', className: 'bg-violet-100 text-violet-700 border-violet-200' };
    case 'stm':
      return { label: 'STM', className: 'bg-cyan-100 text-cyan-700 border-cyan-200' };
    case 'legacy_sql':
      return { label: 'SQL', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    default:
      return { label: mode.toUpperCase(), className: '' };
  }
}

function getActivityIcon(action: string) {
  const lower = action.toLowerCase();
  if (lower.includes('created') || lower.includes('uploaded')) return FileText;
  if (lower.includes('approved') || lower.includes('completed') || lower.includes('delivered'))
    return CheckCircle;
  if (lower.includes('warning') || lower.includes('ambiguity') || lower.includes('failed'))
    return AlertTriangle;
  if (lower.includes('validation') || lower.includes('verified')) return ShieldCheck;
  if (lower.includes('generated') || lower.includes('draft') || lower.includes('construction'))
    return Code;
  if (lower.includes('pending') || lower.includes('review')) return AlertCircle;
  if (lower.includes('delivered') || lower.includes('deployed')) return Package;
  if (lower.includes('intake')) return Inbox;
  return Activity;
}

function getActivityIconColor(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('approved') || lower.includes('completed') || lower.includes('delivered'))
    return 'text-emerald-500';
  if (lower.includes('warning') || lower.includes('ambiguity') || lower.includes('failed'))
    return 'text-amber-500';
  if (lower.includes('pending') || lower.includes('review'))
    return 'text-orange-500';
  if (lower.includes('generated') || lower.includes('draft'))
    return 'text-blue-500';
  if (lower.includes('created') || lower.includes('uploaded'))
    return 'text-violet-500';
  return 'text-muted-foreground';
}

// ============================================================
// Metric Card Data
// ============================================================

interface MetricCardDef {
  label: string;
  description: string;
  bgClass: string;
  textClass: string;
  getValue: (stats: ReturnType<typeof useAppStore.getState>['pipelineStats'], jobs: SqlJob[]) => number;
}

const METRIC_CARDS: MetricCardDef[] = [
  {
    label: 'Total Jobs',
    description: 'IN PIPELINE',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    getValue: (stats) => stats.totalJobs,
  },
  {
    label: 'In Intake',
    description: 'AWAITING ANALYSIS',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    getValue: (_stats, jobs) => jobs.filter((j) => j.currentStage === 'intake').length,
  },
  {
    label: 'Analyzing',
    description: 'IN PROGRESS',
    bgClass: 'bg-violet-50',
    textClass: 'text-violet-700',
    getValue: (_stats, jobs) =>
      jobs.filter((j) =>
        ['requirement_analysis', 'object_resolution', 'schema_verification'].includes(j.currentStage)
      ).length,
  },
  {
    label: 'Needs Review',
    description: 'ACTION REQUIRED',
    bgClass: 'bg-rose-50',
    textClass: 'text-rose-700',
    getValue: (stats) => stats.needsReview,
  },
  {
    label: 'Validated',
    description: 'READY TO DEPLOY',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    getValue: (stats) => stats.approved,
  },
  {
    label: 'Deployed',
    description: 'DELIVERED',
    bgClass: 'bg-sky-50',
    textClass: 'text-sky-700',
    getValue: (_stats, jobs) => jobs.filter((j) => j.currentStage === 'delivery').length,
  },
];

// ============================================================
// Component
// ============================================================

export function DashboardView() {
  const { jobs, pipelineStats, activity, setCurrentView, selectJob } = useAppStore();

  // --- Derived data ---
  const attentionJobs = useMemo(
    () => jobs.filter((j) => j.status === 'needs_review' || j.status === 'needs_approval').slice(0, 5),
    [jobs]
  );

  const recentActivity = useMemo(() => activity.slice(0, 6), [activity]);

  const activeWorkflows = useMemo(
    () => jobs.filter((j) => j.status === 'in_progress').length,
    [jobs]
  );

  const stageBreakdown = useMemo(() => {
    const breakdown = WORKFLOW_STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      color: STAGE_COLORS[stage.id],
      count: jobs.filter((j) => j.currentStage === stage.id).length,
    }));
    const total = breakdown.reduce((sum, s) => sum + s.count, 0);
    return { stages: breakdown, total };
  }, [jobs]);

  // --- Handlers ---
  const handleNewJob = () => setCurrentView('new-job');
  const handleViewPipeline = () => setCurrentView('pipeline');
  const handleViewActivity = () => setCurrentView('activity');
  const handleJobClick = (jobId: string) => selectJob(jobId);

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================
          1. Hero Section
          ============================================================ */}
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl border-b bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 p-6 md:p-8"
      >
        {/* Status line */}
        <div className="mb-3 flex items-center gap-2">
          <span className="sr-only">Agent status: online</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
            Agent Online
          </span>
        </div>

        {/* Headline */}
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">
          SQL Generation &amp; Modernization
        </h1>

        {/* Subheadline */}
        <p className="mb-5 max-w-2xl text-sm text-gray-600 md:text-base">
          Managing {pipelineStats.totalJobs} pipeline jobs across{' '}
          {activeWorkflows} active workflows.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleNewJob} className="gap-2">
            <Plus className="h-4 w-4" />
            New SQL Job
          </Button>
          <Button variant="outline" onClick={handleViewPipeline} className="gap-2">
            <GitBranch className="h-4 w-4" />
            View Pipeline
          </Button>
          <Button variant="outline" onClick={handleViewActivity} className="gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </Button>
        </div>
      </motion.section>

      {/* ============================================================
          2. Metric Cards
          ============================================================ */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6"
      >
        {METRIC_CARDS.map((metric) => {
          const value = metric.getValue(pipelineStats, jobs);
          return (
            <motion.div key={metric.label} variants={itemVariants}>
              <Card
                className={`py-0 gap-0 border-0 shadow-none transition-shadow hover:shadow-md ${metric.bgClass}`}
              >
                <CardContent className="p-4">
                  <div className={`text-3xl font-bold ${metric.textClass}`}>{value}</div>
                  <div className="mt-1 text-sm font-medium text-gray-700">{metric.label}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{metric.description}</div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ============================================================
          3. Two-Column Layout
          ============================================================ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ---- Left: Jobs Requiring Attention ---- */}
        <motion.section
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
                Jobs Requiring Attention
              </h2>
              {attentionJobs.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {attentionJobs.length}
                </Badge>
              )}
            </div>
          </div>

          {attentionJobs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex items-center justify-center py-10">
                <div className="text-center">
                  <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                  <p className="text-sm text-muted-foreground">
                    All jobs are on track. No immediate action required.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {attentionJobs.map((job) => {
                const inputModeBadge = getInputModeBadge(job.inputSource.type);
                const stageLabel =
                  WORKFLOW_STAGES.find((s) => s.id === job.currentStage)?.label ?? job.currentStage;
                return (
                  <motion.div key={job.id} variants={itemVariants} initial="hidden" animate="visible">
                    <Card
                      className={`cursor-pointer border-l-4 ${getPriorityColor(job.priority)} gap-0 py-0 transition-shadow hover:shadow-md`}
                      onClick={() => handleJobClick(job.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-gray-900">{job.title}</p>
                            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                              {job.description}
                            </p>
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold uppercase ${inputModeBadge.className}`}
                              >
                                {inputModeBadge.label}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="text-[10px] font-semibold uppercase"
                                style={getStageColorStyle(job.currentStage)}
                              >
                                {stageLabel}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold uppercase ${getPriorityBadgeClass(job.priority)}`}
                              >
                                {job.priority}
                              </Badge>
                            </div>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.section>

        {/* ---- Right: Recent Activity ---- */}
        <motion.section
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
              Recent Activity
            </h2>
            <button
              onClick={handleViewActivity}
              className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              View all &rarr;
            </button>
          </div>

          <Card className="gap-0 py-0">
            <CardContent className="divide-y p-0">
              {recentActivity.map((entry: ActivityEntry) => {
                const IconComponent = getActivityIcon(entry.action);
                const iconColor = getActivityIconColor(entry.action);
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 px-4 py-3 first:pt-4 last:pb-4"
                  >
                    <div className="mt-0.5">
                      <IconComponent className={`h-4 w-4 ${iconColor}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-700">{entry.description}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {formatDistanceToNow(new Date(entry.timestamp), {
                            addSuffix: true,
                          })}
                        </span>
                        <span className="text-gray-300">|</span>
                        <span className="truncate">{entry.jobTitle}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.section>
      </div>

      {/* ============================================================
          4. Stage Breakdown Bar
          ============================================================ */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">
          Pipeline Stage Breakdown
        </h2>
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            {stageBreakdown.total === 0 ? (
              <p className="text-center text-sm text-muted-foreground">No jobs in pipeline yet.</p>
            ) : (
              <div className="flex h-8 w-full overflow-hidden rounded-md">
                {stageBreakdown.stages.map((stage) => {
                  if (stage.count === 0) return null;
                  const widthPercent = (stage.count / stageBreakdown.total) * 100;
                  return (
                    <Tooltip key={stage.id}>
                      <TooltipTrigger asChild>
                        <div
                          className="flex items-center justify-center transition-opacity hover:opacity-80"
                          style={{
                            width: `${widthPercent}%`,
                            minWidth: stage.count > 0 ? '2rem' : '0',
                            backgroundColor: stage.color,
                            color: '#fff',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          {widthPercent > 10 ? `${stage.count}` : ''}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {stage.label}: {stage.count} job{stage.count !== 1 ? 's' : ''}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}
            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {stageBreakdown.stages.map((stage) => (
                <div key={stage.id} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-xs text-gray-500">
                    {stage.label}{' '}
                    <span className="font-medium text-gray-700">({stage.count})</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
