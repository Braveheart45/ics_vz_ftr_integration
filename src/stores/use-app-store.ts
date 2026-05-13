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
  ToolCallLog,
  ClarificationRequest,
  AgentInteractionState,
} from '@/lib/types';

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

  // ── BigQuery Project ─────────────────────────────────────
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
  toolLogs: ToolCallLog[];
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendToLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;

  // ── Tool Call Logs ──────────────────────────────────────
  addToolLog: (log: Omit<ToolCallLog, 'id' | 'timestamp'>) => void;
  updateToolLog: (tool: string, status: ToolCallLog['status'], summary: string) => void;
  clearToolLogs: () => void;

  // ── SQL Output ──────────────────────────────────────────
  sqlOutput: SqlOutput | null;
  setSqlOutput: (output: SqlOutput | null) => void;
  updateSql: (sql: string) => void;
  isMaximized: boolean;
  toggleMaximize: () => void;

  // ── Pipeline ────────────────────────────────────────────
  currentStage: WorkflowStage;
  stageMessage: string;
  setStage: (stage: WorkflowStage, message?: string) => void;

  // ── Agent ───────────────────────────────────────────────
  isAgentRunning: boolean;
  interactionState: AgentInteractionState;
  pendingClarification: ClarificationRequest | null;
  setAgentRunning: (running: boolean) => void;
  setInteractionState: (state: AgentInteractionState) => void;
  setPendingClarification: (clarification: ClarificationRequest | null) => void;

  // ── Session ─────────────────────────────────────────────
  sessionId: string;
  resetSession: () => void;
}

// ============================================================
// Helpers
// ============================================================

function generateSessionId(): string {
  return crypto.randomUUID();
}

// ============================================================
// Initial State
// ============================================================

const initialState = {
  taskType: 'auto_detect' as TaskType,
  detectedTask: null as DetectedTaskInfo | null,

  jiraInput: { project: '', storyNumber: '' } as JiraInput,

  bqProjectInput: { projectId: '' } as BqProjectInput,

  contextText: '',
  uploadedFiles: [] as UploadedFile[],

  messages: [] as ChatMessage[],
  isStreaming: false,
  toolLogs: [] as ToolCallLog[],

  sqlOutput: null as SqlOutput | null,
  isMaximized: false,

  currentStage: 'idle' as WorkflowStage,
  stageMessage: '',

  isAgentRunning: false,
  interactionState: 'idle' as AgentInteractionState,
  pendingClarification: null as ClarificationRequest | null,

  sessionId: generateSessionId(),
};

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

  // ── BigQuery Project ─────────────────────────────────────

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
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, newMessage],
    }));
  },

  updateLastAssistantMessage: (content) => {
    set((state) => {
      const lastIdx = state.messages.findLastIndex((m) => m.role === 'assistant');
      if (lastIdx === -1) return state;
      const updatedMessages = [...state.messages];
      updatedMessages[lastIdx] = { ...updatedMessages[lastIdx], content };
      return { messages: updatedMessages };
    });
  },

  appendToLastAssistantMessage: (content) => {
    set((state) => {
      const lastIdx = state.messages.findLastIndex((m) => m.role === 'assistant');
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

  // ── Tool Call Logs ──────────────────────────────────────

  addToolLog: (log) => {
    const newLog: ToolCallLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      toolLogs: [...state.toolLogs, newLog],
    }));
  },

  updateToolLog: (tool, status, summary) => {
    set((state) => {
      const updatedLogs = state.toolLogs.map((log) =>
        log.tool === tool ? { ...log, status, summary } : log
      );
      return { toolLogs: updatedLogs };
    });
  },

  clearToolLogs: () => {
    set({ toolLogs: [] });
  },

  // ── SQL Output ──────────────────────────────────────────

  setSqlOutput: (output) => {
    if (output) {
      set({ sqlOutput: output, currentStage: 'validation' });
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

  setStage: (stage, message) => {
    set({
      currentStage: stage,
      stageMessage: message || '',
    });
  },

  // ── Agent ───────────────────────────────────────────────

  setAgentRunning: (running) => {
    set({
      isAgentRunning: running,
      interactionState: running ? 'processing' : 'idle',
    });
  },

  setInteractionState: (state) => {
    set({ interactionState: state });
  },

  setPendingClarification: (clarification) => {
    set({
      pendingClarification: clarification,
      interactionState: clarification ? 'awaiting_clarification' : 'idle',
      isAgentRunning: false,
    });
  },

  // ── Session ─────────────────────────────────────────────

  resetSession: () => {
    set({ ...initialState, sessionId: generateSessionId() });
  },
}));
