// ============================================================
// AI-Powered SQL Generation & SQL Conversion Agent
// Enterprise UI — Type Definitions
// ============================================================

// Input modes
export type InputMode = 'jira' | 'stm' | 'legacy_sql';

// Workflow stages
export type WorkflowStage =
  | 'intake'
  | 'requirement_analysis'
  | 'object_resolution'
  | 'schema_verification'
  | 'design_decisions'
  | 'sql_construction'
  | 'validation'
  | 'delivery';

// Job status derived from stage
export type JobStatus = 'in_progress' | 'needs_review' | 'needs_approval' | 'completed' | 'failed' | 'blocked';

// Input source info
export interface InputSource {
  type: InputMode;
  reference: string; // Jira ticket ID, file name, or SQL identifier
  summary: string;
  attachments?: string[];
  uploadedAt: string;
}

// Requirement extracted from input
export interface ExtractedRequirement {
  id: string;
  description: string;
  sourceTable?: string;
  targetTable?: string;
  transformation: string;
  complexity: 'low' | 'medium' | 'high';
  status: 'confirmed' | 'ambiguous' | 'pending_review';
  ambiguityNotes?: string;
}

// Schema object
export interface SchemaObject {
  name: string;
  type: 'table' | 'view' | 'staging_table';
  database: string;
  schema: string;
  columnCount: number;
  status: 'verified' | 'unverified' | 'not_found';
  lastVerified?: string;
}

// Design decision
export interface DesignDecision {
  id: string;
  title: string;
  description: string;
  options: { label: string; description: string; recommended: boolean }[];
  selectedOption?: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
}

// Validation
export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'critical';
  lineNumber?: number;
  column?: string;
  suggestion?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: 'warning' | 'info';
  suggestion?: string;
}

export interface DQFinding {
  id: string;
  type: 'data_quality' | 'schema_drift' | 'logic_gap';
  severity: 'high' | 'medium' | 'low';
  description: string;
  affectedObject: string;
  recommendation: string;
}

// SQL artifact
export interface SqlArtifact {
  id: string;
  name: string;
  sql: string;
  type: 'ddl' | 'dml' | 'staging' | 'production';
  targetPlatform: 'bigquery';
  status: 'draft' | 'review' | 'approved' | 'rejected';
  dryRunResult?: {
    success: boolean;
    bytesProcessed?: number;
    slotsUsed?: number;
    errors?: string[];
    warnings?: string[];
  };
  validationResult?: {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    dqFindings: DQFinding[];
  };
  createdAt: string;
  updatedAt: string;
}

// Job (main entity)
export interface SqlJob {
  id: string;
  title: string;
  description: string;
  inputSource: InputSource;
  currentStage: WorkflowStage;
  status: JobStatus;
  requirements: ExtractedRequirement[];
  schemaObjects: SchemaObject[];
  designDecisions: DesignDecision[];
  sqlArtifacts: SqlArtifact[];
  progress: number; // 0-100
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// Activity log entry
export interface ActivityEntry {
  id: string;
  jobId: string;
  jobTitle: string;
  action: string;
  description: string;
  stage: WorkflowStage;
  performedBy: string;
  timestamp: string;
}

// Pipeline stats
export interface PipelineStats {
  totalJobs: number;
  intake: number;
  analyzing: number;
  generating: number;
  validating: number;
  approved: number;
  deployed: number;
  needsReview: number;
  needsApproval: number;
  failed: number;
}
