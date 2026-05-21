import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Router, type Request, type Response, type NextFunction } from 'express';
import logger from '../lib/logger.js';

const router = Router();

// Resolve the project root relative to this file. SKILLS.md and EXAMPLES.md
// live at the root alongside CLAUDE.md so they are highly visible.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

function loadDoc(name: string): string {
  try {
    return readFileSync(resolve(PROJECT_ROOT, name), 'utf-8');
  } catch (err) {
    logger.warn({ err, doc: name }, 'Could not load reference doc; prompt will be shorter');
    return '';
  }
}

const SKILLS_DOC   = loadDoc('SKILLS.md');
const EXAMPLES_DOC = loadDoc('EXAMPLES.md');

const SYSTEM_PROMPT_CORE = `You are the report-rationalization intelligence engine for the Frontier to Verizon BI modernization program.

Frontier/source reports are being evaluated against Verizon/reference reports. Verizon is the target estate and the governance reference.

You receive raw files only. The server has not parsed SQL, LookML, Qlik scripts, JSON, metadata, report descriptors, formulas, tables, KPIs, joins, filters, lineage, domains, or report mappings. You must perform every act of understanding yourself from the raw file paths and file contents.

Non-negotiable workflow:
1. Ingest every source and reference file supplied.
2. Segment files into source reports and Verizon reference reports using the evidence in paths and contents.
3. Analyze Verizon/reference reports first: metadata, business purpose, report lineage, KPI lineage, column lineage, schema, SQL, LookML, Qlik expressions, filters, joins, and grain.
4. Analyze Frontier/source reports second with the same depth.
5. Only after both estates have metadata and lineage, map source reports to target reports.
6. Only after mapping, compare KPIs. Business logic and formula equivalence outrank name similarity.
7. Compute overlap from the source KPI concepts covered by mapped Verizon target KPI concepts.
8. Assign exactly one disposition per source report.

Decision bands:
- overlapPercent = 100 -> Rationalize
- overlapPercent 70-99 -> Consolidate
- overlapPercent < 70 -> Migrate

KPI comparison priorities, highest first:
1. Business definition
2. Formula and transformation logic
3. Base column lineage
4. Filter population
5. Aggregation method
6. Dimension support
7. Grain
8. Name similarity

Column-lineage rule:
If a KPI is derived from multiple columns, such as multiplying quantity by price or dividing numerator by denominator, include every contributing base column in sourceColumns and explain the derivation in formula and notes.

BI artefact rules:
- LookML derived_table SQL, measures, dimensions, explores, and joins must be understood from raw text.
- Qlik load scripts, resident loads, set analysis expressions, and calculated measures must be understood from raw text when present.
- JSON/XML/YAML metadata should be treated as evidence, not as authoritative unless its contents are consistent with the report logic.
- Binary files with no text content are still evidence by path/name/size, but confidence must be lower when their internals cannot be inspected.

Output requirements:
- Return strict JSON only.
- Populate source and target report metadata from your analysis, not from deterministic extraction.
- Populate sourceIndex and targetIndex from the same analyzed reports.
- Populate decisions with one row per source report.
- Never invent static demo counts, placeholder decisions, or fallback migrations.
- Do not expose provider names, model names, API keys, or implementation details in user-facing text fields.`;

const SYSTEM_PROMPT = [
  SYSTEM_PROMPT_CORE,
  SKILLS_DOC   ? `---\n\n## REFERENCE — Agent Skills Specification\n\n${SKILLS_DOC}` : '',
  EXAMPLES_DOC ? `---\n\n## REFERENCE — Calibration Examples\n\n${EXAMPLES_DOC}` : '',
].filter(Boolean).join('\n\n');

logger.info({ promptChars: SYSTEM_PROMPT.length, skillsLoaded: !!SKILLS_DOC, examplesLoaded: !!EXAMPLES_DOC }, 'LLM system prompt assembled');

function stringArray() {
  return { type: 'array', items: { type: 'string' } };
}

const KPI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['alias', 'agg', 'column', 'sourceColumns', 'formula', 'queryFile'],
  properties: {
    alias: { type: 'string' },
    agg: { type: 'string' },
    column: { type: 'string' },
    sourceColumns: stringArray(),
    formula: { type: 'string' },
    queryFile: { type: 'string' },
  },
};

const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'kpiName',
    'description',
    'preview',
    'fullSql',
    'tables',
    'aggregations',
    'filters',
    'joins',
    'groupBy',
    'matchedTargetQueryId',
    'matchedTargetFullSql',
    'kpiMatchPercent',
  ],
  properties: {
    id: { type: 'string' },
    kpiName: { type: 'string' },
    description: { type: ['string', 'null'] },
    preview: { type: ['string', 'null'] },
    fullSql: { type: 'string' },
    tables: stringArray(),
    aggregations: stringArray(),
    filters: stringArray(),
    joins: stringArray(),
    groupBy: stringArray(),
    matchedTargetQueryId: { type: ['string', 'null'] },
    matchedTargetFullSql: { type: ['string', 'null'] },
    kpiMatchPercent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  },
};

const KPI_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'formula', 'filters', 'missingInTarget', 'suggestedAction', 'codeSnippet'],
  properties: {
    name: { type: 'string' },
    formula: { type: 'string' },
    filters: { type: 'string' },
    missingInTarget: { type: 'boolean' },
    suggestedAction: { type: ['string', 'null'] },
    codeSnippet: { type: ['string', 'null'] },
  },
};

