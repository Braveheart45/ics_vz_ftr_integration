import { create } from 'zustand';
import type {
  SqlJob,
  ActivityEntry,
  PipelineStats,
  WorkflowStage,
  InputMode,
  JobStatus,
  DesignDecision,
  ExtractedRequirement,
} from '@/lib/types';
import { mockJobs, mockActivity, mockPipelineStats, WORKFLOW_STAGES } from '@/lib/mock-data';

// ============================================================
// Types
// ============================================================

type AppView = 'dashboard' | 'pipeline' | 'job-detail' | 'new-job' | 'activity' | 'settings';

interface AppState {
  // Navigation
  currentView: AppView;
  sidebarOpen: boolean;
  selectedJobId: string | null;

  // Data
  jobs: SqlJob[];
  activity: ActivityEntry[];
  pipelineStats: PipelineStats;

  // New Job form
  newJobInputMode: InputMode | null;

  // Filtering
  stageFilter: WorkflowStage | 'all';

  // ── Navigation Actions ───────────────────────────────────
  setCurrentView: (view: AppView) => void;
  setSidebarOpen: (open: boolean) => void;
  selectJob: (jobId: string) => void;
  goBack: () => void;

  // ── Job Actions ──────────────────────────────────────────
  createJob: (job: Partial<SqlJob>) => SqlJob;
  updateJob: (jobId: string, updates: Partial<SqlJob>) => void;
  advanceStage: (jobId: string) => void;

  // ── Requirement Actions ──────────────────────────────────
  confirmRequirement: (jobId: string, requirementId: string) => void;

  // ── Design Decision Actions ──────────────────────────────
  approveDecision: (jobId: string, decisionId: string, option: string) => void;
  rejectDecision: (jobId: string, decisionId: string) => void;

  // ── SQL Actions ──────────────────────────────────────────
  approveSql: (jobId: string, artifactId: string) => void;
  rejectSql: (jobId: string, artifactId: string) => void;

  // ── Filtering Actions ────────────────────────────────────
  setStageFilter: (stage: WorkflowStage | 'all') => void;

  // ── Selectors / Helpers ──────────────────────────────────
  getJob: (jobId: string) => SqlJob | undefined;
  getJobsByStage: (stage: WorkflowStage) => SqlJob[];
  getJobsByStatus: (status: JobStatus) => SqlJob[];
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Derive a JobStatus from a WorkflowStage.
 */
function deriveStatus(stage: WorkflowStage): JobStatus {
  switch (stage) {
    case 'intake':
    case 'requirement_analysis':
    case 'object_resolution':
    case 'schema_verification':
      return 'in_progress';
    case 'design_decisions':
      return 'needs_review';
    case 'sql_construction':
      return 'in_progress';
    case 'validation':
      return 'needs_approval';
    case 'delivery':
      return 'completed';
  }
}

/**
 * Return the index of a stage in WORKFLOW_STAGES (used to determine "next" stage).
 */
function stageIndex(stage: WorkflowStage): number {
  return WORKFLOW_STAGES.findIndex((s) => s.id === stage);
}

/**
 * Return a rough progress percentage for a given stage.
 */
function progressForStage(stage: WorkflowStage): number {
  const idx = stageIndex(stage);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / WORKFLOW_STAGES.length) * 100);
}

// ============================================================
// Store
// ============================================================

