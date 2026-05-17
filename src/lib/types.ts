// ============================================================
// AI-Powered SQL Generation & Legacy SQL Conversion Agent
// Split-Screen Enterprise UI — Type Definitions
// ============================================================

// Task types
export type TaskType = 'auto_detect' | 'sql_generation' | 'legacy_sql_conversion' | 'github_deploy';

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
  content?: string; // text content for .txt, .csv, .md, .sql files
}

// Jira input data
export interface JiraInput {
  project: string;
  storyNumber: string;
}

// BigQuery target scope input
export interface BqProjectInput {
  projectId: string;
  datasetId: string;
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

// Clarification prompt (when Claude needs more info from user)
export interface ClarificationRequest {
  message: string;
  explanation?: string;
  details?: string;
  options?: string[];
  allowFreeText?: boolean;
  needsInput: boolean;
  timestamp?: number;
}

// One entry in the per-session clarification history. Captures the question
// Claude asked AND the answer the architect supplied, so the entire dialog
// stays visible in the SQL Curator Assistant pane.
export interface ClarificationHistoryEntry {
  id: string;
  message: string;
  explanation?: string;
  details?: string;
  options?: string[];
  allowFreeText?: boolean;
  askedAt: number;
  selectedOptions?: string[];
  freeText?: string;
  answeredAt?: number;
}

export type StageStatus = 'active' | 'completed' | 'blocked' | 'failed';

export type AgentActivityType =
  | 'observation'
  | 'inference'
  | 'decision'
  | 'validation'
  | 'error'
  | 'artifact';

export type AgentActivityStatus =
  | 'running'
  | 'completed'
  | 'warning'
  | 'failed'
  | 'blocked'
  | 'pending';

export type AgentActivitySource =
  | 'claude'
  | 'bridge'
  | 'jira'
  | 'bigquery'
  | 'github'
  | 'offline'
  | 'fallback';

export interface AgentActivityEvent {
  id?: string;
  stage: WorkflowStage;
  type: AgentActivityType;
  status: AgentActivityStatus;
  title: string;
  summary: string;
  details?: string[];
  confidence?: number;
  evidence?: string[];
  timestamp: number;
  source: AgentActivitySource;
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
  bqDataset?: string;
  generatedAt: string;
  version: number;
}

export type ValidationStatus = 'pass' | 'warning' | 'fail' | 'not_run';

export interface ValidationSection {
  status: ValidationStatus;
  summary: string;
  checks: string[];
}

export interface ValidationSummary {
  activityLog?: AgentActivityEvent[];
  activityDetails?: string[];
  requirementCoverage: ValidationSection;
  stmCompleteness: ValidationSection;
  schemaReconciliation: ValidationSection;
  sqlChecks: ValidationSection;
  jiraTransition: ValidationSection;
  inferences?: string[];
  generatedAt: string;
}