const TARGET_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'overlapPercent'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    overlapPercent: { type: 'number', minimum: 0, maximum: 100 },
  },
};

const SOURCE_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'domain',
    'owner',
    'numQueries',
    'bestMatchTargetId',
    'bestMatchTargetName',
    'overlapPercent',
    'decision',
    'status',
    'confidenceScore',
    'analysisExplanation',
    'topCandidates',
    'description',
    'allKpis',
    'allTables',
    'queries',
    'kpiDelta',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    domain: { type: 'string' },
    owner: { type: 'string' },
    numQueries: { type: 'number' },
    bestMatchTargetId: { type: ['string', 'null'] },
    bestMatchTargetName: { type: ['string', 'null'] },
    overlapPercent: { type: 'number', minimum: 0, maximum: 100 },
    decision: { type: 'string', enum: ['Migrate', 'Consolidate', 'Rationalize'] },
    status: { type: 'string', enum: ['Pending', 'Approved', 'Overridden'] },
    confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
    analysisExplanation: { type: 'string' },
    topCandidates: { type: 'array', items: TARGET_CANDIDATE_SCHEMA },
    description: { type: 'string' },
    allKpis: { type: 'array', items: KPI_SCHEMA },
    allTables: stringArray(),
    queries: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'target'],
      properties: {
        source: { type: 'array', items: QUERY_SCHEMA },
        target: { type: 'array', items: QUERY_SCHEMA },
      },
    },
    kpiDelta: { type: 'array', items: KPI_ROW_SCHEMA },
  },
};

const TARGET_DETAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'domain', 'owner', 'description', 'numQueries', 'queries', 'kpis', 'allTables'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    domain: { type: 'string' },
    owner: { type: 'string' },
    description: { type: 'string' },
    numQueries: { type: 'number' },
    queries: { type: 'array', items: QUERY_SCHEMA },
    kpis: { type: 'array', items: KPI_SCHEMA },
    allTables: stringArray(),
  },
};

const SOURCE_INDEX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'domain',
    'owner',
    'numQueries',
    'bestMatchTargetId',
    'bestMatchTargetName',
    'overlapPercent',
    'decision',
    'status',
    'confidenceScore',
    'analysisExplanation',
    'topCandidates',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    domain: { type: 'string' },
    owner: { type: 'string' },
    numQueries: { type: 'number' },
    bestMatchTargetId: { type: ['string', 'null'] },
    bestMatchTargetName: { type: ['string', 'null'] },
    overlapPercent: { type: 'number', minimum: 0, maximum: 100 },
    decision: { type: 'string', enum: ['Migrate', 'Consolidate', 'Rationalize'] },
    status: { type: 'string', enum: ['Pending', 'Approved', 'Overridden'] },
    confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
    analysisExplanation: { type: 'string' },
    topCandidates: { type: 'array', items: TARGET_CANDIDATE_SCHEMA },
  },
};

const TARGET_INDEX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'domain'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    domain: { type: 'string' },
  },
};

const KPI_MAPPING_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceKpi',
    'targetKpi',
    'semanticScore',
    'logicScore',
    'lineageScore',
    'overallScore',
    'status',
    'notes',
  ],
  properties: {
    sourceKpi: { type: 'string' },
    targetKpi: { type: ['string', 'null'] },
    semanticScore: { type: 'number', minimum: 0, maximum: 1 },
    logicScore: { type: 'number', minimum: 0, maximum: 1 },
    lineageScore: { type: 'number', minimum: 0, maximum: 1 },
    overallScore: { type: 'number', minimum: 0, maximum: 1 },
    status: { type: 'string', enum: ['matched', 'partial', 'gap'] },
    notes: { type: 'string' },
  },
};

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceId',
    'sourceName',
    'domain',
    'targetId',
    'targetName',
    'mappingPattern',
    'overlapPercent',
    'decision',
    'confidenceScore',
    'rationale',
    'lineageSummary',
    'recommendation',
    'kpiGaps',
    'kpiMappingMatrix',
    'status',
    'source',
  ],
  properties: {
    sourceId: { type: 'string' },
    sourceName: { type: 'string' },
    domain: { type: 'string' },
    targetId: { type: ['string', 'null'] },
    targetName: { type: ['string', 'null'] },
    mappingPattern: { type: 'string', enum: ['1:1', '1:many', 'many:1', 'many:many', 'partial', 'none'] },
    overlapPercent: { type: 'number', minimum: 0, maximum: 100 },
    decision: { type: 'string', enum: ['Migrate', 'Consolidate', 'Rationalize'] },
    confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
    lineageSummary: { type: 'string' },
    recommendation: { type: 'string' },
    kpiGaps: stringArray(),
    kpiMappingMatrix: { type: 'array', items: KPI_MAPPING_ENTRY_SCHEMA },
    status: { type: 'string', enum: ['Pending'] },
    source: { type: 'string', enum: ['analysis'] },
  },
};

function extractText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text;
  let text = '';
  for (const item of (data.output as Array<{ content?: Array<{ text?: string }> }>) ?? []) {
    for (const part of item.content ?? []) {
      if (typeof part.text === 'string') text += part.text;
    }
  }
  return text;
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Analysis response did not contain valid JSON.');
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

