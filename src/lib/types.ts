// ============================================================
// AI-Powered SQL Generation & Legacy SQL Conversion Agent
// Split-Screen Enterprise UI — Type Definitions
// ============================================================

// Task types
export type TaskType = 'auto_detect' | 'sql_generation' | 'legacy_sql_conversion';

// Workflow pipeline stages
export type WorkflowStage =
  | 'idle'
  | 'intake'
  | 'analysis'
  | 'schema_resolution'
  | 'sql_generation'
  | 'validation'
  | 'ready';

// Chat message roles
export type MessageRole = 'user' | 'assistant' | 'system';

// Chat message
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  clarifications?: ClarificationPrompt[];
}

// Clarification prompt (when agent needs more info)
export interface ClarificationPrompt {
  id: string;
  question: string;
  options?: { label: string; value: string }[];
  fieldType: 'select' | 'text' | 'multiselect';
  placeholder?: string;
  required: boolean;
}

// Uploaded file info
export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

// Jira input data
export interface JiraInput {
  project: string;
  storyNumber: string;
}

// SQL output with metadata
export interface SqlOutput {
  sql: string;
  isEdited: boolean;
  fileName: string;
  generatedAt: string;
}

// Detected task info (from auto-detect)
export interface DetectedTaskInfo {
  taskType: TaskType;
  confidence: number;
  reasoning: string;
}