export const useAppStore = create<AppState>((set, get) => ({
  // ── Initial State ─────────────────────────────────────────
  currentView: 'dashboard',
  sidebarOpen: false,
  selectedJobId: null,

  jobs: mockJobs,
  activity: mockActivity,
  pipelineStats: mockPipelineStats,

  newJobInputMode: null,
  stageFilter: 'all',

  // ── Navigation Actions ───────────────────────────────────

  setCurrentView: (view) => {
    set({ currentView: view, sidebarOpen: false });
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
  },

  selectJob: (jobId) => {
    set({ selectedJobId: jobId, currentView: 'job-detail', sidebarOpen: false });
  },

  goBack: () => {
    set({ currentView: 'pipeline', selectedJobId: null });
  },

  // ── Job Actions ──────────────────────────────────────────

  createJob: (job) => {
    const now = new Date().toISOString();
    const newJob: SqlJob = {
      id: crypto.randomUUID(),
      title: job.title ?? 'Untitled Job',
      description: job.description ?? '',
      inputSource: job.inputSource ?? {
        type: 'jira',
        reference: '',
        summary: '',
        uploadedAt: now,
      },
      currentStage: 'intake',
      status: 'in_progress',
      requirements: job.requirements ?? [],
      schemaObjects: job.schemaObjects ?? [],
      designDecisions: job.designDecisions ?? [],
      sqlArtifacts: job.sqlArtifacts ?? [],
      progress: 2,
      priority: job.priority ?? 'medium',
      assignee: job.assignee,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      jobs: [newJob, ...state.jobs],
    }));

    get().addActivity({
      jobId: newJob.id,
      jobTitle: newJob.title,
      action: 'Job created',
      description: `New job "${newJob.title}" created and intake initiated.`,
      stage: 'intake',
      performedBy: newJob.assignee ?? 'System',
    });

    return newJob;
  },

  updateJob: (jobId, updates) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? { ...job, ...updates, updatedAt: new Date().toISOString() }
          : job,
      ),
    }));
  },

  advanceStage: (jobId) => {
    set((state) => ({
      jobs: state.jobs.map((job) => {
        if (job.id !== jobId) return job;

        const currentIdx = stageIndex(job.currentStage);
        if (currentIdx < 0 || currentIdx >= WORKFLOW_STAGES.length - 1) {
          // Already at the last stage or unknown — mark completed
          return {
            ...job,
            currentStage: 'delivery' as WorkflowStage,
            status: 'completed' as JobStatus,
            progress: 100,
            completedAt: job.completedAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }

        const nextStage = WORKFLOW_STAGES[currentIdx + 1].id;
        const newStatus = deriveStatus(nextStage);
        const newProgress = progressForStage(nextStage);

        return {
          ...job,
          currentStage: nextStage,
          status: newStatus,
          progress: newProgress,
          completedAt: nextStage === 'delivery' ? new Date().toISOString() : job.completedAt,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  },

  // ── Requirement Actions ──────────────────────────────────

  confirmRequirement: (jobId, requirementId) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              requirements: job.requirements.map((req) =>
                req.id === requirementId
                  ? { ...req, status: 'confirmed' as const }
                  : req,
              ),
              updatedAt: new Date().toISOString(),
            }
          : job,
      ),
    }));

    const job = get().getJob(jobId);
    if (job) {
      get().addActivity({
        jobId,
        jobTitle: job.title,
        action: 'Requirement confirmed',
        description: `Requirement ${requirementId} confirmed.`,
        stage: job.currentStage,
        performedBy: 'System',
      });
    }
  },

  // ── Design Decision Actions ──────────────────────────────

  approveDecision: (jobId, decisionId, option) => {
    const now = new Date().toISOString();

    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              designDecisions: job.designDecisions.map((dd) =>
                dd.id === decisionId
                  ? {
                      ...dd,
                      selectedOption: option,
                      status: 'approved' as const,
                      decidedBy: job.assignee ?? 'Unknown',
                      decidedAt: now,
                    }
                  : dd,
              ),
              updatedAt: now,
            }
          : job,
      ),
    }));

    const job = get().getJob(jobId);
    if (job) {
      const decision = job.designDecisions.find((dd) => dd.id === decisionId);
      get().addActivity({
        jobId,
        jobTitle: job.title,
        action: 'Design decision approved',
        description: `Decision "${decision?.title ?? decisionId}" approved. Selected: ${option}.`,
        stage: job.currentStage,
        performedBy: job.assignee ?? 'System',
      });
    }
  },

  rejectDecision: (jobId, decisionId) => {
    const now = new Date().toISOString();

    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              designDecisions: job.designDecisions.map((dd) =>
                dd.id === decisionId
                  ? {
                      ...dd,
                      status: 'rejected' as const,
                      decidedBy: job.assignee ?? 'Unknown',
                      decidedAt: now,
                    }
                  : dd,
              ),
              updatedAt: now,
            }
          : job,
      ),
    }));

    const job = get().getJob(jobId);
    if (job) {
      const decision = job.designDecisions.find((dd) => dd.id === decisionId);
      get().addActivity({
        jobId,
        jobTitle: job.title,
        action: 'Design decision rejected',
        description: `Decision "${decision?.title ?? decisionId}" rejected.`,
        stage: job.currentStage,
        performedBy: job.assignee ?? 'System',
      });
    }
  },

  // ── SQL Actions ──────────────────────────────────────────

  approveSql: (jobId, artifactId) => {
    const now = new Date().toISOString();

    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              sqlArtifacts: job.sqlArtifacts.map((art) =>
                art.id === artifactId
                  ? { ...art, status: 'approved' as const, updatedAt: now }
                  : art,
              ),
              updatedAt: now,
            }
          : job,
      ),
    }));

    const job = get().getJob(jobId);
    if (job) {
      const artifact = job.sqlArtifacts.find((a) => a.id === artifactId);
      get().addActivity({
        jobId,
        jobTitle: job.title,
        action: 'SQL artifact approved',
        description: `SQL artifact "${artifact?.name ?? artifactId}" approved.`,
        stage: job.currentStage,
        performedBy: job.assignee ?? 'System',
      });
    }
  },

  rejectSql: (jobId, artifactId) => {
    const now = new Date().toISOString();

    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              sqlArtifacts: job.sqlArtifacts.map((art) =>
                art.id === artifactId
                  ? { ...art, status: 'rejected' as const, updatedAt: now }
                  : art,
              ),
              updatedAt: now,
            }
          : job,
      ),
    }));

    const job = get().getJob(jobId);
    if (job) {
      const artifact = job.sqlArtifacts.find((a) => a.id === artifactId);
      get().addActivity({
        jobId,
        jobTitle: job.title,
        action: 'SQL artifact rejected',
        description: `SQL artifact "${artifact?.name ?? artifactId}" rejected.`,
        stage: job.currentStage,
        performedBy: job.assignee ?? 'System',
      });
    }
  },

  // ── Filtering Actions ────────────────────────────────────

  setStageFilter: (stage) => {
    set({ stageFilter: stage });
  },

  // ── Selectors / Helpers ──────────────────────────────────

  getJob: (jobId) => {
    return get().jobs.find((job) => job.id === jobId);
  },

  getJobsByStage: (stage) => {
    return get().jobs.filter((job) => job.currentStage === stage);
  },

  getJobsByStatus: (status) => {
    return get().jobs.filter((job) => job.status === status);
  },

  addActivity: (entry) => {
    const newEntry: ActivityEntry = {
      ...entry,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      activity: [newEntry, ...state.activity],
    }));
  },
}));