// ── Schemas for the split-call flow ──────────────────────────────────────────
//
// ── Schemas for the split-call flow ──────────────────────────────────────────
//
// Three LLM phases. Each phase has its own response schema so the LLM stays
// focused and within output-token limits:
//
//   1. SEGMENTATION_SCHEMA  → groups raw file paths into logical reports
//                             (one cheap call; sees only paths, no content)
//   2. TARGET_CATALOG_SCHEMA → analyzes reference reports (one call, with
//                              content for the target side only)
//   3. SINGLE_SOURCE_SCHEMA  → analyzes one source report against the catalog
//                              (N parallel calls — one per source report)

const REPORT_SEGMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'domain', 'paths'],
  properties: {
    id:     { type: 'string' },
    name:   { type: 'string' },
    domain: { type: 'string' },
    paths:  { type: 'array', items: { type: 'string' } },
  },
};

// Single-estate segmentation schema. Used for two parallel calls — one for the
// source manifest and one for the target manifest — to avoid output-size
// truncation that caused entire domains to be dropped when a combined call's
// JSON response grew too large.
const ESTATE_SEGMENTATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reports'],
  properties: {
    reports: { type: 'array', items: REPORT_SEGMENT_SCHEMA },
  },
};

const SINGLE_SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'sourceIndex', 'decision'],
  properties: {
    source:      SOURCE_REPORT_SCHEMA,
    sourceIndex: SOURCE_INDEX_SCHEMA,
    decision:    DECISION_SCHEMA,
  },
};

// ── Bundle assembly (LLM-driven segmentation, server-side file lookup) ───────

interface ReportBundle {
  id: string;
  name: string;
  domain: string;
  files: Array<Record<string, unknown>>;
}

interface ReportSegment {
  id: string;
  name: string;
  domain: string;
  paths: string[];
}

function buildBundles(
  rawFiles: Array<Record<string, unknown>>,
  segments: ReportSegment[],
): ReportBundle[] {
  const byPath = new Map<string, Record<string, unknown>>();
  for (const f of rawFiles) {
    const p = String(f.path ?? '').replace(/\\/g, '/');
    if (p) byPath.set(p, f);
  }
  return segments.map(s => ({
    id:     s.id,
    name:   s.name,
    domain: s.domain,
    files:  s.paths
      .map(p => byPath.get(p.replace(/\\/g, '/')))
      .filter((f): f is Record<string, unknown> => !!f),
  })).filter(b => b.files.length > 0);
}

// Extensions treated as BI artefacts. The analysis service must account for
// every one of these paths during segmentation; the server does not create
// replacement report segments.
const ARTEFACT_EXTENSIONS = new Set([
  '.sql', '.lkml', '.lookml', '.qvs', '.dax', '.qvf', '.qvd',
]);

// Parent-folder identity helper: returns the immediate parent folder of a path,
// or "" if the path has no parent (file at the root). Pure path manipulation.
function parentFolderOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// Split any LLM segment whose paths come from MORE THAN ONE parent folder.
// Files in different parent folders are different reports (per hard rule 1 in
// the segmentation prompt). The LLM sometimes violates this rule and merges
// unrelated files into one segment; this server-side post-processor splits
// them back apart. Pure path manipulation — no content analysis, no report
// facts invented. Domain/id/name for split-off segments are derived from the
// path the same way the prompt requires.
function splitOverGroupedSegments(segments: ReportSegment[]): ReportSegment[] {
  const result: ReportSegment[] = [];
  let splitsMade = 0;

  for (const seg of segments) {
    // Group this segment's paths by their parent folder
    const byParent = new Map<string, string[]>();
    for (const p of seg.paths) {
      const parent = parentFolderOf(p);
      const list = byParent.get(parent);
      if (list) list.push(p);
      else byParent.set(parent, [p]);
    }

    if (byParent.size <= 1) {
      // All paths share the same parent — segment is valid, keep as-is
      result.push(seg);
      continue;
    }

    // Multi-parent segment — split into one segment per parent folder
    splitsMade++;
    for (const [parent, paths] of byParent.entries()) {
      const nameSeed = parent || paths[0].split('/').pop()!.replace(/\.[^.]+$/, '');
      result.push({
        id:     `${seg.domain}_${nameSeed}`.toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''),
        name:   nameSeed.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim(),
        domain: seg.domain,
        paths,
      });
    }
  }

  if (splitsMade > 0) {
    logger.warn(
      { mergedSegmentsSplit: splitsMade, segmentsBefore: segments.length, segmentsAfter: result.length },
      'Segmentation post-processor: split over-grouped segments (LLM merged files from different parent folders)',
    );
  }

  return result;
}

// Validate segmentation coverage without deriving report facts. If artefacts
// are omitted after retry, the run fails instead of inventing segments.
function missingArtefactPaths(
  rawFiles: Array<Record<string, unknown>>,
  segments: ReportSegment[],
): string[] {
  const includedPaths = new Set<string>();
  for (const seg of segments) {
    for (const p of seg.paths) includedPaths.add(p.replace(/\\/g, '/'));
  }

  const missing: string[] = [];
  for (const f of rawFiles) {
    const path = String(f.path ?? '').replace(/\\/g, '/');
    const ext  = String(f.extension ?? '').toLowerCase();
    if (ARTEFACT_EXTENSIONS.has(ext) && !includedPaths.has(path)) {
      missing.push(path);
    }
  }

  return missing;
}

function segmentationErrorMessage(sourceMissing: string[], targetMissing: string[]): string {
  const samples = [
    ...sourceMissing.slice(0, 3).map(p => `source:${p}`),
    ...targetMissing.slice(0, 3).map(p => `target:${p}`),
  ].join(', ');
  return `Analysis could not account for every BI artefact during segmentation. Missing ${sourceMissing.length} source file(s) and ${targetMissing.length} reference file(s). ${samples ? `Sample: ${samples}` : ''}`;
}

