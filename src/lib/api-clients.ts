// ============================================================
// SQLForge — External API Clients
// Jira · BigQuery · GitHub
// All clients require real credentials — no fallback mocks.
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
// Jira Client — Atlassian Document Format (ADF) Parser
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
      throw new Error('Jira is not configured. Set JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN environment variables.');
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
      const statusText = res.statusText || 'Unknown error';
      throw new Error(`Jira API error ${res.status} (${statusText}) for ${issueKey}`);
    }

    const data = await res.json();
    return this.parseStory(data);
  }

  // ── Robust ADF Parser ────────────────────────────────────

  /**
   * Recursively parses Atlassian Document Format (ADF) into plain text.
   * Handles: paragraph, heading, bulletList, orderedList, listItem,
   * text, hardBreak, codeBlock, blockquote, table, panel, etc.
   */
  private parseADF(node: Record<string, unknown> | undefined | null, depth: number = 0): string {
    if (!node) return '';
    const type = node.type as string | undefined;
    const content = node.content as Array<Record<string, unknown>> | undefined;

    if (type === 'text') {
      const text = node.text as string || '';
      const marks = node.marks as Array<{ type: string }> | undefined;
      if (marks?.some((m) => m.type === 'code')) return `\`${text}\``;
      if (marks?.some((m) => m.type === 'bold')) return `**${text}**`;
      if (marks?.some((m) => m.type === 'italic')) return `*${text}*`;
      if (marks?.some((m) => m.type === 'strikethrough')) return `~~${text}~~`;
      if (marks?.some((m) => m.type === 'underline')) return `_${text}_`;
      if (marks?.some((m) => m.type === 'link')) {
        const href = marks.find((m) => m.type === 'link')?.attrs?.href as string | undefined;
        return href ? `[${text}](${href})` : text;
      }
      return text;
    }

    if (type === 'hardBreak') return '\n';

    if (!content || !Array.isArray(content)) {
      // Leaf nodes without content
      if (type === 'rule') return '\n---\n';
      if (type === 'emoji') {
        const shortName = (node.attrs as Record<string, unknown>)?.shortName as string | undefined;
        return shortName || '';
      }
      return '';
    }

    // Block-level nodes
    const indent = '  '.repeat(depth);

    switch (type) {
      case 'paragraph':
        return content.map((c) => this.parseADF(c, depth)).join('') + '\n\n';
      case 'heading':
        const level = (node.attrs?.level as number) || 1;
        const headingText = content.map((c) => this.parseADF(c, depth)).join('');
        return `${'#'.repeat(Math.min(level, 6))} ${headingText}\n\n`;
      case 'bulletList':
        return content
          .map((item) => `${indent}- ${this.parseListItem(item, depth + 1)}`)
          .join('\n') + '\n\n';
      case 'orderedList':
        return content
          .map((item, i) => `${indent}${i + 1}. ${this.parseListItem(item, depth + 1)}`)
          .join('\n') + '\n\n';
      case 'codeBlock':
        const lang = (node.attrs?.language as string) || '';
        const code = content.map((c) => this.parseADF(c, depth)).join('');
        return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      case 'blockquote':
        const bqText = content.map((c) => this.parseADF(c, depth + 1)).join('');
        return bqText.split('\n').map((l) => l ? `> ${l}` : '>').join('\n') + '\n\n';
      case 'table': {
        const rows = content.map((row) => {
          const cells = (row.content as Array<Record<string, unknown>> || [])
            .map((cell) => (cell.content as Array<Record<string, unknown>> || [])
              .map((c) => this.parseADF(c, depth).trim())
              .join(' ')
              .replace(/\n/g, ' '))
            .join(' | ');
          return `| ${cells} |`;
        });
        if (rows.length === 0) return '';
        // Add separator after header row
        const colCount = ((content[0]?.content as Array<unknown>) || []).length;
        const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
        return [rows[0], separator, ...rows.slice(1)].join('\n') + '\n\n';
      }
      case 'panel':
        const panelType = (node.attrs?.panelType as string) || 'info';
        const panelContent = content.map((c) => this.parseADF(c, depth)).join('');
        return `> **[${panelType.toUpperCase()}]** ${panelContent.trim()}\n\n`;
      case 'media': {
        const attrs = node.attrs as Record<string, unknown> | undefined;
        const alt = attrs?.alt as string || 'image';
        const src = attrs?.url as string || '';
        return src ? `![${alt}](${src})\n\n` : '';
      }
      default:
        // Unknown block — recurse into children
        return content.map((c) => this.parseADF(c, depth)).join('');
    }
  }

  private parseListItem(item: Record<string, unknown>, depth: number): string {
    const content = item.content as Array<Record<string, unknown>> | undefined;
    if (!content) return '';
    return content.map((c) => this.parseADF(c, depth)).join('').trim();
  }

  // ── Story Parser ─────────────────────────────────────────

  private parseStory(data: Record<string, unknown>): JiraStory {
    const fields = data.fields as Record<string, unknown>;
    const desc = fields.description as Record<string, unknown> | null;

    // Use the robust ADF parser for Atlassian Document Format
    let descText = '';
    if (desc && desc.type === 'doc' && Array.isArray(desc.content)) {
      descText = desc.content.map((node) => this.parseADF(node as Record<string, unknown>)).join('').trim();
    } else if (typeof desc === 'string') {
      // Fallback for plain text descriptions (e.g., from Jira Cloud comments)
      descText = desc;
    }

    // Try to extract acceptance criteria from description or custom field
    let acceptanceCriteria: string | undefined;
    // Check for custom field (e.g., "Acceptance Criteria" or "AC")
    for (const [key, value] of Object.entries(fields)) {
      if (
        /acceptance.criteria|ac[^a-z]/i.test(key) &&
        value &&
        typeof value === 'object' &&
        'content' in (value as Record<string, unknown>)
      ) {
        const acNode = value as Record<string, unknown>;
        if (acNode.type === 'doc' && Array.isArray(acNode.content)) {
          acceptanceCriteria = acNode.content
            .map((n) => this.parseADF(n as Record<string, unknown>))
            .join('')
            .trim();
        }
      }
    }

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
      acceptanceCriteria,
    };
  }
}

