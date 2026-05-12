import { create } from 'zustand';
import type {
  TaskType,
  InputMode,
  WorkflowStage,
  ChatMessage,
  UploadedFile,
  JiraInput,
  SqlOutput,
  DetectedTaskInfo,
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

  // ── Input Mode ──────────────────────────────────────────
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;

  // ── Jira Input ──────────────────────────────────────────
  jiraInput: JiraInput;
  setJiraInput: (input: Partial<JiraInput>) => void;

  // ── Contextual Input ────────────────────────────────────
  contextText: string;
  setContextText: (text: string) => void;
  uploadedFiles: UploadedFile[];
  addFile: (file: UploadedFile) => void;
  removeFile: (id: string) => void;

  // ── Chat / Conversation ─────────────────────────────────
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;

  // ── SQL Output ──────────────────────────────────────────
  sqlOutput: SqlOutput | null;
  setSqlOutput: (output: SqlOutput | null) => void;
  updateSql: (sql: string) => void;
  isMaximized: boolean;
  toggleMaximize: () => void;

  // ── Pipeline ────────────────────────────────────────────
  currentStage: WorkflowStage;
  setStage: (stage: WorkflowStage) => void;

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

  inputMode: 'jira' as InputMode,

  jiraInput: { project: '', storyNumber: '' } as JiraInput,

  contextText: '',
  uploadedFiles: [] as UploadedFile[],

  messages: [] as ChatMessage[],
  isStreaming: false,

  sqlOutput: null as SqlOutput | null,
  isMaximized: false,

  currentStage: 'idle' as WorkflowStage,

  sessionId: generateSessionId(),
};

// ============================================================
// Store
// ============================================================

export const useAppStore = create<AppState>((set, get) => ({
  // ── Initial State ─────────────────────────────────────────
  ...initialState,

  // ── Task Configuration ───────────────────────────────────

  setTaskType: (type) => {
    // When user manually sets a task type (overriding auto-detect),
    // update taskType and clear detectedTask
    set({
      taskType: type,
      detectedTask: null,
    });
  },

  setDetectedTask: (info) => {
    set({ detectedTask: info });
  },

  // ── Input Mode ──────────────────────────────────────────

  setInputMode: (mode) => {
    set({ inputMode: mode });
  },

  // ── Jira Input ──────────────────────────────────────────

  setJiraInput: (input) => {
    set((state) => ({
      jiraInput: { ...state.jiraInput, ...input },
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
      updatedMessages[lastIdx] = {
        ...updatedMessages[lastIdx],
        content,
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

  // ── SQL Output ──────────────────────────────────────────

  setSqlOutput: (output) => {
    if (output) {
      // When SQL is generated, set stage to 'validation'
      set({
        sqlOutput: output,
        currentStage: 'validation',
      });
    } else {
      set({ sqlOutput: null });
    }
  },

  updateSql: (sql) => {
    set((state) => {
      if (!state.sqlOutput) return state;

      return {
        sqlOutput: {
          ...state.sqlOutput,
          sql,
          isEdited: true,
        },
      };
    });
  },

  toggleMaximize: () => {
    set((state) => ({ isMaximized: !state.isMaximized }));
  },

  // ── Pipeline ────────────────────────────────────────────

  setStage: (stage) => {
    set({ currentStage: stage });
  },

  // ── Session ─────────────────────────────────────────────

  resetSession: () => {
    set({
      ...initialState,
      sessionId: generateSessionId(),
    });
  },
}));