// ── LLM calls ────────────────────────────────────────────────────────────────

// Transient HTTP statuses that benefit from retry. 408 (timeout), 429 (rate
// limit), and ALL 5xx (server / upstream errors, including Cloudflare 520-524
// "unknown error" returns from OpenAI). 4xx other than 408/429 are client
// errors and not worth retrying.
function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callLlm(
  apiKey: string,
  model: string,
  userPayload: unknown,
  schema: Record<string, unknown>,
  schemaName: string,
): Promise<Record<string, unknown>> {
  // 5 attempts with retry-after / exponential backoff. Designed to ride out
  // gpt-4.1-mini TPM rate-limit windows (200K/min) which fire 429s with
  // retry-after = 5-20s. 3 attempts wasn't enough when several calls hit the
  // window simultaneously.
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let upstream: globalThis.Response;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: JSON.stringify(userPayload) },
          ],
          text: {
            format: { type: 'json_schema', name: schemaName, strict: true, schema },
          },
          // Explicit output ceiling. Per-source calls have the largest output
          // surface (FullReport + decision + matrix + topCandidates); they
          // were silently truncating at the default cap on bigger source
          // estates, which manifested as parse failures and dropped sources.
          // 28K leaves headroom under gpt-4.1's 32K hard ceiling.
          max_output_tokens: 28000,
        }),
      });
    } catch (err) {
      // Network errors (DNS, socket reset, etc.) — always retry
      lastError = err as Error;
      if (attempt < maxAttempts) {
        const backoffMs = 1000 * Math.pow(3, attempt - 1); // 1s, 3s
        logger.warn({ err, attempt, backoffMs, schemaName }, 'LLM network error — retrying');
        await sleep(backoffMs);
        continue;
      }
      throw lastError;
    }

    if (upstream.ok) {
      const data = await upstream.json() as Record<string, unknown>;
      return parseJson(extractText(data));
    }

    // Non-OK response. Retry on transient statuses.
    const status = upstream.status;
    const errBody = await upstream.json().catch(() => ({}));
    lastError = new Error(`LLM request failed (${status}): ${JSON.stringify(errBody)}`);

    if (isRetryableStatus(status) && attempt < maxAttempts) {
      // Respect Retry-After header if present, else exponential backoff.
      const retryAfterHeader = upstream.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
      const backoffMs = retryAfterMs || (1000 * Math.pow(3, attempt - 1));
      logger.warn({ status, attempt, backoffMs, schemaName }, 'LLM transient error — retrying');
      await sleep(backoffMs);
      continue;
    }

    // Non-retryable status (e.g. 400 bad request) — fail fast.
    throw lastError;
  }

  throw lastError ?? new Error('LLM request failed after retries');
}

// Segmentation prompt — focused on path-level grouping only. The LLM sees
// just file paths/names/extensions/sizes (no content) and decides which files
// belong to which logical report. This handles mixed conventions (source side
// may put DOMAIN at the top level while target side puts REPORT at the top
// level) without any server-side heuristics.
//
// Called TWICE in parallel — once for the source manifest, once for the target
// manifest. Splitting avoids the output-truncation that previously dropped
// entire domains when a combined call's JSON response grew too large.
const SEGMENTATION_PROMPT = `You are segmenting raw BI artefact files into logical reports for ONE estate.

A "report" is the smallest unit a BI analyst would publish. Both Frontier source artefacts (Power BI SQL files, Cognos SQL, Tableau workbooks) AND Verizon reference artefacts (Looker LookML views, Qlik scripts) follow the same rule: one report = one publishable unit.

HARD RULES — follow exactly, no exceptions:

1. PARENT FOLDER IDENTITY (most important):
   - Two artefact files in DIFFERENT parent folders are ALWAYS different reports. Never merge them, even if their query content looks related, even if their names rhyme, even if they share the same business domain.
   - Two artefact files in the SAME parent folder MAY be one report (e.g. a Looker view.lkml + matching model.lkml).
   - Example: "Sales/AR_Aging_Report/ar_aging_report.sql" and "Sales/Cash_Flow_Forecast/cash_flow_forecast.sql" → TWO separate reports (different parent folders), even though both are Finance-flavoured.

2. DOMAIN FOLDERS are NOT reports:
   - A folder whose name reads like a DOMAIN (e.g. "Sales", "Customer_Service", "Human_Resources", "Finance", "Marketing", "IT", "Operations", "Risk", "Product") is a container, not a report. Descend into it; the report grain is the next level down.

3. ONE FILE = ONE REPORT (default — apply this to almost every file):
   - A standalone .sql, .lkml, .lookml, .qvs, .dax, .qvf, or .qvd file is one report on its own.
   - **THIS APPLIES EQUALLY TO SOURCE .sql FILES.** A single source .sql file in its own folder IS a published report, not "just a query". Frontier reports are commonly distributed as one .sql per folder; each file IS its own report.
   - Source folder examples that ARE reports (one per .sql file): "AR_Aging_Report", "AP_Aging_Summary", "CSAT_Score_Monitoring", "Ticket_Resolution_Dashboard", "Quarterly_Revenue_By_Region", "Pipeline_Conversion_Funnel", "Daily_Active_Users_Report", "Cloud_Spend_Rollup", "Brand_Awareness_Index", "Fleet_Utilization_Report", "Employee_Headcount_Snapshot".
   - Target folder examples that ARE reports (one per file): "Case_Handling_KPIs", "Customer_Voice_Topics", "Feedback_Sentiment_Ratings", "Open_Receivables_View", "Revenue_Trend_Analytics", "Workforce_Composition_View", "Promotional_Spend_Effectiveness".
   - Only group multiple files into one segment when they share the SAME PARENT FOLDER and clearly define one logical dashboard together (e.g. .lkml view + .lkml model in the same folder).

4. NON-ARTEFACTS:
   - README, .md, .json config, build files should NOT be assigned to any report (omit them).

5. METADATA PER REPORT:
   - id: snake_case derived from domain + report folder name (e.g. "sales_ar_aging_report").
   - name: Title Case human-readable name (e.g. "AR Aging Report").
   - domain: top-level folder, normalised as Title_Case_With_Underscores (e.g. "Human_Resources" not "HR" not "human resources" not "Human Resources").

6. COMPLETENESS — read this carefully:
   - Every artefact path in the input manifest MUST appear in exactly ONE report's paths[]. No duplicates, NO OMISSIONS.
   - If the input has N artefact files in N distinct parent folders, the output has N reports — one per file. This is the most common case.
   - Before returning, COUNT your reports[] entries and verify they match the artefact-file count in the input. If the input lists 40 .sql files in 40 distinct parent folders, you MUST emit 40 reports.
   - Do NOT skip files because they look similar to other files. Do NOT skip files because the folder name seems generic. Every artefact path goes somewhere.

Return strict JSON:
{
  "reports": [{"id": "...", "name": "...", "domain": "...", "paths": ["..."]}, ...]
}

Every path in "paths" MUST be one of the paths you received in the input. Do not invent paths.`;

