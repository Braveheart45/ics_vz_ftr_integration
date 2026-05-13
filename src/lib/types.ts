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

// Chat message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
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

// BigQuery project input
export interface BqProjectInput {
  projectId: string;
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

// Tool execution log (visible in chat)
export interface ToolCallLog {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  summary?: string;
  timestamp: string;
}

// Clarification prompt (when Claude needs more info from user)
export interface ClarificationRequest {
  message: string;
  needsInput: boolean;
  timestamp?: number;
}

// Bidirectional interaction state
export type AgentInteractionState =
  | 'idle'
  | 'processing'
  | 'awaiting_clarification'
  | 'sql_generated'
  | 'error';

// ── STM (Source-to-Target Mapping) Artifact ──────────────────

// A single row in the STM table
export interface StmRow {
  sourceField: string;
  sourceTable: string;
  sourceType: string;
  targetColumn: string;
  targetTable: string;
  targetType: string;
  transformation: string;
  businessRule: string;
  notes: string;
}

// Complete STM artifact with metadata
export interface StmArtifact {
  rows: StmRow[];
  title: string;
  description: string;
  source: 'jira' | 'file' | 'text' | 'legacy_sql';
  jiraRef?: string;
  bqProject: string;
  generatedAt: string;
  version: number;
}
