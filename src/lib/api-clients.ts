// ============================================================
// SQLForge — External API Clients
// Jira · BigQuery · GitHub
// All clients fall back to realistic mock data when
// credentials are not configured.
// ============================================================

// ── Types ──────────────────────────────────────────────────

export interface JiraStory {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  labels: string[];
  storyType: string;
  assignee: string;
  reporter: string;
  comments: Array<{ author: string; body: string; created: string }>;
  acceptanceCriteria?: string;
}

export interface TableSchema {
  datasetId: string;
  tableId: string;
  columns: Array<{
    name: string;
    type: string;
    mode: string;
    description: string;
  }>;
}

export interface DryRunResult {
  valid: boolean;
  estimatedBytes?: number;
  message: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  message: string;
}

// ============================================================
// Jira Client
// ============================================================

export class JiraClient {
  private baseUrl: string;
  private userEmail: string;
  private apiToken: string;

  constructor() {
    this.baseUrl = process.env.JIRA_BASE_URL || '';
    this.userEmail = process.env.JIRA_USER_EMAIL || '';
    this.apiToken = process.env.JIRA_API_TOKEN || '';
  }

  get isConfigured(): boolean {
    return !!(this.baseUrl && this.userEmail && this.apiToken);
  }

  async fetchStory(project: string, storyNumber: string): Promise<JiraStory> {
    if (!this.isConfigured) {
      return this.mockStory(project, storyNumber);
    }

    const issueKey = `${project}-${storyNumber}`;
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
    const auth = Buffer.from(`${this.userEmail}:${this.apiToken}`).toString('base64');

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Jira API error ${res.status} for ${issueKey}`);
    }

    const data = await res.json();
    return this.parseStory(data);
  }

  // ── Real parser ──────────────────────────────────────────

  private parseStory(data: Record<string, unknown>): JiraStory {
    const fields = data.fields as Record<string, unknown>;
    const desc = fields.description as Record<string, unknown> | null;
    const descText = desc
      ? ((desc.content as Array<Record<string, unknown>>)
          ?.map((node) =>
            ((node.content as Array<Record<string, unknown>> | undefined)
              ?.map((t) => t.text || '')
              .join('') || (node.type === 'hardBreak' ? '\n' : ''))
          )
          .join('') || '')
      : (fields.description as string) || '';

    return {
      key: data.key as string,
      summary: fields.summary as string,
      description: descText,
      status: ((fields.status as Record<string, unknown>)?.name as string) || '',
      priority: ((fields.priority as Record<string, unknown>)?.name as string) || '',
      labels: ((fields.labels as string[]) || []),
      storyType: ((fields.issuetype as Record<string, unknown>)?.name as string) || '',
      assignee: ((fields.assignee as Record<string, unknown>)?.displayName as string) || 'Unassigned',
      reporter: ((fields.reporter as Record<string, unknown>)?.displayName as string) || '',
      comments: ((fields.comment as Record<string, unknown>)?.comments as Array<Record<string, unknown>> || []).map((c) => ({
        author: ((c.author as Record<string, unknown>)?.displayName as string) || '',
        body: (c.body as string) || '',
        created: (c.created as string) || '',
      })),
    };
  }

  // ── Mock data ────────────────────────────────────────────

  private mockStory(project: string, storyNumber: string): JiraStory {
    const key = `${project}-${storyNumber}`;
    return {
      key,
      summary: `[${key}] Implement daily sales aggregation report in BigQuery`,
      description: `**User Story:**
As a data analyst, I need a BigQuery SQL query that aggregates daily sales data for executive reporting.

**Requirements:**
1. Aggregate daily sales data from the \`raw_data.orders\` table
2. Join with \`staging.product_catalog\` for product names and categories
3. Join with \`staging.customers\` for customer segmentation
4. Filter by the last 30 days (configurable)
5. Group by order date and product category
6. Include metrics: total revenue, order count, average order value, distinct customers
7. Use \`analytics.sales_daily\` as the target table
8. Partition by \`order_date\`
9. Cluster by \`product_category\`

**Acceptance Criteria:**
- SQL must be BigQuery-compatible
- Must handle NULL values gracefully
- Must include proper comments
- Should use CTEs for readability
- Performance: query should complete within 5 minutes on 100M+ rows`,
      status: 'In Progress',
      priority: 'High',
      labels: ['data-engineering', 'bigquery', 'reporting', 'sql-forge'],
      storyType: 'Story',
      assignee: 'Data Engineer',
      reporter: 'Product Manager',
      comments: [
        {
          author: 'Product Manager',
          body: 'This report is needed for the executive dashboard refresh. Please ensure the SQL handles edge cases like zero-quantity orders and refunds.',
          created: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          author: 'DBA Lead',
          body: 'Remember to use IFNULL for revenue calculations. The orders table has some NULL unit_price values from migrated data.',
          created: new Date(Date.now() - 43200000).toISOString(),
        },
      ],
    };
  }
}

// ============================================================
// BigQuery Client
// ============================================================

