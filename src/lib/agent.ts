// ============================================================
// SQLForge — Agentic Loop
// Pre-fetches context (Jira, BQ schema) → enriches prompt
// → calls LLM → streams status events via SSE
// ============================================================

import type { WorkflowStage } from '@/lib/types';
import {
  getJiraClient,
  getBQClient,
  type JiraStory,
  type TableSchema,
} from './api-clients';

// ── SSE Helper ─────────────────────────────────────────────

export class SSEStream {
  private controller: ReadableStreamDefaultController;

  constructor(controller: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  /** Send an SSE event with a named event type and JSON data */
  send(event: string, data: unknown) {
    this.controller.enqueue(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    );
  }

  /** Send a status update (also updates pipeline stage) */
  status(stage: WorkflowStage, message: string) {
    this.send('status', { stage, message, timestamp: Date.now() });
  }

  /** Log a tool execution step */
  toolCall(tool: string, args: Record<string, unknown>) {
    this.send('tool_call', { tool, args, timestamp: Date.now() });
  }

  /** Log a tool result */
  toolResult(tool: string, success: boolean, summary: string) {
    this.send('tool_result', { tool, success, summary, timestamp: Date.now() });
  }

  /** Stream a text chunk from the LLM */
  textDelta(content: string) {
    this.send('text_delta', { content });
  }

  /** Send the final complete response */
  message(content: string) {
    this.send('message', { content });
  }

  /** Send extracted SQL */
  sql(sql: string, fileName: string) {
    this.send('sql', { sql, fileName, timestamp: Date.now() });
  }

  /** Signal completion */
  done() {
    this.send('done', { timestamp: Date.now() });
  }

  /** Signal error */
  error(message: string) {
    this.send('error', { message, timestamp: Date.now() });
  }
}

// ── Agent Request ──────────────────────────────────────────

export interface AgentRequest {
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  taskType: string;
  jiraInput?: { project: string; storyNumber: string };
  bqProjectId?: string;
  contextText?: string;
}

// ── SQL Extraction ─────────────────────────────────────────

function extractSqlBlock(content: string): string | null {
  const match = content.match(/```sql\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

// ── STM version tracker (in-memory per session) ────────────

const stmVersions = new Map<string, number>();

function getNextStmVersion(sessionId: string): number {
  const current = stmVersions.get(sessionId) || 0;
  const next = current + 1;
  stmVersions.set(sessionId, next);
  return next;
}

// ── System Prompt ──────────────────────────────────────────

function buildSystemPrompt(taskType: string): string {
  const taskInstruction =
    taskType === 'sql_generation'
      ? 'Focus on creating NEW BigQuery SQL based on the requirements.'
      : taskType === 'legacy_sql_conversion'
        ? 'Focus on CONVERTING legacy SQL (T-SQL, PL/SQL, Redshift, Teradata, etc.) to BigQuery-compatible syntax.'
        : 'Infer the task type from the user input — either generate new SQL or convert legacy SQL to BigQuery.';

  return `You are SQLForge, an AI-powered SQL Generation and Legacy SQL Conversion Agent for Google BigQuery.

## Your Role
1. Analyze the provided context (Jira stories, table schemas, user requirements) to understand the SQL requirements.
2. Generate production-quality BigQuery-compatible SQL.
3. Explain your design decisions, assumptions, and any optimizations applied.

## Task
${taskInstruction}

## SQL Standards
- Use standard BigQuery SQL syntax (no legacy SQL)
- Prefer CTEs for readability and modularity
- Use IFNULL/COALESCE for NULL handling
- Include proper PARTITION BY and CLUSTER BY clauses
- Add inline comments explaining complex logic
- Use DATE/TIMESTAMP types correctly
- Follow naming conventions: snake_case for columns, PascalCase for CTE names
- Optimize for large datasets (avoid CROSS JOINs, use appropriate JOINs)

## Response Format
When generating SQL, wrap it in a fenced code block:
\`\`\`sql
-- Your SQL here
\`\`\`

IMPORTANT: Also include a Source-to-Target Mapping (STM) in a fenced code block. Use this exact JSON format:
\`\`\`stm
{"title":"STM Title","description":"Brief description","rows":[{"sourceField":"field_name","sourceTable":"table_name","sourceType":"data_type","targetColumn":"column_name","targetTable":"table_name","targetType":"data_type","transformation":"TRANSFORM","businessRule":"RULE","notes":"NOTE"}]}
\`\`\`
Map every source field to its target column with transformation logic and business rules.

Include a brief explanation before and after the SQL block describing:
- What the SQL does
- Key design decisions
- Any assumptions made
- Performance considerations`;
}

// ── Table Inference (dynamic, no hardcoded tables) ─────────

function inferTablesToFetch(context: string): Array<{ datasetId: string; tableId: string }> {
  const result: Array<{ datasetId: string; tableId: string }> = [];

  // Pattern 1: `dataset.table` or dataset.table (backtick-quoted or bare)
  const tableRefPattern = /`?([a-zA-Z_][\w]*)`?\.`?([a-zA-Z_][\w]*)`?/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = tableRefPattern.exec(context)) !== null) {
    // Skip common SQL keywords that might match the pattern
    const sqlKeywords = new Set([
      'STRING', 'INT64', 'FLOAT64', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'DATETIME',
      'ARRAY', 'STRUCT', 'BYTES', 'NUMERIC', 'BIGNUMERIC', 'GEOGRAPHY',
      'COALESCE', 'IFNULL', 'NULLIF', 'SAFE_DIVIDE',
    ]);
    const datasetId = match[1].toLowerCase();
    const tableId = match[2].toLowerCase();
    if (sqlKeywords.has(match[1].toUpperCase()) || sqlKeywords.has(match[2].toUpperCase())) continue;

    const key = `${datasetId}.${tableId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ datasetId, tableId });
    }
  }

  return result;
}

// ── Retry utility ──────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 2,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

// ── Main Agent Loop ────────────────────────────────────────

export async function runAgent(
  request: AgentRequest,
  sse: SSEStream,
): Promise<void> {
  const { messages, taskType, jiraInput, bqProjectId, contextText, sessionId } = request;

  // ── Phase 1: Intake ───────────────────────────────────────
  sse.status('intake', 'Processing your request...');

  const contextParts: string[] = [];

  // ── Phase 2: Fetch Jira Story ─────────────────────────────
  if (jiraInput?.project && jiraInput?.storyNumber) {
    sse.status('analysis', `Fetching Jira story ${jiraInput.project}-${jiraInput.storyNumber}...`);
    sse.toolCall('fetch_jira_story', { project: jiraInput.project, storyNumber: jiraInput.storyNumber });

    try {
      const story = await withRetry(() => {
        const jira = getJiraClient();
        return jira.fetchStory(jiraInput!.project, jiraInput!.storyNumber);
      });
      contextParts.push(formatJiraContext(story));
      sse.toolResult('fetch_jira_story', true, `Fetched: ${story.key} — ${story.summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Jira story';
      sse.toolResult('fetch_jira_story', false, msg);
      // Surface error to user instead of silently continuing
      contextParts.push(`**[Jira fetch failed after retries: ${msg}]**\n\n⚠️ The LLM will generate SQL based on the context you provided without Jira story details. Verify the output carefully.`);
    }
  }

