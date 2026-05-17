import { create } from 'zustand';
import type {
  TaskType,
  WorkflowStage,
  ChatMessage,
  UploadedFile,
  JiraInput,
  BqProjectInput,
  SqlOutput,
  DetectedTaskInfo,
  ClarificationRequest,
  ClarificationHistoryEntry,
  AgentInteractionState,
  StmArtifact,
  StageStatus,
  ValidationSummary,
  AgentActivityEvent,
} from '@/lib/types';
import { createClientId } from '@/lib/id';
import { mergeActivityEvents, normalizeActivityEvent } from '@/lib/activity';

// ============================================================
// State Interface
// ============================================================

interface AppState {
  // ── Task Configuration ──────────────────────────────────
  taskType: TaskType;
  detectedTask: DetectedTaskInfo | null;
  setTaskType: (type: TaskType) => void;
  setDetectedTask: (info: DetectedTaskInfo | null) => void;

  // ── Jira Input ──────────────────────────────────────────
  jiraInput: JiraInput;
  setJiraInput: (input: Partial<JiraInput>) => void;

  // ── BigQuery Target Scope ────────────────────────────────
  bqProjectInput: BqProjectInput;
  setBqProjectInput: (input: Partial<BqProjectInput>) => void;

  // ── Contextual Input ────────────────────────────────────
  contextText: string;
  setContextText: (text: string) => void;
  uploadedFiles: UploadedFile[];
  addFile: (file: UploadedFile) => void;
  removeFile: (id: string) => void;

  // ── Chat / Conversation ─────────────────────────────────
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendToLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
  appendStreamingContent: (chunk: string) => void;
  clearStreamingContent: () => void;

  // ── SQL Output ──────────────────────────────────────────
  sqlOutput: SqlOutput | null;
  setSqlOutput: (output: SqlOutput | null) => void;
  updateSql: (sql: string) => void;
  isMaximized: boolean;
  toggleMaximize: () => void;

  // ── Pipeline ────────────────────────────────────────────
  currentStage: WorkflowStage;
  stageMessage: string;
  activeStages: WorkflowStage[];
  completedStages: WorkflowStage[];
  stageHistory: Array<{ stage: WorkflowStage; message: string; timestamp: number }>;
  setStage: (stage: WorkflowStage, message?: string, status?: StageStatus) => void;
  clearPipeline: () => void;

  // ── Agent ───────────────────────────────────────────────
  isAgentRunning: boolean;
  interactionState: AgentInteractionState;
  pendingClarification: ClarificationRequest | null;
  clarificationHistory: ClarificationHistoryEntry[];
  setAgentRunning: (running: boolean) => void;
  setInteractionState: (state: AgentInteractionState) => void;
  setPendingClarification: (clarification: ClarificationRequest | null) => void;
  recordClarificationAnswer: (selectedOptions: string[], freeText: string) => void;
  clearClarificationHistory: () => void;

  // ── STM Artifact ──────────────────────────────────────
  stmArtifact: StmArtifact | null;
  setStmArtifact: (artifact: StmArtifact | null) => void;
  validationSummary: ValidationSummary | null;
  setValidationSummary: (summary: ValidationSummary | null) => void;
  activityEvents: AgentActivityEvent[];
  addActivityEvent: (event: Partial<AgentActivityEvent>) => void;
  addActivityEvents: (events: Partial<AgentActivityEvent>[]) => void;
  clearActivityEvents: () => void;

  // ── Session ─────────────────────────────────────────────
  sessionId: string;
  hydrateSession: () => void;
  resetSession: () => void;
}

// ============================================================
// Helpers
// ============================================================

function generateSessionId(): string {
  return createClientId('session');
}

// ============================================================
// Initial State
// ============================================================

const initialState = {
  taskType: 'auto_detect' as TaskType,
  detectedTask: null as DetectedTaskInfo | null,

  jiraInput: { project: '', storyNumber: '' } as JiraInput,

  bqProjectInput: { projectId: '', datasetId: '' } as BqProjectInput,

  contextText: '',
  uploadedFiles: [] as UploadedFile[],

  messages: [] as ChatMessage[],
  isStreaming: false,
  streamingContent: '',

  sqlOutput: null as SqlOutput | null,
  isMaximized: false,

  currentStage: 'idle' as WorkflowStage,
  stageMessage: '',
  activeStages: [] as WorkflowStage[],
  completedStages: [] as WorkflowStage[],
  stageHistory: [] as Array<{ stage: WorkflowStage; message: string; timestamp: number }>,

  isAgentRunning: false,
  interactionState: 'idle' as AgentInteractionState,
  pendingClarification: null as ClarificationRequest | null,
  clarificationHistory: [] as ClarificationHistoryEntry[],
  stmArtifact: null as StmArtifact | null,
  validationSummary: null as ValidationSummary | null,
  activityEvents: [] as AgentActivityEvent[],

  sessionId: '__pending__',
};