export class BigQueryClient {
  private projectId: string;
  private accessToken: string;

  constructor() {
    this.projectId = process.env.GCP_PROJECT_ID || '';
    this.accessToken = process.env.GCP_ACCESS_TOKEN || '';
  }

  get isConfigured(): boolean {
    return !!(this.projectId && this.accessToken);
  }

  async getDatasets(): Promise<string[]> {
    if (!this.isConfigured) {
      return ['raw_data', 'staging', 'analytics', 'reporting', 'audit_logs'];
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`BQ API error ${res.status}`);
    const data = await res.json();
    return (data.datasets || []).map((d: Record<string, unknown>) => {
      const ref = d.datasetReference as Record<string, unknown>;
      return ref.datasetId as string;
    });
  }

  async getTableSchema(datasetId: string, tableId: string): Promise<TableSchema> {
    if (!this.isConfigured) {
      return this.mockSchema(datasetId, tableId);
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${datasetId}/tables/${tableId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`BQ API error ${res.status}`);
    const data = await res.json();
    return {
      datasetId,
      tableId,
      columns: ((data.schema?.fields || []) as Array<Record<string, unknown>>).map((f) => ({
        name: f.name as string,
        type: f.type as string,
        mode: f.mode as string,
        description: f.description as string || '',
      })),
    };
  }

  async dryRunSql(projectId: string, sql: string): Promise<DryRunResult> {
    if (!this.isConfigured) {
      return { valid: true, estimatedBytes: 15_728_640, message: 'Dry run passed (mock)' };
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        configuration: { query: { query: sql, dryRun: true } },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        valid: false,
        message: (err.error?.message as string) || `Dry run failed with status ${res.status}`,
      };
    }
    const data = await res.json();
    return {
      valid: true,
      estimatedBytes: data.statistics?.query?.totalBytesProcessed,
      message: `Dry run passed. Estimated ${formatBytes(Number(data.statistics?.query?.totalBytesProcessed || 0))} processed.`,
    };
  }

