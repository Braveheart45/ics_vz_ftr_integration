'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ChevronLeft,
  Inbox,
  Search,
  Database,
  ShieldCheck,
  Layers,
  Code,
  CheckCircle,
  Rocket,
  GitMerge,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  FileText,
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  Eye,
  ArrowRight,
  Sparkles,
  CircleDot,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useAppStore } from '@/stores/use-app-store';
import { WORKFLOW_STAGES, STAGE_COLORS } from '@/lib/mock-data';
import type {
  WorkflowStage,
  JobStatus,
  ExtractedRequirement,
  SchemaObject,
  DesignDecision,
  SqlArtifact,
  ActivityEntry,
} from '@/lib/types';

// ============================================================
// Syntax Highlighter (lazy-safe dynamic import wrapper)
// ============================================================

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// ============================================================
// Stage Icon Map
// ============================================================

const STAGE_ICON_MAP: Record<WorkflowStage, React.ElementType> = {
  intake: Inbox,
  requirement_analysis: Search,
  object_resolution: Database,
  schema_verification: ShieldCheck,
  design_decisions: Layers,
  sql_construction: Code,
  validation: CheckCircle,
  delivery: Rocket,
};

// ============================================================
// Status / Input Mode Configs
// ============================================================

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; dotClass: string }
> = {
  in_progress: {
    label: 'In Progress',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    dotClass: 'bg-blue-500',
  },
  needs_review: {
    label: 'Needs Review',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  needs_approval: {
    label: 'Needs Approval',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    dotClass: 'bg-orange-500',
  },
  completed: {
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
  },
  failed: {
    label: 'Failed',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    dotClass: 'bg-red-500',
  },
  blocked: {
    label: 'Blocked',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300',
    dotClass: 'bg-gray-500',
  },
};

const INPUT_MODE_CONFIG: Record<string, { label: string; color: string }> = {
  jira: {
    label: 'JIRA',
    color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  },
  stm: {
    label: 'STM',
    color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  },
  legacy_sql: {
    label: 'SQL',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
};

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

const COMPLEXITY_BADGE_CLASS: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-green-50 text-green-700 border-green-200',
};

const SQL_TYPE_BADGE_CLASS: Record<string, string> = {
  ddl: 'bg-purple-100 text-purple-800',
  dml: 'bg-blue-100 text-blue-800',
  staging: 'bg-cyan-100 text-cyan-800',
  production: 'bg-emerald-100 text-emerald-800',
};

const SQL_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  review: { label: 'Review', color: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
};

const SCHEMA_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  verified: { label: 'Verified', color: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  unverified: { label: 'Unverified', color: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  not_found: { label: 'Not Found', color: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
};

// ============================================================
// Animation
// ============================================================

const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// ============================================================
// Helpers
// ============================================================

function getStageLabel(stageId: WorkflowStage): string {
  return WORKFLOW_STAGES.find((s) => s.id === stageId)?.label ?? stageId;
}

function getTimelineIcon(action: string): React.ElementType {
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
  if (lower.includes('delivered') || lower.includes('deployed')) return Rocket;
  if (lower.includes('intake')) return Inbox;
  return Activity;
}

function getTimelineIconColor(action: string): string {
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
// Copy to Clipboard Hook
// ============================================================

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  return { copiedId, copy };
}

// ============================================================
// Main Component
// ============================================================

export function JobDetailView() {
  const {
    selectedJobId,
    jobs,
    activity,
    goBack,
    advanceStage,
    confirmRequirement,
    approveDecision,
    rejectDecision,
    approveSql,
    rejectSql,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState('overview');
  const sqlSectionRef = useRef<HTMLDivElement>(null);
  const { copiedId, copy } = useCopyToClipboard();

  // ── Derived Data ──────────────────────────────────────

  const job = useMemo(
    () => jobs.find((j) => j.id === selectedJobId),
    [jobs, selectedJobId],
  );

  const jobActivity = useMemo(
    () =>
      activity
        .filter((a) => a.jobId === selectedJobId)
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
    [activity, selectedJobId],
  );

  const currentStageIndex = useMemo(
    () => WORKFLOW_STAGES.findIndex((s) => s.id === job?.currentStage),
    [job?.currentStage],
  );

  // ── Redirect guard ────────────────────────────────────

  if (!job || !selectedJobId) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">No job selected.</p>
        <Button variant="outline" onClick={goBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" />
          Back to Pipeline
        </Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[job.status];
  const inputCfg = INPUT_MODE_CONFIG[job.inputSource.type];
  const stageColor = STAGE_COLORS[job.currentStage];
  const canAdvance = job.status !== 'completed' && job.status !== 'failed';

  // ── Handlers ──────────────────────────────────────────

  const handleAdvance = () => advanceStage(job.id);
  const handleViewSql = () => {
    setActiveTab('sql');
    setTimeout(() => {
      sqlSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex flex-col gap-0">
      {/* ============================================================
          1. Sticky Header Bar
          ============================================================ */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3">
            {/* Row 1: Back + Title */}
            <div className="flex items-start gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5 shrink-0"
                onClick={goBack}
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="sr-only">Go back</span>
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold leading-tight tracking-tight">
                  {job.title}
                </h1>
                <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                  {job.inputSource.reference} &middot; {job.description}
                </p>
              </div>
            </div>

            {/* Row 2: Badges + Actions */}
            <div className="flex flex-wrap items-center gap-2 pl-12">
              <Badge
                variant="outline"
                className={`text-xs font-semibold uppercase ${inputCfg.color}`}
              >
                {inputCfg.label}
              </Badge>
              <Badge
                variant="outline"
                className="text-xs font-semibold uppercase"
                style={{
                  backgroundColor: `${stageColor}18`,
                  color: stageColor,
                  borderColor: `${stageColor}40`,
                }}
              >
                {getStageLabel(job.currentStage)}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs font-semibold uppercase ${statusCfg.color}`}
              >
                <span className={`mr-1 inline-block size-1.5 rounded-full ${statusCfg.dotClass}`} />
                {statusCfg.label}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs font-semibold uppercase ${PRIORITY_BADGE_CLASS[job.priority]}`}
              >
                {job.priority}
              </Badge>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Action Buttons */}
              {job.status === 'needs_review' && (
                <Button size="sm" className="gap-1.5" onClick={handleAdvance}>
                  <Eye className="h-4 w-4" />
                  Review Requirements
                </Button>
              )}
              {job.status === 'needs_approval' && (
                <Button size="sm" className="gap-1.5" onClick={handleAdvance}>
                  <ThumbsUp className="h-4 w-4" />
                  Approve Design
                </Button>
              )}
              {job.status === 'completed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleViewSql}
                >
                  <Code className="h-4 w-4" />
                  View SQL
                </Button>
              )}
              {canAdvance && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  onClick={handleAdvance}
                >
                  <ArrowRight className="h-4 w-4" />
                  Advance Stage
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          2. Stage Progress Tracker
          ============================================================ */}
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <ScrollArea className="w-full">
            <div className="flex items-start gap-0 pb-2">
              {WORKFLOW_STAGES.map((stage, index) => {
                const StageIcon = STAGE_ICON_MAP[stage.id];
                const isCompleted = index < currentStageIndex;
                const isCurrent = index === currentStageIndex;
                const isFuture = index > currentStageIndex;
                const stageColorValue = STAGE_COLORS[stage.id];
                const isIssueStage =
                  stage.id === 'design_decisions' &&
                  job.currentStage === 'design_decisions' &&
                  job.status === 'needs_review';

                return (
                  <div key={stage.id} className="flex flex-col items-center">
                    {/* Connector Line + Circle */}
                    <div className="flex items-center">
                      {/* Left Connector Line */}
                      {index > 0 && (
                        <div
                          className="h-0.5 w-6 sm:w-10 md:w-14 lg:w-16"
                          style={{
                            backgroundColor:
                              index <= currentStageIndex
                                ? '#22c55e'
                                : '#d1d5db',
                            borderStyle:
                              index > currentStageIndex ? 'dashed' : 'solid',
                            borderWidth: 1,
                            borderColor:
                              index > currentStageIndex ? '#d1d5db' : 'transparent',
                          }}
                        />
                      )}

                      {/* Stage Circle */}
                      <div className="relative flex flex-col items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`flex size-10 items-center justify-center rounded-full border-2 transition-all sm:size-11 ${
                                isCompleted
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : isCurrent
                                    ? 'text-white shadow-lg ring-4 ring-primary/20'
                                    : 'border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-900'
                              } ${isIssueStage ? 'border-amber-500 ring-4 ring-amber-100 dark:ring-amber-900/30' : ''}`}
                              style={
                                isCurrent
                                  ? {
                                      backgroundColor: stageColorValue,
                                      borderColor: stageColorValue,
                                    }
                                  : undefined
                              }
                            >
                              {isCompleted ? (
                                <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                              ) : (
                                <StageIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                              )}
                              {/* Pulse ring for current stage */}
                              {isCurrent && (
                                <span className="absolute inset-0 animate-ping rounded-full opacity-30" style={{ backgroundColor: stageColorValue }} />
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-medium">{stage.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {stage.description}
                            </p>
                          </TooltipContent>
                        </Tooltip>

                        {/* Issue indicator */}
                        {isIssueStage && (
                          <div className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500">
                            <AlertTriangle className="h-2.5 w-2.5 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Right Connector Line (invisible for last stage) */}
                      {index < WORKFLOW_STAGES.length - 1 && (
                        <div
                          className="h-0.5 w-6 sm:w-10 md:w-14 lg:w-16"
                          style={{
                            backgroundColor:
                              index < currentStageIndex
                                ? '#22c55e'
                                : '#d1d5db',
                            borderStyle:
                              index >= currentStageIndex ? 'dashed' : 'solid',
                            borderWidth: 1,
                            borderColor:
                              index >= currentStageIndex ? '#d1d5db' : 'transparent',
                          }}
                        />
                      )}
                    </div>

                    {/* Stage Label */}
                    <span
                      className={`mt-2 hidden text-center text-[10px] font-semibold leading-tight sm:block md:text-xs ${
                        isCompleted
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isCurrent
                            ? 'font-bold'
                            : 'text-gray-400'
                      }`}
                      style={isCurrent ? { color: stageColorValue } : undefined}
                    >
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Progress bar below tracker */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="font-medium">{job.progress}%</span>
            </div>
            <Progress value={job.progress} className="mt-1 h-2" />
          </div>
        </div>
      </div>

      {/* ============================================================
          3. Tab Content
          ============================================================ */}
      <div className="mx-auto max-w-6xl p-4 sm:p-6" ref={sqlSectionRef}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 w-full sm:w-fit">
            <TabsTrigger value="overview" className="gap-1.5">
              <Info className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="design" className="gap-1.5">
              <Layers className="h-4 w-4" />
              Design Decisions
            </TabsTrigger>
            <TabsTrigger value="sql" className="gap-1.5">
              <Code className="h-4 w-4" />
              SQL Artifacts
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1.5">
              <Clock className="h-4 w-4" />
              Timeline
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Overview ─────────────────────────────── */}
          <TabsContent value="overview">
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {/* Job Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    Job Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Description
                      </p>
                      <p className="text-sm">{job.description}</p>
                    </div>
                    <div className="space-y-3">
                      <InfoRow
                        label="Input Source"
                        value={`${inputCfg.label}: ${job.inputSource.reference}`}
                      />
                      <InfoRow
                        label="Summary"
                        value={job.inputSource.summary}
                      />
                      {job.inputSource.attachments && job.inputSource.attachments.length > 0 && (
                        <InfoRow
                          label="Attachments"
                          value={job.inputSource.attachments.join(', ')}
                        />
                      )}
                      <InfoRow
                        label="Assignee"
                        value={job.assignee ?? 'Unassigned'}
                      />
                      <InfoRow
                        label="Created"
                        value={format(new Date(job.createdAt), 'MMM d, yyyy h:mm a')}
                      />
                      <InfoRow
                        label="Updated"
                        value={format(new Date(job.updatedAt), 'MMM d, yyyy h:mm a')}
                      />
                      {job.completedAt && (
                        <InfoRow
                          label="Completed"
                          value={format(new Date(job.completedAt), 'MMM d, yyyy h:mm a')}
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Requirements Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    Requirements Summary
                    {job.requirements.length > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {job.requirements.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {job.requirements.length === 0 ? (
                    <EmptySection
                      icon={Search}
                      message="No requirements extracted yet. The job is still in the early stages."
                    />
                  ) : (
                    <div className="space-y-4">
                      {job.requirements.map((req) => (
                        <RequirementCard
                          key={req.id}
                          requirement={req}
                          jobId={job.id}
                          onConfirm={confirmRequirement}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Schema Objects */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    Schema Objects
                    {job.schemaObjects.length > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {job.schemaObjects.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {job.schemaObjects.length === 0 ? (
                    <EmptySection
                      icon={Database}
                      message="No schema objects resolved yet. Objects will appear once the job reaches the Object Resolution stage."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Database.Schema</TableHead>
                          <TableHead className="text-right">Columns</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {job.schemaObjects.map((obj) => (
                          <TableRow key={obj.name}>
                            <TableCell className="font-medium">{obj.name}</TableCell>
                            <TableCell className="capitalize text-muted-foreground">
                              {obj.type.replace('_', ' ')}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {obj.database}.{obj.schema}
                            </TableCell>
                            <TableCell className="text-right">{obj.columnCount}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`gap-1 text-xs ${SCHEMA_STATUS_CONFIG[obj.status].color}`}
                              >
                                <span className={`inline-block size-1.5 rounded-full ${SCHEMA_STATUS_CONFIG[obj.status].dot}`} />
                                {SCHEMA_STATUS_CONFIG[obj.status].label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* ── Tab 2: Design Decisions ────────────────────── */}
          <TabsContent value="design">
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {job.designDecisions.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                      <Layers className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm font-medium">No design decisions pending</p>
                    <p className="mt-1 text-center text-xs text-muted-foreground">
                      Design decisions will appear once the job reaches the Design Decisions stage.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                job.designDecisions.map((decision) => (
                  <DesignDecisionCard
                    key={decision.id}
                    decision={decision}
                    jobId={job.id}
                    onApprove={approveDecision}
                    onReject={rejectDecision}
                  />
                ))
              )}
            </motion.div>
          </TabsContent>

          {/* ── Tab 3: SQL Artifacts ───────────────────────── */}
          <TabsContent value="sql">
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {job.sqlArtifacts.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                      <Code className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm font-medium">No SQL artifacts yet</p>
                    <p className="mt-1 text-center text-xs text-muted-foreground">
                      SQL artifacts will be generated once the job reaches the SQL Construction stage.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                job.sqlArtifacts.map((artifact) => (
                  <SqlArtifactCard
                    key={artifact.id}
                    artifact={artifact}
                    jobId={job.id}
                    copiedId={copiedId}
                    onCopy={copy}
                    onApprove={approveSql}
                    onReject={rejectSql}
                  />
                ))
              )}
            </motion.div>
          </TabsContent>

          {/* ── Tab 4: Timeline ────────────────────────────── */}
          <TabsContent value="timeline">
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
            >
              {jobActivity.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                      <Clock className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm font-medium">No activity yet</p>
                    <p className="mt-1 text-center text-xs text-muted-foreground">
                      Activity entries will appear as the job progresses through its stages.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-muted-foreground" />
                      Activity Timeline
                    </CardTitle>
                    <CardDescription>
                      {jobActivity.length} event{jobActivity.length !== 1 ? 's' : ''} recorded
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative space-y-0">
                      {jobActivity.map((entry, index) => {
                        const IconComponent = getTimelineIcon(entry.action);
                        const iconColor = getTimelineIconColor(entry.action);
                        const isLast = index === jobActivity.length - 1;

                        return (
                          <div key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
                            {/* Timeline Line */}
                            {!isLast && (
                              <div className="absolute left-[15px] top-8 h-full w-px bg-border" />
                            )}

                            {/* Timeline Dot + Icon */}
                            <div
                              className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background ${iconColor}`}
                            >
                              <IconComponent className="h-3.5 w-3.5" />
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1 pt-0.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium leading-tight">
                                    {entry.action}
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                                    {entry.description}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDistanceToNow(new Date(entry.timestamp), {
                                    addSuffix: true,
                                  })}
                                </span>
                                <span className="text-gray-300">|</span>
                                <span>{entry.performedBy}</span>
                                <span className="text-gray-300">|</span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold uppercase"
                                  style={{
                                    backgroundColor: `${STAGE_COLORS[entry.stage]}18`,
                                    color: STAGE_COLORS[entry.stage],
                                    borderColor: `${STAGE_COLORS[entry.stage]}40`,
                                  }}
                                >
                                  {getStageLabel(entry.stage)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ============================================================
// Sub-Components
// ============================================================

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function EmptySection({
  icon: Icon,
  message,
}: {
  icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Requirement Card ────────────────────────────────────

function RequirementCard({
  requirement,
  jobId,
  onConfirm,
}: {
  requirement: ExtractedRequirement;
  jobId: string;
  onConfirm: (jobId: string, reqId: string) => void;
}) {
  const isAmbiguous = requirement.status === 'ambiguous';
  const isPendingReview = requirement.status === 'pending_review';

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <div
        className={`rounded-lg border p-4 ${isAmbiguous ? 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20' : 'border-border'}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium">{requirement.description}</p>
            {(requirement.sourceTable || requirement.targetTable) && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {requirement.sourceTable && (
                  <span className="font-mono text-xs">{requirement.sourceTable}</span>
                )}
                {requirement.sourceTable && requirement.targetTable && (
                  <ArrowRight className="h-3 w-3" />
                )}
                {requirement.targetTable && (
                  <span className="font-mono text-xs">{requirement.targetTable}</span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Transform:</span> {requirement.transformation}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs capitalize ${COMPLEXITY_BADGE_CLASS[requirement.complexity]}`}
            >
              {requirement.complexity}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs capitalize ${
                requirement.status === 'confirmed'
                  ? 'bg-emerald-100 text-emerald-800'
                  : requirement.status === 'ambiguous'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-gray-100 text-gray-800'
              }`}
            >
              {requirement.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>

        {/* Ambiguity warning */}
        {isAmbiguous && requirement.ambiguityNotes && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Ambiguity Detected
              </p>
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                {requirement.ambiguityNotes}
              </p>
            </div>
          </div>
        )}

        {/* Pending Review action */}
        {isPendingReview && (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onConfirm(jobId, requirement.id)}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Confirm Requirement
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Design Decision Card ────────────────────────────────

function DesignDecisionCard({
  decision,
  jobId,
  onApprove,
  onReject,
}: {
  decision: DesignDecision;
  jobId: string;
  onApprove: (jobId: string, decisionId: string, option: string) => void;
  onReject: (jobId: string, decisionId: string) => void;
}) {
  const [selectedOption, setSelectedOption] = useState<string | null>(
    decision.selectedOption ?? null,
  );

  const statusColor =
    decision.status === 'approved'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : decision.status === 'rejected'
        ? 'bg-red-100 text-red-800 border-red-200'
        : 'bg-amber-100 text-amber-800 border-amber-200';

  const isPending = decision.status === 'pending';

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{decision.title}</CardTitle>
              <CardDescription className="mt-1">
                {decision.description}
              </CardDescription>
            </div>
            <Badge variant="outline" className={`shrink-0 text-xs capitalize ${statusColor}`}>
              {decision.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Options */}
          <div className="space-y-2">
            {decision.options.map((option) => {
              const isSelected = selectedOption === option.label;
              const isRecommended = option.recommended;

              return (
                <div
                  key={option.label}
                  onClick={() => isPending && setSelectedOption(option.label)}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
                    isPending ? 'hover:bg-accent/50' : ''
                  } ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border'
                  }`}
                >
                  {/* Radio circle */}
                  <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2">
                    {isSelected && (
                      <div className="size-2 rounded-full bg-primary" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{option.label}</span>
                      {isRecommended && (
                        <Badge
                          variant="outline"
                          className="gap-1 bg-primary/10 text-[10px] font-semibold text-primary"
                        >
                          <Sparkles className="h-3 w-3" />
                          Recommended
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Approval info for approved decisions */}
          {decision.status === 'approved' && decision.decidedBy && decision.decidedAt && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/20">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-emerald-700 dark:text-emerald-400">
                Approved by <strong>{decision.decidedBy}</strong> on{' '}
                {format(new Date(decision.decidedAt), 'MMM d, yyyy h:mm a')}
                {decision.selectedOption && (
                  <>
                    {' '}
                    &mdash; Selected: <strong>{decision.selectedOption}</strong>
                  </>
                )}
              </span>
            </div>
          )}

          {/* Action buttons for pending decisions */}
          {isPending && (
            <div className="flex items-center gap-2 pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!selectedOption}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve Design Decision</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to approve &ldquo;{decision.title}&rdquo; with
                      the selected option: <strong>{selectedOption}</strong>?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (selectedOption) {
                          onApprove(jobId, decision.id, selectedOption);
                        }
                      }}
                    >
                      Approve
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" className="gap-1.5">
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reject Design Decision</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to reject &ldquo;{decision.title}&rdquo;? This will
                      mark the decision as rejected and may require re-evaluation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onReject(jobId, decision.id)}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Reject
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── SQL Artifact Card ───────────────────────────────────

function SqlArtifactCard({
  artifact,
  jobId,
  copiedId,
  onCopy,
  onApprove,
  onReject,
}: {
  artifact: SqlArtifact;
  jobId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  onApprove: (jobId: string, artifactId: string) => void;
  onReject: (jobId: string, artifactId: string) => void;
}) {
  const sqlStatusCfg = SQL_STATUS_CONFIG[artifact.status];
  const sqlTypeCfg = SQL_TYPE_BADGE_CLASS[artifact.type] ?? 'bg-gray-100 text-gray-700';
  const isCopied = copiedId === artifact.id;

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Code className="h-4 w-4 text-muted-foreground" />
                {artifact.name}
              </CardTitle>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className={`text-xs uppercase ${sqlTypeCfg}`}>
                  {artifact.type.replace('_', ' ')}
                </Badge>
                <Badge variant="outline" className={`text-xs ${sqlStatusCfg.color}`}>
                  {sqlStatusCfg.label}
                </Badge>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  BigQuery
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SQL Code Block */}
          <div className="overflow-hidden rounded-lg border">
            {/* Header bar */}
            <div className="flex items-center justify-between border-b bg-gray-900 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="inline-block size-3 rounded-full bg-red-500" />
                  <span className="inline-block size-3 rounded-full bg-yellow-500" />
                  <span className="inline-block size-3 rounded-full bg-green-500" />
                </div>
                <span className="ml-2 text-xs text-gray-400 font-mono">{artifact.name}.sql</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
                onClick={() => onCopy(artifact.sql, artifact.id)}
              >
                {isCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            {/* Code */}
            <div className="max-h-96 overflow-auto">
              <SyntaxHighlighter
                language="sql"
                style={oneDark}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: '13px',
                  lineHeight: '1.6',
                }}
                lineNumberStyle={{
                  minWidth: '3em',
                  paddingRight: '1em',
                  color: '#6b7280',
                  userSelect: 'none',
                }}
              >
                {artifact.sql}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Dry Run Results */}
          {artifact.dryRunResult && (
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <CircleDot className="h-4 w-4 text-muted-foreground" />
                Dry Run Results
                <Badge
                  variant="outline"
                  className={`ml-auto text-xs ${
                    artifact.dryRunResult.success
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {artifact.dryRunResult.success ? 'Success' : 'Failed'}
                </Badge>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3 rounded-lg border p-4">
                {artifact.dryRunResult.bytesProcessed !== undefined && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">Bytes Processed:</span>
                    <span className="font-medium">
                      {(artifact.dryRunResult.bytesProcessed / 1_000_000_000).toFixed(2)} GB
                    </span>
                  </div>
                )}
                {artifact.dryRunResult.slotsUsed !== undefined && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">Slots Used:</span>
                    <span className="font-medium">{artifact.dryRunResult.slotsUsed}</span>
                  </div>
                )}
                {artifact.dryRunResult.errors &&
                  artifact.dryRunResult.errors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-red-700">Errors</p>
                      {artifact.dryRunResult.errors.map((err, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
                        >
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          {err}
                        </div>
                      ))}
                    </div>
                  )}
                {artifact.dryRunResult.warnings &&
                  artifact.dryRunResult.warnings.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-amber-700">Warnings</p>
                      {artifact.dryRunResult.warnings.map((warn, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          {warn}
                        </div>
                      ))}
                    </div>
                  )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Validation Results */}
          {artifact.validationResult && (
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Validation Results
                <Badge
                  variant="outline"
                  className={`ml-auto text-xs ${
                    artifact.validationResult.valid
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {artifact.validationResult.valid ? 'Valid' : 'Invalid'}
                </Badge>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-4 rounded-lg border p-4">
                {/* Validation Errors */}
                {artifact.validationResult.errors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-red-700">
                      Errors ({artifact.validationResult.errors.length})
                    </p>
                    {artifact.validationResult.errors.map((err, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30"
                      >
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600" />
                          <span className="text-xs font-semibold uppercase text-red-700">
                            {err.severity} &middot; {err.code}
                          </span>
                          {err.lineNumber && (
                            <span className="text-xs text-muted-foreground">
                              Line {err.lineNumber}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-red-800 dark:text-red-300">{err.message}</p>
                        {err.suggestion && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                            <Info className="mt-0.5 h-3 w-3 shrink-0" />
                            {err.suggestion}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Validation Warnings */}
                {artifact.validationResult.warnings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-amber-700">
                      Warnings ({artifact.validationResult.warnings.length})
                    </p>
                    {artifact.validationResult.warnings.map((warn, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          <span className="text-xs font-semibold uppercase text-amber-700">
                            {warn.severity} &middot; {warn.code}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                          {warn.message}
                        </p>
                        {warn.suggestion && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                            <Info className="mt-0.5 h-3 w-3 shrink-0" />
                            {warn.suggestion}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* DQ Findings */}
                {artifact.validationResult.dqFindings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-violet-700">
                      Data Quality Findings ({artifact.validationResult.dqFindings.length})
                    </p>
                    {artifact.validationResult.dqFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30"
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold uppercase ${
                              finding.severity === 'high'
                                ? 'bg-red-100 text-red-700'
                                : finding.severity === 'medium'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {finding.severity}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-semibold uppercase"
                          >
                            {finding.type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-violet-800 dark:text-violet-300">
                          {finding.description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <strong>Affected:</strong> {finding.affectedObject}
                        </p>
                        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                          <Info className="mt-0.5 h-3 w-3 shrink-0" />
                          {finding.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* No issues */}
                {artifact.validationResult.errors.length === 0 &&
                  artifact.validationResult.warnings.length === 0 &&
                  artifact.validationResult.dqFindings.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-emerald-700">
                      <CheckCircle className="h-4 w-4" />
                      No issues found. SQL is valid.
                    </div>
                  )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Approve / Reject Buttons for review status */}
          {artifact.status === 'review' && (
            <div className="flex items-center gap-2 pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <ThumbsUp className="h-3.5 w-3.5" />
                    Approve SQL
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve SQL Artifact</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to approve <strong>{artifact.name}</strong>? This will
                      mark it as approved and ready for deployment.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onApprove(jobId, artifact.id)}>
                      Approve
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" className="gap-1.5">
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Reject SQL
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reject SQL Artifact</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to reject <strong>{artifact.name}</strong>? This will
                      require the SQL to be regenerated.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onReject(jobId, artifact.id)}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Reject
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
