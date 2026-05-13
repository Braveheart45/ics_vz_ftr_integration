// ============================================================
// SQLForge — Agentic Loop
// Pre-fetches context (Jira, BQ schema) → enriches prompt
// → calls LLM → streams status events via SSE
// ============================================================

import type { WorkflowStage } from '@/lib/types';
import {
  getJiraClient,
  getBQClient,
  getGitHubClient,
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

// ── Main Agent Loop ────────────────────────────────────────

export async function runAgent(
  request: AgentRequest,
  sse: SSEStream,
): Promise<void> {
  const { messages, taskType, jiraInput, bqProjectId, contextText } = request;

  // ── Phase 1: Intake ───────────────────────────────────────
  sse.status('intake', 'Processing your request...');

  const contextParts: string[] = [];

  // ── Phase 2: Fetch Jira Story ─────────────────────────────
  if (jiraInput?.project && jiraInput?.storyNumber) {
    sse.status('analysis', `Fetching Jira story ${jiraInput.project}-${jiraInput.storyNumber}...`);
    sse.toolCall('fetch_jira_story', { project: jiraInput.project, storyNumber: jiraInput.storyNumber });

    try {
      const jira = getJiraClient();
      const story = await jira.fetchStory(jiraInput.project, jiraInput.storyNumber);
      contextParts.push(formatJiraContext(story));
      sse.toolResult('fetch_jira_story', true, `Fetched: ${story.key} — ${story.summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Jira story';
      sse.toolResult('fetch_jira_story', false, msg);
      contextParts.push(`[Jira fetch failed: ${msg}]`);
    }
  }

  // ── Phase 3: Fetch BigQuery Schema ────────────────────────
  if (bqProjectId) {
    sse.status('schema_resolution', `Resolving schema for BigQuery project: ${bqProjectId}...`);

    try {
      const bq = getBQClient();
      const datasets = await bq.getDatasets();
      sse.toolCall('list_bq_datasets', { projectId: bqProjectId });

      // Fetch schemas for common tables mentioned in context
      const tablesToFetch = inferTablesToFetch(contextText.join('\n') + ' ' + (contextText || ''));
      const schemas: TableSchema[] = [];

      for (const { datasetId, tableId } of tablesToFetch) {
        sse.toolCall('get_table_schema', { datasetId, tableId });
        try {
          const schema = await bq.getTableSchema(datasetId, tableId);
          schemas.push(schema);
          sse.toolResult('get_table_schema', true, `${datasetId}.${tableId} — ${schema.columns.length} columns`);
        } catch {
          sse.toolResult('get_table_schema', false, `Table ${datasetId}.${tableId} not found or inaccessible`);
        }
      }

      if (schemas.length > 0) {
        contextParts.push(formatSchemaContext(schemas));
      } else {
        // Provide available datasets info
        contextParts.push(
          `## BigQuery Project: ${bqProjectId}\nAvailable datasets: ${datasets.join(', ')}\n\nNote: Could not fetch specific table schemas. Please generate SQL based on the Jira requirements and standard BigQuery conventions.`
        );
      }
      sse.toolResult('list_bq_datasets', true, `Found ${datasets.length} datasets: ${datasets.join(', ')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to BigQuery';
      sse.toolResult('list_bq_datasets', false, msg);
      contextParts.push(`[BigQuery schema resolution failed: ${msg}]`);
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
      const fileName = `generated_sql_${Date.now()}.sql`;
      sse.sql(sqlBlock, fileName);
    }

    // ── Phase 6b: Extract and emit STM ──────────────────────
    const stmArtifact = extractStmBlock(content, request);
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

// ── STM Extraction ─────────────────────────────────────────

function extractStmBlock(content: string, request: AgentRequest) {
  const match = content.match(/```stm\s*\n([\s\S]*?)```/i);
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
      jiraRef: source === 'jira' ? `${request.jiraInput!.project}-${request.jiraInput!.storyNumber}` : undefined,
      bqProject: String(request.bqProjectId || ''),
      generatedAt: new Date().toISOString(),
      version: 1,
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

function inferTablesToFetch(context: string): Array<{ datasetId: string; tableId: string }> {
  // Common tables referenced in SQLForge context
  const knownTables: Array<{ datasetId: string; tableId: string }> = [
    { datasetId: 'raw_data', tableId: 'orders' },
    { datasetId: 'staging', tableId: 'product_catalog' },
    { datasetId: 'staging', tableId: 'customers' },
    { datasetId: 'analytics', tableId: 'sales_daily' },
  ];

  // Also try to extract table references from context (e.g., `raw_data.orders`)
  const tableRefPattern = /`?([a-z_]+)\.([a-z_]+)`?/gi;
  let match: RegExpExecArray | null;
  const extracted: Set<string> = new Set();

  while ((match = tableRefPattern.exec(context)) !== null) {
    extracted.add(`${match[1]}.${match[2]}`);
  }

  // Merge: always include known tables + any explicitly referenced
  const result = [...knownTables];
  for (const ref of extracted) {
    const [datasetId, tableId] = ref.split('.');
    if (!result.some((t) => t.datasetId === datasetId && t.tableId === tableId)) {
      result.push({ datasetId, tableId });
    }
  }

  return result;
}