  async runQuery(projectId: string, sql: string): Promise<QueryResult> {
    if (!this.isConfigured) {
      return {
        rows: [{ result: 'Query not executed (mock mode — no credentials configured)' }],
        totalRows: 0,
        message: 'Mock mode — configure GCP credentials to run actual queries',
      };
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 30000 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err.error?.message as string) || `BQ query error ${res.status}`);
    }
    const data = await res.json();
    const rows = (data.rows || []) as Array<Record<string, unknown>>;
    return {
      rows: rows.map((row) => {
        const out: Record<string, unknown> = {};
        (row.f as Array<Record<string, unknown>>).forEach((cell, i) => {
          const field = ((data.schema?.fields || []) as Array<Record<string, unknown>>)[i];
          out[field?.name as string || `col_${i}`] = cell.v;
        });
        return out;
      }),
      totalRows: Number(data.totalRows || 0),
      message: `Query completed. ${data.totalRows || 0} rows returned.`,
    };
  }

  // ── Mock schemas ─────────────────────────────────────────

  private mockSchema(datasetId: string, tableId: string): TableSchema {
    const schemas: Record<string, TableSchema> = {
      'raw_data.orders': {
        datasetId: 'raw_data',
        tableId: 'orders',
        columns: [
          { name: 'order_id', type: 'STRING', mode: 'REQUIRED', description: 'Unique order identifier (UUID)' },
          { name: 'customer_id', type: 'STRING', mode: 'NULLABLE', description: 'FK to staging.customers' },
          { name: 'order_date', type: 'TIMESTAMP', mode: 'REQUIRED', description: 'Order placement timestamp' },
          { name: 'product_id', type: 'STRING', mode: 'REQUIRED', description: 'FK to staging.product_catalog' },
          { name: 'quantity', type: 'INTEGER', mode: 'REQUIRED', description: 'Number of items ordered' },
          { name: 'unit_price', type: 'FLOAT', mode: 'NULLABLE', description: 'Price per unit (may be NULL for migrated data)' },
          { name: 'total_amount', type: 'FLOAT', mode: 'REQUIRED', description: 'Total order amount' },
          { name: 'discount_amount', type: 'FLOAT', mode: 'NULLABLE', description: 'Discount applied' },
          { name: 'status', type: 'STRING', mode: 'REQUIRED', description: 'Order status: PLACED, SHIPPED, DELIVERED, REFUNDED' },
          { name: 'channel', type: 'STRING', mode: 'NULLABLE', description: 'Sales channel: ONLINE, IN_STORE, PARTNER' },
          { name: 'region', type: 'STRING', mode: 'NULLABLE', description: 'Geographic region' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED', description: 'Record creation time' },
          { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED', description: 'Record last update time' },
        ],
      },
      'staging.product_catalog': {
        datasetId: 'staging',
        tableId: 'product_catalog',
        columns: [
          { name: 'product_id', type: 'STRING', mode: 'REQUIRED', description: 'Unique product identifier' },
          { name: 'product_name', type: 'STRING', mode: 'REQUIRED', description: 'Product display name' },
          { name: 'category', type: 'STRING', mode: 'REQUIRED', description: 'Product category (e.g. Electronics, Clothing)' },
          { name: 'subcategory', type: 'STRING', mode: 'NULLABLE', description: 'Product subcategory' },
          { name: 'brand', type: 'STRING', mode: 'NULLABLE', description: 'Brand name' },
          { name: 'is_active', type: 'BOOLEAN', mode: 'REQUIRED', description: 'Whether product is currently active' },
          { name: 'launch_date', type: 'DATE', mode: 'NULLABLE', description: 'Product launch date' },
        ],
      },
      'staging.customers': {
        datasetId: 'staging',
        tableId: 'customers',
        columns: [
          { name: 'customer_id', type: 'STRING', mode: 'REQUIRED', description: 'Unique customer identifier' },
          { name: 'customer_name', type: 'STRING', mode: 'REQUIRED', description: 'Customer full name' },
          { name: 'email', type: 'STRING', mode: 'NULLABLE', description: 'Customer email' },
          { name: 'segment', type: 'STRING', mode: 'NULLABLE', description: 'Customer segment: ENTERPRISE, SMB, CONSUMER' },
          { name: 'region', type: 'STRING', mode: 'NULLABLE', description: 'Customer region' },
          { name: 'signup_date', type: 'DATE', mode: 'NULLABLE', description: 'Customer signup date' },
        ],
      },
      'analytics.sales_daily': {
        datasetId: 'analytics',
        tableId: 'sales_daily',
        columns: [
          { name: 'report_date', type: 'DATE', mode: 'REQUIRED', description: 'Report date (partition key)' },
          { name: 'product_category', type: 'STRING', mode: 'REQUIRED', description: 'Product category (cluster key)' },
          { name: 'total_revenue', type: 'FLOAT', mode: 'REQUIRED', description: 'Total revenue for the day/category' },
          { name: 'order_count', type: 'INTEGER', mode: 'REQUIRED', description: 'Number of orders' },
          { name: 'avg_order_value', type: 'FLOAT', mode: 'REQUIRED', description: 'Average order value' },
          { name: 'distinct_customers', type: 'INTEGER', mode: 'REQUIRED', description: 'Number of unique customers' },
          { name: 'channel', type: 'STRING', mode: 'NULLABLE', description: 'Sales channel' },
          { name: 'region', type: 'STRING', mode: 'NULLABLE', description: 'Geographic region' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED', description: 'ETL timestamp' },
        ],
      },
    };

    const key = `${datasetId}.${tableId}`;
    return (
      schemas[key] || {
        datasetId,
        tableId,
        columns: [
          { name: 'id', type: 'STRING', mode: 'REQUIRED', description: 'Primary key' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED', description: 'Creation timestamp' },
        ],
      }
    );
  }
}

// ============================================================
// GitHub Client
// ============================================================

export class GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || '';
    this.owner = process.env.GITHUB_OWNER || '';
    this.repo = process.env.GITHUB_REPO || '';
  }

  get isConfigured(): boolean {
    return !!(this.token && this.owner && this.repo);
  }

  async createPullRequest(
    title: string,
    body: string,
    sqlContent: string,
    fileName: string
  ): Promise<{ url: string; number: number }> {
    if (!this.isConfigured) {
      return {
        url: `https://github.com/${this.owner || 'org'}/${this.repo || 'repo'}/pull/new/sqlforge-${Date.now()}`,
        number: 0,
      };
    }

    // 1. Get default branch
    const repoRes = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const repoData = await repoRes.json();
    const baseBranch = repoData.default_branch as string;

    // 2. Create branch
    const branchName = `sqlforge/${Date.now()}`;
    const mainSha = await this.getRefSha(baseBranch);
    await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/git/refs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainSha }),
    });

    // 3. Create file on branch
    const base64Content = Buffer.from(sqlContent).toString('base64');
    await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/sql/${fileName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `feat(sql): add ${fileName}`,
          content: base64Content,
          branch: branchName,
        }),
      }
    );

    // 4. Create PR
    const prRes = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        head: branchName,
        base: baseBranch,
      }),
    });

    const prData = await prRes.json();
    return { url: prData.html_url as string, number: prData.number as number };
  }

  private async getRefSha(branch: string): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    const data = await res.json();
    return (data.object?.sha as string) || '';
  }
}

// ── Helpers ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Singleton Instances ────────────────────────────────────

let _jiraClient: JiraClient | null = null;
let _bqClient: BigQueryClient | null = null;
let _ghClient: GitHubClient | null = null;

export function getJiraClient(): JiraClient {
  if (!_jiraClient) _jiraClient = new JiraClient();
  return _jiraClient;
}

export function getBQClient(): BigQueryClient {
  if (!_bqClient) _bqClient = new BigQueryClient();
  return _bqClient;
}

export function getGitHubClient(): GitHubClient {
  if (!_ghClient) _ghClient = new GitHubClient();
  return _ghClient;
}