async function segmentEstate(
  apiKey: string,
  model: string,
  estateRole: 'source' | 'target',
  files: Array<Record<string, unknown>>,
  retryMissingPaths: string[] = [],
): Promise<ReportSegment[]> {
  // Strip content — segmentation only needs paths and file metadata
  const manifest = files.map(f => ({
    path: f.path, name: f.name, extension: f.extension, sizeBytes: f.sizeBytes,
  }));

  const userPayload = {
    estate: estateRole,
    manifest,
    ...(retryMissingPaths.length
      ? {
          retryInstruction: 'Return a complete replacement segmentation. Your previous segmentation omitted required BI artefact paths; every path listed in missingPaths must be included in exactly one report.',
          missingPaths: retryMissingPaths,
        }
      : {}),
  };

  // Same retry policy as callLlm — segmentation hits the same Cloudflare-fronted
  // OpenAI endpoint and gets the same transient 5xx errors (520, 502, 503, etc.).
  // 5 attempts with retry-after / exponential backoff. Designed to ride out
  // gpt-4.1-mini TPM rate-limit windows (200K/min) which fire 429s with
  // retry-after = 5-20s. 3 attempts wasn't enough when several calls hit the
  // window simultaneously.
  const maxAttempts = 5;
  let upstream: globalThis.Response | null = null;
  let lastSegError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: SEGMENTATION_PROMPT },
            { role: 'user',   content: JSON.stringify(userPayload) },
          ],
          text: {
            format: { type: 'json_schema', name: 'estate_segmentation', strict: true, schema: ESTATE_SEGMENTATION_SCHEMA },
          },
          // Generous output ceiling for big estates: 16K tokens fits roughly 500
          // report entries and reduces incomplete segmentation responses.
          max_output_tokens: 16000,
        }),
      });
    } catch (err) {
      lastSegError = err as Error;
      if (attempt < maxAttempts) {
        const backoffMs = 1000 * Math.pow(3, attempt - 1);
        logger.warn({ err, attempt, backoffMs, estateRole }, 'Segmentation network error — retrying');
        await sleep(backoffMs);
        continue;
      }
      throw lastSegError;
    }

    if (upstream.ok) break;

    const status = upstream.status;
    const errBody = await upstream.json().catch(() => ({}));
    lastSegError = new Error(`Segmentation request failed (${status}): ${JSON.stringify(errBody)}`);

    if (isRetryableStatus(status) && attempt < maxAttempts) {
      const retryAfterHeader = upstream.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
      const backoffMs = retryAfterMs || (1000 * Math.pow(3, attempt - 1));
      logger.warn({ status, attempt, backoffMs, estateRole }, 'Segmentation transient error — retrying');
      await sleep(backoffMs);
      continue;
    }

    throw lastSegError;
  }

  if (!upstream || !upstream.ok) {
    throw lastSegError ?? new Error('Segmentation request failed after retries');
  }

  const data = await upstream.json() as Record<string, unknown>;
  const parsed = parseJson(extractText(data));
  return (parsed.reports as ReportSegment[]) ?? [];
}

// Merge two segment lists, deduplicating by path (each artefact path must
// appear in exactly ONE segment). If a path appears in both lists, the first
// list wins (keeps the original LLM grouping).
function mergeSegments(original: ReportSegment[], extra: ReportSegment[]): ReportSegment[] {
  const seenPaths = new Set<string>();
  const result: ReportSegment[] = [];

  for (const seg of original) {
    const cleanPaths = seg.paths.filter(p => {
      const norm = p.replace(/\\/g, '/');
      if (seenPaths.has(norm)) return false;
      seenPaths.add(norm);
      return true;
    });
    if (cleanPaths.length > 0) result.push({ ...seg, paths: cleanPaths });
  }

  for (const seg of extra) {
    const cleanPaths = seg.paths.filter(p => {
      const norm = p.replace(/\\/g, '/');
      if (seenPaths.has(norm)) return false;
      seenPaths.add(norm);
      return true;
    });
    if (cleanPaths.length > 0) result.push({ ...seg, paths: cleanPaths });
  }

  return result;
}