  // ── Phase 3: Fetch BigQuery Schema ────────────────────────
  if (bqProjectId) {
    sse.status('schema_resolution', `Resolving schema for BigQuery project: ${bqProjectId}...`);

    try {
      const bq = getBQClient();
      const datasets = await withRetry(() => bq.getDatasets());
      sse.toolCall('list_bq_datasets', { projectId: bqProjectId });

      // Build context from Jira description + user context for table inference
      const fullContext = contextParts.join('\n') + ' ' + (contextText || '');
      const tablesToFetch = inferTablesToFetch(fullContext);
      const schemas: TableSchema[] = [];

      for (const { datasetId, tableId } of tablesToFetch) {
        sse.toolCall('get_table_schema', { datasetId, tableId });
        try {
          const schema = await withRetry(() => bq.getTableSchema(datasetId, tableId));
          schemas.push(schema);
          sse.toolResult('get_table_schema', true, `${datasetId}.${tableId} — ${schema.columns.length} columns`);
        } catch {
          sse.toolResult('get_table_schema', false, `Table ${datasetId}.${tableId} not found or inaccessible`);
        }
      }

      if (schemas.length > 0) {
        contextParts.push(formatSchemaContext(schemas));
      } else {
        // No table schemas resolved — inform the LLM of available datasets
        contextParts.push(
          `## BigQuery Project: ${bqProjectId}\nAvailable datasets: ${datasets.join(', ')}\n\n⚠️ Could not resolve specific table schemas from context. Please generate SQL based on the Jira requirements and standard BigQuery conventions. Ask the user for clarification if the table structure is ambiguous.`
        );
      }
      sse.toolResult('list_bq_datasets', true, `Found ${datasets.length} datasets: ${datasets.join(', ')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to BigQuery';
      sse.toolResult('list_bq_datasets', false, msg);
      contextParts.push(`**[BigQuery schema resolution failed after retries: ${msg}]**\n\n⚠️ The LLM will generate SQL based on available context without schema validation. Verify table/column names against your BigQuery project.`);
    }
  }

  // ── Phase 4: SQL Generation ───────────────────────────────
  sse.status('sql_generation', 'Generating SQL...');

  // Build enriched messages
  const systemPrompt = buildSystemPrompt(taskType);

  let userContent = messages.map((m) => m.content).join('\n\n');
  if (contextParts.length > 0) {
    userContent = `## Context\n\n${contextParts.join('\n\n---\n\n')}\n\n---\n\n## Your Task\n\n${userContent}`;
  }

  // Add BQ project info to context
  if (bqProjectId) {
    userContent += `\n\n**Target BigQuery Project:** \`${bqProjectId}\``;
  }

  const llmMessages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userContent },
  ];