const WORKFLOW_ORDER: WorkflowStage[] = [
  'intake',
  'analysis',
  'schema_resolution',
  'sql_generation',
  'validation',
  'ready',
];

function previousWorkflowStages(stage: WorkflowStage): WorkflowStage[] {
  const index = WORKFLOW_ORDER.indexOf(stage);
  return index > 0 ? WORKFLOW_ORDER.slice(0, index) : [];
}

// ============================================================
// Store
// ============================================================

export const useAppStore = create<AppState>((set) => ({
  // ── Initial State ─────────────────────────────────────────
  ...initialState,

  // ── Task Configuration ───────────────────────────────────

  setTaskType: (type) => {
    set({ taskType: type, detectedTask: null });
  },

  setDetectedTask: (info) => {
    set({ detectedTask: info });
  },

  // ── Jira Input ──────────────────────────────────────────

  setJiraInput: (input) => {
    set((state) => ({
      jiraInput: { ...state.jiraInput, ...input },
    }));
  },

  // ── BigQuery Target Scope ────────────────────────────────

  setBqProjectInput: (input) => {
    set((state) => ({
      bqProjectInput: { ...state.bqProjectInput, ...input },
    }));
  },

  // ── Contextual Input ────────────────────────────────────

  setContextText: (text) => {
    set({ contextText: text });
  },

  addFile: (file) => {
    set((state) => ({
      uploadedFiles: [...state.uploadedFiles, file],
    }));
  },

  removeFile: (id) => {
    set((state) => ({
      uploadedFiles: state.uploadedFiles.filter((f) => f.id !== id),
    }));
  },

  // ── Chat / Conversation ─────────────────────────────────

  addMessage: (message) => {
    const newMessage: ChatMessage = {
      ...message,
      id: createClientId('message'),
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, newMessage],
    }));
  },

  updateLastAssistantMessage: (content) => {
    set((state) => {
      const lastIdx = state.messages.reduceRight((found, m, i) => found === -1 && m.role === 'assistant' ? i : found, -1);
      if (lastIdx === -1) return state;
      const updatedMessages = [...state.messages];
      updatedMessages[lastIdx] = { ...updatedMessages[lastIdx], content };
      return { messages: updatedMessages };
    });
  },

  appendToLastAssistantMessage: (content) => {
    set((state) => {
      const lastIdx = state.messages.reduceRight((found, m, i) => found === -1 && m.role === 'assistant' ? i : found, -1);
      if (lastIdx === -1) return state;
      const updatedMessages = [...state.messages];
      updatedMessages[lastIdx] = {
        ...updatedMessages[lastIdx],
        content: updatedMessages[lastIdx].content + content,
      };
      return { messages: updatedMessages };
    });
  },

  setStreaming: (streaming) => {
    set({ isStreaming: streaming });
  },

  clearMessages: () => {
    set({ messages: [] });
  },

  appendStreamingContent: (chunk) => {
    set((state) => ({ streamingContent: state.streamingContent + chunk }));
  },

  clearStreamingContent: () => {
    set({ streamingContent: '' });
  },

  // ── SQL Output ──────────────────────────────────────────

  setSqlOutput: (output) => {
    if (output) {
      set({ sqlOutput: output });
    } else {
      set({ sqlOutput: null });
    }
  },

  updateSql: (sql) => {
    set((state) => {
      if (!state.sqlOutput) return state;
      return {
        sqlOutput: { ...state.sqlOutput, sql, isEdited: true },
      };
    });
  },

  toggleMaximize: () => {
    set((state) => ({ isMaximized: !state.isMaximized }));
  },

  // ── Pipeline ────────────────────────────────────────────

  setStage: (stage, message, status = 'active') => {
    set((state) => {
      if (stage === 'idle') {
        return { currentStage: 'idle' as WorkflowStage, stageMessage: '', activeStages: [] };
      }
      // Don't let a stray `active` status for an already-completed stage drag
      // the pipeline tracker (and the visible "current stage" / message)
      // backwards. Tool calls fire status events tagged with whatever stage
      // the bridge maps the tool to — those should narrate but never
      // regress the matrix.
      const incomingIndex = WORKFLOW_ORDER.indexOf(stage);
      const currentIndex = WORKFLOW_ORDER.indexOf(state.currentStage);
      const stageAlreadyCompleted = state.completedStages.includes(stage);
      const isRegression = status === 'active' && (stageAlreadyCompleted || (currentIndex > 0 && incomingIndex >= 0 && incomingIndex < currentIndex));

      let activeStages = [...state.activeStages];
      let completedStages = [...state.completedStages];
      for (const previousStage of previousWorkflowStages(stage)) {
        activeStages = activeStages.filter((s) => s !== previousStage);
        if (!completedStages.includes(previousStage)) completedStages = [...completedStages, previousStage];
      }
      if (status === 'completed') {
        activeStages = activeStages.filter((s) => s !== stage);
        if (!completedStages.includes(stage)) completedStages = [...completedStages, stage];
      } else if (status === 'active' && !activeStages.includes(stage) && !stageAlreadyCompleted) {
        activeStages = [...activeStages, stage];
      } else if (status === 'failed' || status === 'blocked') {
        // Terminal non-success states must clear any prior spinner.
        activeStages = activeStages.filter((s) => s !== stage);
      }

      // currentStage and stageMessage stay anchored to the furthest stage
      // already reached — regressions are dropped on the floor.
      const nextCurrentStage = isRegression ? state.currentStage : stage;
      const nextMessage = isRegression ? state.stageMessage : (message || '');

      return {
        currentStage: nextCurrentStage,
        stageMessage: nextMessage,
        activeStages,
        completedStages,
        stageHistory: [...state.stageHistory, { stage, message: message || '', timestamp: Date.now() }].slice(-100),
      };
    });
  },

  clearPipeline: () => {
    set({ currentStage: 'idle', stageMessage: '', activeStages: [], completedStages: [], stageHistory: [] });
  },

  // ── Agent ───────────────────────────────────────────────

  setAgentRunning: (running) => {
    set((state) => ({
      isAgentRunning: running,
      interactionState: running
        ? 'processing'
        : state.interactionState === 'processing'
          ? 'idle'
          : state.interactionState,
    }));
  },

  setInteractionState: (state) => {
    set({ interactionState: state });
  },

  setPendingClarification: (clarification) => {
    set((state) => {
      // Append to the per-session clarification history the moment Claude
      // asks a new question. Each entry remains for the rest of the session
      // (even after the user answers) so the architect can review the full
      // dialog: question, options offered, what they picked, what context
      // they added.
      let history = state.clarificationHistory;
      if (clarification) {
        const last = history[history.length - 1];
        const isDuplicate = last && last.message === clarification.message && !last.answeredAt;
        if (!isDuplicate) {
          history = [
            ...history,
            {
              id: createClientId('clarif'),
              message: clarification.message,
              explanation: clarification.explanation,
              details: clarification.details,
              options: clarification.options,
              allowFreeText: clarification.allowFreeText,
              askedAt: Date.now(),
            },
          ];
        }
      }
      return {
        pendingClarification: clarification,
        clarificationHistory: history,
        interactionState: clarification ? 'awaiting_clarification' : state.interactionState,
        isAgentRunning: clarification ? false : state.isAgentRunning,
      };
    });
  },

  recordClarificationAnswer: (selectedOptions, freeText) => {
    set((state) => {
      if (state.clarificationHistory.length === 0) return state;
      const lastIndex = state.clarificationHistory.length - 1;
      const last = state.clarificationHistory[lastIndex];
      if (last.answeredAt) return state; // Already answered.
      const updated = [...state.clarificationHistory];
      updated[lastIndex] = {
        ...last,
        selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
        freeText: freeText.trim() ? freeText.trim() : undefined,
        answeredAt: Date.now(),
      };
      return { clarificationHistory: updated };
    });
  },

  clearClarificationHistory: () => {
    set({ clarificationHistory: [] });
  },

  // ── STM Artifact ──────────────────────────────────────

  setStmArtifact: (artifact) => {
    set({ stmArtifact: artifact });
  },

  setValidationSummary: (summary) => {
    set({ validationSummary: summary });
  },

  addActivityEvent: (event) => {
    set((state) => ({
      activityEvents: mergeActivityEvents(state.activityEvents, [normalizeActivityEvent(event)]),
    }));
  },

  addActivityEvents: (events) => {
    set((state) => ({
      activityEvents: mergeActivityEvents(state.activityEvents, events),
    }));
  },

  clearActivityEvents: () => {
    set({ activityEvents: [] });
  },

  // ── Session ─────────────────────────────────────────────
  hydrateSession: () => {
    // Generate sessionId only once on the client (avoids hydration mismatch)
    const current = useAppStore.getState().sessionId;
    if (current === '__pending__') {
      set({ sessionId: generateSessionId() });
    }
  },

  resetSession: () => {
    set({ ...initialState, sessionId: generateSessionId(), activeStages: [], completedStages: [], stageHistory: [], streamingContent: '', validationSummary: null, activityEvents: [], clarificationHistory: [] });
  },
}));