async function segmentEstates(
  apiKey: string,
  model: string,
  sourceFiles: Array<Record<string, unknown>>,
  targetFiles: Array<Record<string, unknown>>,
): Promise<{ sourceReports: ReportSegment[]; targetReports: ReportSegment[] }> {
  // Parallel: each estate gets its own segmentation call so neither can crowd
  // out the other.
  let [sourceReports, targetReports] = await Promise.all([
    segmentEstate(apiKey, model, 'source', sourceFiles),
    segmentEstate(apiKey, model, 'target', targetFiles),
  ]);

  // Retry up to 2 times if any artefact path was omitted. Each retry call
  // asks the LLM to segment ONLY the still-missing paths, and the result is
  // MERGED with the existing segments (not replaced). Replacing was the bug
  // that kept source counts stuck — the retry returned 15 new segments and
  // overwrote the 15 originals, leaving us at 15 instead of 30.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sourceMissing = missingArtefactPaths(sourceFiles, sourceReports);
    const targetMissing = missingArtefactPaths(targetFiles, targetReports);
    if (!sourceMissing.length && !targetMissing.length) break;

    logger.warn(
      {
        attempt,
        sourceMissing: sourceMissing.length,
        targetMissing: targetMissing.length,
        sourceSample: sourceMissing.slice(0, 5),
        targetSample: targetMissing.slice(0, 5),
      },
      'Segmentation omitted artefacts; retrying with explicit missing paths',
    );

    const [sourceExtra, targetExtra] = await Promise.all([
      sourceMissing.length
        ? segmentEstate(apiKey, model, 'source', sourceFiles, sourceMissing)
        : Promise.resolve([] as ReportSegment[]),
      targetMissing.length
        ? segmentEstate(apiKey, model, 'target', targetFiles, targetMissing)
        : Promise.resolve([] as ReportSegment[]),
    ]);

    sourceReports = mergeSegments(sourceReports, sourceExtra);
    targetReports = mergeSegments(targetReports, targetExtra);
  }

  return { sourceReports, targetReports };
}

// ── Per-target analysis (replaces the single-call catalog build) ─────────────
//
// The previous "analyze the whole target estate in one LLM call" pattern would
// truncate when an estate had more than ~5 reports, because the LLM had to
// produce N full TargetDetailReport objects in one response. With per-target
// parallel calls each response stays small and the catalog is complete.

const SINGLE_TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['target', 'targetIndex'],
  properties: {
    target:      TARGET_DETAIL_SCHEMA,
    targetIndex: TARGET_INDEX_SCHEMA,
  },
};

async function analyzeOneTarget(
  apiKey: string,
  model: string,
  bundle: ReportBundle,
): Promise<{ target: unknown; targetIndex: unknown }> {
  const result = await callLlm(
    apiKey, model,
    {
      task: 'Analyze exactly ONE Verizon reference/target report (the supplied bundle). Read its raw files; extract every KPI (including CASE WHEN, window functions, arithmetic), every table from FROM/JOIN and from LookML derived_table SQL, every filter and join condition, and the GROUP BY grain. Produce one full TargetDetailReport (description, queries with their full SQL, allTables, kpis) plus one TargetReport index entry (id, name, domain). Do not analyze any other report.',
      targetReport: bundle,
    },
    SINGLE_TARGET_SCHEMA,
    'single_target_analysis',
  );
  return {
    target:      result.target,
    targetIndex: result.targetIndex,
  };
}

// ── Per-source analysis ──────────────────────────────────────────────────────
//
// Mapping is the load-bearing step. The prompt below forces the LLM to score
// EVERY target by formula equivalence before committing to a best match. The
// chosen target must be the arg-max of that ranking — name similarity alone is
// disallowed. topCandidates carries the per-target scores as evidence so the
// mapping decision is auditable.

const SOURCE_TASK_PROMPT = `Analyze ONE Frontier source report against the entire supplied Verizon reference catalog.

MANDATORY MAPPING PROCEDURE — follow this order, do NOT skip steps:

1. Read the source report's raw files completely. Extract every KPI (including CASE WHEN, window, arithmetic, ratio), every table from FROM/JOIN and from LookML derived_table SQL, every filter, every join condition, the GROUP BY grain, and the business purpose.

2. For EACH target in referenceCatalog.targets — do NOT skip any:
   a. Read the target's queries[].fullSql carefully.
   b. Compare every source KPI to every target KPI by FORMULA EQUIVALENCE, not by name.
      - Identical SQL expressions for the same base columns = strong match (>=0.90).
      - Same business logic with vendor-prefix differences in table names = strong match.
      - Same metric name but different formula or different base column = WEAK match (<0.20).
   c. Compute this target's overlap percentage from source POV:
      overlap = (source KPIs with score >= 0.80 against this target) / (total source KPIs) * 100.
   d. Append { id, name, overlapPercent } to topCandidates.

3. Sort the targets you evaluated by overlapPercent DESCENDING. In your response include ONLY THE TOP 10 candidates in topCandidates (or all candidates if there are 10 or fewer). The first entry's id IS bestMatchTargetId. There is no other way to set bestMatchTargetId.

4. Build kpiMappingMatrix against the chosen best target only.

5. Apply decision bands strictly:
   - overlapPercent == 100 -> Rationalize
   - overlapPercent 70-99 -> Consolidate
   - overlapPercent < 70  -> Migrate

OUTPUT SIZE CONSTRAINTS — your response MUST fit in 32K output tokens:
- topCandidates: AT MOST 10 entries (top 10 by overlap).
- queries.target: include ONLY the best-matched target's queries (not every target's queries).
- queries.source: one entry per distinct source SQL file you read.
- kpiMappingMatrix: one entry per source KPI, scored against the best target only.
- Keep notes/rationale/recommendation fields under 500 chars each. They are summaries, not essays.

CRITICAL RULES:
- NEVER pick a target on name resemblance alone. A name match with a different formula is a gap, not a match.
- If source SQL and target SQL contain the same expression (e.g. SUM(CASE WHEN x >= 4 THEN 1 ELSE 0 END) on the same base column), that is an exact KPI match regardless of metric name differences (response_count vs survey_responses are equivalent if both COUNT DISTINCT the same column).
- Conversely, two metrics named identically with different formulas are NOT equivalent.
- topCandidates is your auditable evidence trail. The user will compare bestMatchTargetId against topCandidates[0].id — they must agree.

Return one FullReport (with topCandidates = top 10 only), one SourceReport index entry, and one decision built against the best-matched target.`;