// ============================================================
// BigQuery Client — Real API only, no mocks
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
      throw new Error('BigQuery is not configured. Set GCP_PROJECT_ID and GCP_ACCESS_TOKEN environment variables.');
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err.error?.message as string) || `BQ API error ${res.status}`;
      throw new Error(msg);
    }
    const data = await res.json();
    return (data.datasets || []).map((d: Record<string, unknown>) => {
      const ref = d.datasetReference as Record<string, unknown>;
      return ref.datasetId as string;
    });
  }

  async getTableSchema(datasetId: string, tableId: string): Promise<TableSchema> {
    if (!this.isConfigured) {
      throw new Error('BigQuery is not configured. Set GCP_PROJECT_ID and GCP_ACCESS_TOKEN environment variables.');
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err.error?.message as string) || `BQ API error ${res.status}`;
      throw new Error(msg);
    }
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
      throw new Error('BigQuery is not configured.');
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/jobs`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        configuration: { query: { query: sql, dryRun: true, useLegacySql: false } },
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
    const bytesProcessed = Number(data.statistics?.query?.totalBytesProcessed || 0);
    return {
      valid: true,
      estimatedBytes: bytesProcessed,
      message: `Dry run passed. Estimated ${formatBytes(bytesProcessed)} processed.`,
    };
  }

  async runQuery(projectId: string, sql: string): Promise<QueryResult> {
    if (!this.isConfigured) {
      throw new Error('BigQuery is not configured.');
    }

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
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
}

// ============================================================
// GitHub Client — Real API only, no mocks
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
      throw new Error('GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO environment variables.');
    }

    // 1. Get default branch
    const repoRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!repoRes.ok) throw new Error(`GitHub API error ${repoRes.status} fetching repo info`);
    const repoData = await repoRes.json();
    const baseBranch = repoData.default_branch as string;

    // 2. Create branch
    const branchName = `sqlforge/${Date.now()}`;
    const mainSha = await this.getRefSha(baseBranch);
    await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/refs`, {
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
      `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/sql/${encodeURIComponent(fileName)}`,
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
    const prRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/pulls`, {
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

    if (!prRes.ok) throw new Error(`GitHub API error ${prRes.status} creating PR`);
    const prData = await prRes.json();
    return { url: prData.html_url as string, number: prData.number as number };
  }

  private async getRefSha(branch: string): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching branch ref`);
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