  // Call LLM
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: llmMessages,
      thinking: { type: 'disabled' },
    });

    const content =
      completion?.choices?.[0]?.message?.content ??
      'I encountered an issue generating a response. Please try again.';

    // ── Phase 5: Validation ──────────────────────────────────
    sse.status('validation', 'Validating generated SQL...');

    const sqlBlock = extractSqlBlock(content);

    if (sqlBlock && bqProjectId) {
      sse.toolCall('dry_run_sql', { projectId: bqProjectId });
      try {
        const bq = getBQClient();
        const dryRunResult = await bq.dryRunSql(bqProjectId, sqlBlock);
        sse.toolResult('dry_run_sql', dryRunResult.valid, dryRunResult.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Dry run failed';
        sse.toolResult('dry_run_sql', false, msg);
      }
    }

    // ── Phase 6: Ready ──────────────────────────────────────
    sse.status('ready', 'SQL generated successfully');
    sse.message(content);

    if (sqlBlock) {
      // Include Jira ticket key in filename for traceability
      const ticketKey = jiraInput?.project && jiraInput?.storyNumber
        ? `${jiraInput.project}-${jiraInput.storyNumber}`
        : 'standalone';
      const fileName = `sqlforge_${ticketKey}_${Date.now()}.sql`;
      sse.sql(sqlBlock, fileName);
    }

    // ── Phase 6b: Extract and emit STM ──────────────────────
    const stmArtifact = extractStmBlock(content, request, sessionId);
    if (stmArtifact) {
      sse.send('stm', { artifact: stmArtifact, timestamp: Date.now() });
    }

    sse.done();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM generation failed';
    sse.error(msg);
    sse.status('idle', 'Generation failed');
  }
}

// ── STM Extraction (with JSON fallback) ────────────────────

function extractStmBlock(content: string, request: AgentRequest, sessionId: string) {
  // Strategy 1: Fenced code block ```stm ... ```
  const fencedMatch = content.match(/```(?:stm|STM)\s*\n([\s\S]*?)```/);
  // Strategy 2: JSON object with "rows" key (fallback for LLMs that don't use fences)
  const jsonMatch = !fencedMatch
    ? content.match(/\{[\s\S]*?"title"[\s\S]*?"rows"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/)
    : null;

  const match = fencedMatch || jsonMatch;
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed.rows || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;

    let source: 'jira' | 'file' | 'text' | 'legacy_sql' = 'text';
    if (request.jiraInput?.project && request.jiraInput?.storyNumber) source = 'jira';
    else if (request.taskType === 'legacy_sql_conversion') source = 'legacy_sql';

    return {
      rows: parsed.rows.map((r: Record<string, unknown>) => ({
        sourceField: String(r.sourceField || ''),
        sourceTable: String(r.sourceTable || ''),
        sourceType: String(r.sourceType || ''),
        targetColumn: String(r.targetColumn || ''),
        targetTable: String(r.targetTable || ''),
        targetType: String(r.targetType || ''),
        transformation: String(r.transformation || ''),
        businessRule: String(r.businessRule || ''),
        notes: String(r.notes || ''),
      })),
      title: String(parsed.title || 'Source-to-Target Mapping'),
      description: String(parsed.description || 'Auto-generated STM artifact'),
      source,
      jiraRef: source === 'jira'
        ? `${request.jiraInput!.project}-${request.jiraInput!.storyNumber}`
        : undefined,
      bqProject: String(request.bqProjectId || ''),
      generatedAt: new Date().toISOString(),
      version: getNextStmVersion(sessionId),
    };
  } catch {
    return null;
  }
}

// ── Context Formatters ─────────────────────────────────────

function formatJiraContext(story: JiraStory): string {
  const sections = [
    `## Jira Story: ${story.key}`,
    `**Summary:** ${story.summary}`,
    `**Status:** ${story.status} | **Priority:** ${story.priority} | **Type:** ${story.storyType}`,
    `**Labels:** ${story.labels.join(', ') || 'None'}`,
    `**Assignee:** ${story.assignee} | **Reporter:** ${story.reporter}`,
  ];

  if (story.description) {
    sections.push(`\n### Description\n${story.description}`);
  }

  if (story.acceptanceCriteria) {
    sections.push(`\n### Acceptance Criteria\n${story.acceptanceCriteria}`);
  }

  if (story.comments.length > 0) {
    sections.push(
      `\n### Comments`,
      ...story.comments.map(
        (c) => `> **${c.author}** (${new Date(c.created).toLocaleDateString()}): ${c.body}`
      )
    );
  }

  return sections.join('\n\n');
}

function formatSchemaContext(schemas: TableSchema[]): string {
  return (
    `## BigQuery Table Schemas\n` +
    schemas
      .map(
        (s) =>
          `### \`${s.datasetId}.${s.tableId}\`\n` +
          '| Column | Type | Mode | Description |\n' +
          '|--------|------|------|-------------|\n' +
          s.columns
            .map((c) => `| \`${c.name}\` | ${c.type} | ${c.mode} | ${c.description} |`)
            .join('\n')
      )
      .join('\n\n')
  );
}