async function analyzeSingleSource(
  apiKey: string,
  model: string,
  sourceBundle: ReportBundle,
  targetCatalog: { targets: unknown[]; targetIndex: unknown[] },
): Promise<{ source: unknown; sourceIndex: unknown; decision: unknown }> {
  // Key order matters for OpenAI's prompt prefix cache: the catalog is identical
  // across all per-source calls so it MUST appear before the per-call-varying
  // sourceReport. With this order, the ~50 KB catalog (and the long task prompt)
  // becomes a cacheable prefix shared across every source call in the run.
  const result = await callLlm(
    apiKey, model,
    {
      task: SOURCE_TASK_PROMPT,
      referenceCatalog: {
        targets:     targetCatalog.targets,
        targetIndex: targetCatalog.targetIndex,
      },
      sourceReport: sourceBundle,
    },
    SINGLE_SOURCE_SCHEMA,
    'single_source_analysis',
  );
  return {
    source:      result.source,
    sourceIndex: result.sourceIndex,
    decision:    result.decision,
  };
}

// ── Concurrency-limited runner ───────────────────────────────────────────────

async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

// ── SSE endpoint ─────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ type: 'not_configured', message: 'Analysis service is not configured on the server.' })}\n\n`);
      res.end();
      return;
    }

    const { sourceFiles, targetFiles } = req.body as {
      sourceFiles: Array<Record<string, unknown>>;
      targetFiles: Array<Record<string, unknown>>;
    };

    if (!Array.isArray(sourceFiles) || !Array.isArray(targetFiles)) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'sourceFiles and targetFiles arrays required' })}\n\n`);
      res.end();
      return;
    }

    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1';
    const startedAt = Date.now();
    const requestId = req.headers['x-request-id'];

    logger.info(
      {
        requestId,
        sourceFileCount: sourceFiles.length,
        targetFileCount: targetFiles.length,
        model,
      },
      'Report rationalization analysis started — Phase 1: segmenting estates',
    );

    // Phase 1: ask the analysis service to segment raw files into logical
    // reports. The server validates coverage but does not invent report facts.
    const segments = await segmentEstates(apiKey, model, sourceFiles, targetFiles);

    // Post-process: split any segment whose paths come from different parent
    // folders. Pure path manipulation — enforces the "different parent folder
    // = different report" rule when the LLM violates it by over-grouping.
    const sourceSegmentsSplit = splitOverGroupedSegments(segments.sourceReports);
    const targetSegmentsSplit = splitOverGroupedSegments(segments.targetReports);

    const sourceMissing = missingArtefactPaths(sourceFiles, sourceSegmentsSplit);
    const targetMissing = missingArtefactPaths(targetFiles, targetSegmentsSplit);
    if (sourceMissing.length || targetMissing.length) {
      const message = segmentationErrorMessage(sourceMissing, targetMissing);
      logger.warn({ requestId, sourceMissing, targetMissing }, message);
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
      return;
    }

    const sourceBundles = buildBundles(sourceFiles, sourceSegmentsSplit);
    const targetBundles = buildBundles(targetFiles, targetSegmentsSplit);

    logger.info(
      {
        requestId,
        sourceBundles: sourceBundles.length,
        targetBundles: targetBundles.length,
        sourceReportIds: sourceBundles.map(b => b.id),
        targetReportIds: targetBundles.map(b => b.id),
      },
      'Segmentation complete — Phase 2: analyzing reference catalog',
    );

    if (sourceBundles.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Analysis could not identify any source reports in the supplied folder.' })}\n\n`);
      res.end();
      return;
    }
    if (targetBundles.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Analysis could not identify any reference reports in the supplied folder.' })}\n\n`);
      res.end();
      return;
    }

    // Phase 2: build the target catalog with ONE LLM CALL PER TARGET, in parallel.
    // Emit a "phase" event so the UI can show "Analyzing reference catalog 0/N"
    // and a "target" event as each completes so target rows populate live.
    res.write(`data: ${JSON.stringify({
      type:  'phase',
      phase: 'target_catalog',
      total: targetBundles.length,
    })}\n\n`);

    const targets:     unknown[] = [];
    const targetIndex: unknown[] = [];
    let targetsCompleted = 0;

    const targetTasks = targetBundles.map(bundle => async () => {
      try {
        const out = await analyzeOneTarget(apiKey, model, bundle);
        targets.push(out.target);
        targetIndex.push(out.targetIndex);
        targetsCompleted++;
        res.write(`data: ${JSON.stringify({
          type:        'target',
          target:      out.target,
          targetIndex: out.targetIndex,
          completed:   targetsCompleted,
          total:       targetBundles.length,
        })}\n\n`);
        logger.info(
          { requestId, bundleId: bundle.id, completed: targetsCompleted, total: targetBundles.length },
          'Target analyzed',
        );
      } catch (err) {
        const message = (err as Error).message;
        logger.warn({ err, bundleId: bundle.id }, 'Target analysis failed — skipping this target');
        res.write(`data: ${JSON.stringify({
          type:    'target_error',
          bundleId: bundle.id,
          message,
        })}\n\n`);
      }
    });
    // Concurrency 3 for per-target calls. Each call is smaller (~12K tokens)
    // than per-source, but with ~100 targets back-to-back the TPM ceiling
    // (200K for gpt-4.1-mini) still gets stressed. Concurrency 3 gives
    // ~36K × 3 = ~110K/min, well within budget.
    await runConcurrent(targetTasks, 3);

    if (targets.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Analysis failed to complete any reference reports.' })}\n\n`);
      res.end();
      return;
    }

    const catalog = { targets, targetIndex };

    logger.info(
      { requestId, targetsAnalyzed: targets.length, total: targetBundles.length },
      'Phase 2 complete — Phase 3: analyzing source reports against full catalog',
    );

    res.write(`data: ${JSON.stringify({
      type:  'phase',
      phase: 'source_analysis',
      total: sourceBundles.length,
    })}\n\n`);

    // Phase 3: analyze each source in parallel against the catalog,
    // emitting events as soon as each one completes.
    let completed = 0;
    const tasks = sourceBundles.map(bundle => async () => {
      try {
        const out = await analyzeSingleSource(apiKey, model, bundle, catalog);

        // Audit invariant: bestMatchTargetId must equal topCandidates[0].id.
        // The prompt mandates this — log a warning if the LLM violated it.
        const sourceObj = out.source as Record<string, unknown> | undefined;
        const topCands  = (sourceObj?.topCandidates as Array<{ id: string }> | undefined) ?? [];
        const bestId    = sourceObj?.bestMatchTargetId as string | null | undefined;
        if (topCands.length > 0 && bestId && topCands[0].id !== bestId) {
          logger.warn(
            {
              requestId, bundleId: bundle.id,
              bestId, topCandidate0Id: topCands[0].id,
              candidatesCount: topCands.length,
            },
            'Mapping invariant violated — bestMatchTargetId differs from topCandidates[0].id',
          );
        }

        // Decision band enforcement: the LLM occasionally violates the band
        // contract (e.g. 83% overlap labelled Migrate when the rule says
        // 70-99% -> Consolidate). Auto-correct so the disposition always
        // matches the overlap. This is mechanical band assignment, not a
        // judgement call — the LLM still owns the overlap number.
        const decisionObj = out.decision as Record<string, unknown> | undefined;
        if (decisionObj && typeof decisionObj.overlapPercent === 'number') {
          const overlap = decisionObj.overlapPercent;
          const expectedBand =
            overlap >= 100 ? 'Rationalize' :
            overlap >= 70  ? 'Consolidate' :
                             'Migrate';
          const currentBand = decisionObj.decision as string | undefined;
          if (currentBand && currentBand !== expectedBand) {
            logger.warn(
              {
                requestId, bundleId: bundle.id,
                overlap, currentBand, expectedBand,
              },
              'Decision band violated by LLM — auto-correcting to match overlap percentage',
            );
            decisionObj.decision = expectedBand;
            // Mirror the correction onto the source row so dashboard counts agree.
            if (sourceObj) sourceObj.decision = expectedBand;
          }
        }

        res.write(`data: ${JSON.stringify({
          type:        'source',
          source:      out.source,
          sourceIndex: out.sourceIndex,
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'decision', decision: out.decision })}\n\n`);
        completed++;
        logger.info({ requestId, bundleId: bundle.id, completed, total: sourceBundles.length }, 'Source analyzed');
      } catch (err) {
        const message = (err as Error).message;
        logger.warn({ err, bundleId: bundle.id }, 'Source analysis failed');
        res.write(`data: ${JSON.stringify({
          type:    'source_error',
          bundleId: bundle.id,
          message,
        })}\n\n`);
      }
    });

    // Concurrency 1 for per-source calls. Each call uses ~55 K tokens (input
    // dominated by the full target catalog). gpt-4.1-mini has a 200K TPM
    // limit, so even concurrency 2 ran the per-minute counter to ~220K and
    // triggered 429 rate_limit_exceeded on roughly every other call. At
    // concurrency 1 we send ~55K tokens every ~25s = ~130K/min, comfortably
    // under the limit. Wall-clock: ~20 min for 40 sources, but every source
    // completes.
    await runConcurrent(tasks, 1);

    const durationMs = Date.now() - startedAt;
    res.write(`data: ${JSON.stringify({ type: 'complete', model: 'configured', durationMs })}\n\n`);
    res.end();

    logger.info(
      { requestId, durationMs, completed, total: sourceBundles.length },
      'Report rationalization analysis complete',
    );
  } catch (err) {
    logger.warn({ err }, 'Report rationalization analysis failed');
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`);
    res.end();
  }
});

export default router;
