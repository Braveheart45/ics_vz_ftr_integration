import type {
  AgentActivityEvent,
  AgentActivitySource,
  AgentActivityStatus,
  AgentActivityType,
  ValidationSection,
  ValidationStatus,
  ValidationSummary,
  WorkflowStage,
} from '@/lib/types';
import { createClientId } from '@/lib/id';

const DEFAULT_SOURCE: AgentActivitySource = 'fallback';

const SECTION_META: Array<{
  key: keyof Pick<ValidationSummary, 'requirementCoverage' | 'stmCompleteness' | 'schemaReconciliation' | 'sqlChecks' | 'jiraTransition'>;
  stage: WorkflowStage;
  title: string;
}> = [
  { key: 'requirementCoverage', stage: 'analysis', title: 'Requirement Coverage' },
  { key: 'stmCompleteness', stage: 'sql_generation', title: 'STM Completeness' },
  { key: 'schemaReconciliation', stage: 'schema_resolution', title: 'Schema Reconciliation' },
  { key: 'sqlChecks', stage: 'validation', title: 'SQL Checks' },
  { key: 'jiraTransition', stage: 'validation', title: 'Jira Transition' },
];

function statusFromValidation(status: ValidationStatus): AgentActivityStatus {
  if (status === 'pass') return 'completed';
  if (status === 'fail') return 'failed';
  if (status === 'not_run') return 'pending';
  return 'warning';
}

function inferStageFromText(text: string): WorkflowStage {
  const value = text.toLowerCase();
  if (/jira|ticket|story|requirement|acceptance|intake|classification/.test(value)) return 'analysis';
  if (/schema|dataset|table|column|bigquery|bq|candidate|reconcil/.test(value)) return 'schema_resolution';
  if (/stm|mapping|logic model|design|generate|sql writer|sql generated/.test(value)) return 'sql_generation';
  if (/validat|dry run|dry-run|dryrun|audit|comment|transition/.test(value)) return 'validation';
  if (/ready|complete|deploy|github/.test(value)) return 'ready';
  return 'analysis';
}

function inferTypeFromText(text: string): AgentActivityType {
  const value = text.toLowerCase();
  if (/summary|recap|digest|overall result|run result/.test(value)) return 'summary';
  if (/error|failed|failure|limit|blocked|missing|not found/.test(value)) return 'error';
  if (/infer|assum|confidence|candidate|proposed/.test(value)) return 'inference';
  if (/decision|selected|chosen|approved|load pattern|object type|partition/.test(value)) return 'decision';
  if (/validat|dry run|audit|check|coverage/.test(value)) return 'validation';
  if (/stm|sql|artifact|download|file/.test(value)) return 'artifact';
  return 'observation';
}

function normalizeList(value?: string[]): string[] | undefined {
  const list = (value || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function fingerprint(event: AgentActivityEvent): string {
  return [
    event.stage,
    event.type,
    event.status,
    event.source,
    event.title.trim().toLowerCase(),
    event.summary.trim().toLowerCase(),
  ].join('|');
}

const ALLOWED_TYPES: ReadonlySet<AgentActivityType> = new Set([
  'summary',
  'observation',
  'inference',
  'decision',
  'validation',
  'error',
  'artifact',
]);

function coerceType(type: unknown, fallbackText: string): AgentActivityType {
  if (typeof type === 'string' && ALLOWED_TYPES.has(type as AgentActivityType)) {
    return type as AgentActivityType;
  }
  return inferTypeFromText(fallbackText);
}

export function normalizeActivityEvent(event: Partial<AgentActivityEvent>): AgentActivityEvent {
  const summary = String(event.summary || event.title || 'Claude Code activity').trim();
  const title = String(event.title || summary).trim();

  return {
    id: event.id || createClientId('activity'),
    stage: event.stage || inferStageFromText(`${title} ${summary}`),
    type: coerceType(event.type, `${title} ${summary}`),
    status: event.status || 'completed',
    title,
    summary,
    details: normalizeList(event.details),
    confidence: typeof event.confidence === 'number' ? event.confidence : undefined,
    evidence: normalizeList(event.evidence),
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    source: event.source || DEFAULT_SOURCE,
  };
}

export function mergeActivityEvents(existing: AgentActivityEvent[], incoming: Partial<AgentActivityEvent>[]): AgentActivityEvent[] {
  const byFingerprint = new Map(existing.map((event) => [fingerprint(event), event]));
  for (const rawEvent of incoming) {
    const event = normalizeActivityEvent(rawEvent);
    if (!byFingerprint.has(fingerprint(event))) {
      byFingerprint.set(fingerprint(event), event);
    }
  }
  return Array.from(byFingerprint.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-200);
}

function sectionToActivity(section: ValidationSection | undefined, title: string, stage: WorkflowStage): AgentActivityEvent | null {
  if (!section) return null;
  return normalizeActivityEvent({
    stage,
    type: 'validation',
    status: statusFromValidation(section.status),
    title,
    summary: section.summary,
    evidence: section.checks,
    source: 'claude',
    timestamp: Date.now(),
  });
}

export function validationSummaryToActivityEvents(summary: ValidationSummary): AgentActivityEvent[] {
  // Findings/inferences/decisions are streamed live during the run via inline
  // activity blocks and tool-pair semantic findings. We deliberately DO NOT
  // re-emit them here at completion (they would arrive as a wall of cards and
  // duplicate what the architect already saw). Only the five structured
  // validation sections are surfaced — those are post-completion summaries.
  const events: AgentActivityEvent[] = [];
  for (const meta of SECTION_META) {
    const event = sectionToActivity(summary[meta.key], meta.title, meta.stage);
    if (event) events.push(event);
  }
  return events;
}
