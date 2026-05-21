import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  LayoutDashboard,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { Decision, FullReport, QueryItem, TargetDetailReport, TargetReport } from './types';
import {
  KpiMappingEntry,
  loadReportInventoryFromPaths,
  RationalizationDecision,
  ReportInventory,
  streamRationalizationAnalysis,
} from './dataLayer';

type TabKey = 'dashboard' | 'source-lineage' | 'target-lineage' | 'source-metadata' | 'target-metadata' | 'decision';
type WorkbenchPhase = 'intake' | 'loading' | 'analysing' | 'ready';

const SOURCE_ORG = 'Source';
const TARGET_ORG = 'Target';

const TABS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'source-lineage', label: 'Source Lineage', icon: GitBranch },
  { key: 'target-lineage', label: 'Target Lineage', icon: Network },
  { key: 'source-metadata', label: 'Source Metadata', icon: FileText },
  { key: 'target-metadata', label: 'Target Metadata', icon: Database },
  { key: 'decision', label: 'Disposition', icon: ShieldCheck },
];

// Rationalize = best outcome (source retired, already covered) → green
// Migrate     = highest effort (build new, no equivalent)       → orange
// Consolidate = medium effort (extend target to absorb source)  → blue
const DECISION_STYLE: Record<Decision, { bg: string; text: string; border: string; accent: string }> = {
  Rationalize: { bg: '#f0fdf4', text: '#166534', border: '#86efac', accent: '#22c55e' },
  Migrate:     { bg: '#fff4e5', text: '#92400e', border: '#fdba74', accent: '#f97316' },
  Consolidate: { bg: '#eaf5ff', text: '#075985', border: '#7dd3fc', accent: '#0284c7' },
};

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function classNames(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(' ');
}

// Provenance badge — surfaces "where did this data come from" so analysts
// know it is generated analysis output vs a manual analyst override.
function ProvenanceBadge({
  source,
  at,
}: {
  source: 'intake' | 'analysis' | 'manual';
  at?: number;
}) {
  const labelMap = {
    intake:   { label: 'Runtime artefacts', bg: '#e0f2fe', text: '#0369a1' },
    analysis: { label: 'Analysis output',   bg: '#ecfdf5', text: '#065f46' },
    manual:   { label: 'Manual override',   bg: '#fef9c3', text: '#854d0e' },
  } as const;
  const s = labelMap[source];
  return (
    <span className="provenance-badge" style={{ background: s.bg, color: s.text }}>
      {s.label}
      {at && <span className="provenance-time">{formatClock(at)}</span>}
    </span>
  );
}

function overlapColor(decision: Decision | undefined) {
  return DECISION_STYLE[decision ?? 'Migrate'].accent;
}

function getSourceDecision(source: FullReport, decisions: RationalizationDecision[]) {
  return decisions.find(d => d.sourceId === source.id) ?? null;
}

// Placeholder records used so panel chrome (header, tables, SQL pane) renders
// with empty cells before the user loads any data.
function placeholderSource(): FullReport {
  return {
    id: '—', name: '—', domain: '—', owner: '—',
    numQueries: 0,
    bestMatchTargetId: null, bestMatchTargetName: null,
    overlapPercent: 0, decision: 'Migrate', status: 'Pending',
    confidenceScore: 0, analysisExplanation: '', topCandidates: [],
    description: 'Load report folders from the Dashboard tab to view source report details.',
    allKpis: [], allTables: [],
    queries: { source: [], target: [] },
    kpiDelta: [],
  };
}

function placeholderTarget(): TargetDetailReport {
  return {
    id: '—', name: '—', domain: '—', owner: '—',
    description: 'Load report folders from the Dashboard tab to view reference report details.',
    numQueries: 0, queries: [], kpis: [], allTables: [],
  };
}

// ---- Rationalization Trail event generation ----

type TrailStatus = 'pending' | 'active' | 'done';

interface TrailEvent {
  phase: string;
  label: string;
  detail: string;
  confidence?: number;
  type: 'info' | 'match' | 'decision' | 'assumption' | 'evidence';
  status: TrailStatus;
  at?: number; // epoch ms when this event transitioned to done

  // Optional architect-grade payload (Program Trail uses these)
  rationale?: string;                                          // italic "why" block under detail
  bullets?: string[];                                          // findings, risks, candidates, etc.
  metadata?: Array<{ label: string; value: string | number }>; // grain / scoring weights / counts
}

export interface PhaseTimings {
  loadStartedAt?: number;
  loadCompletedAt?: number;
  analysisStartedAt?: number;
  analysisCompletedAt?: number;
}

export interface LiveAnalysisStats {
  model: string | null;
  durationMs: number | null;   // wall-clock duration of the analysis call
}

function statusFor(
  marker: 'load-started' | 'load-completed' | 'analysis-started' | 'analysis-completed',
  phase: WorkbenchPhase,
  timings: PhaseTimings,
): { status: TrailStatus; at?: number } {
  switch (marker) {
    case 'load-started':
      if (timings.loadStartedAt) return { status: 'done', at: timings.loadStartedAt };
      if (phase === 'loading')   return { status: 'active' };
      return { status: 'pending' };
    case 'load-completed':
      if (timings.loadCompletedAt) return { status: 'done', at: timings.loadCompletedAt };
      if (phase === 'loading')     return { status: 'active' };
      return { status: 'pending' };
    case 'analysis-started':
      if (timings.analysisStartedAt) return { status: 'done', at: timings.analysisStartedAt };
      if (phase === 'analysing')     return { status: 'active' };
      return { status: 'pending' };
    case 'analysis-completed':
      if (timings.analysisCompletedAt) return { status: 'done', at: timings.analysisCompletedAt };
      if (phase === 'analysing')       return { status: 'active' };
      return { status: 'pending' };
  }
}

function formatClock(at?: number) {
  if (!at) return '';
  const d = new Date(at);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Build the Source Rationalization Trail entirely from analysis output.
// Every event below traces to a specific field in `report` or `decision` — never
// invent narrative about scoring methods, prefix detection, or formulas here.
function buildSourceTrail(
  report: FullReport,
  decision: RationalizationDecision | null,
  _targetCount: number,
  phase: WorkbenchPhase,
  timings: PhaseTimings,
): TrailEvent[] {
  const kpis    = report.allKpis ?? [];
  const tables  = report.allTables ?? [];
  const queries = report.queries?.source ?? [];
  const overlap = decision?.overlapPercent ?? null;
  const dec     = decision?.decision ?? null;
  const conf    = decision ? Math.round(decision.confidenceScore * 100) : null;
  const hasReport = report.id !== '—';

  const ingest          = statusFor('load-started', phase, timings);
  const analysisStarted = statusFor('analysis-started', phase, timings);
  const analysisDone    = statusFor('analysis-completed', phase, timings);

  const matrix = decision?.kpiMappingMatrix ?? [];
  const matched = matrix.filter(m => m.status === 'matched').length;
  const partial = matrix.filter(m => m.status === 'partial').length;
  const gap     = matrix.filter(m => m.status === 'gap').length;

  const events: TrailEvent[] = [
    {
      phase: 'INTAKE',
      label: hasReport ? 'Report bundle received' : 'Awaiting report folders',
      detail: hasReport
        ? `"${report.name}" — ${queries.length} file(s) found in the source estate; raw text forwarded for analysis.`
        : 'No source paths submitted yet. Enter folder paths on the Dashboard tab.',
      type: 'info',
      ...ingest,
    },
    {
      phase: 'ANALYSIS',
      label: hasReport
        ? (analysisDone.status === 'done' ? 'Analysis complete' : 'Analysis running')
        : 'Analysis pending',
      detail: hasReport
        ? (analysisDone.status === 'done'
            ? `Analysis produced ${kpis.length} KPI(s) and ${tables.length} table reference(s) for this report.`
            : 'Reading raw SQL/LookML/Qlik text and building lineage, metadata, and mapping.')
        : 'Analysis will run once a folder is loaded.',
      type: 'info',
      ...analysisStarted,
    },
    {
      phase: 'LINEAGE',
      label: decision?.lineageSummary ? 'Lineage summary' : 'Lineage pending',
      detail: decision?.lineageSummary
        ?? (hasReport ? 'Report, KPI, and column lineage will be summarized during analysis.' : 'Lineage summary appears once a report is loaded.'),
      type: 'evidence',
      ...analysisDone,
    },
    {
      phase: 'MAPPING',
      label: decision?.mappingPattern ? `Mapping pattern: ${decision.mappingPattern}` : 'Mapping pending',
      detail: decision
        ? (decision.targetName
            ? `Mapped to "${decision.targetName}" — pattern ${decision.mappingPattern}.`
            : `No target mapped (pattern ${decision.mappingPattern}). ${decision.rationale}`)
        : (hasReport ? 'Source will be mapped to the best target after lineage and semantic analysis.' : 'Mapping appears after analysis runs.'),
      type: 'match',
      ...analysisDone,
    },
    {
      phase: 'KPI MATRIX',
      label: matrix.length ? `KPI mapping — ${matched} matched / ${partial} partial / ${gap} gap` : 'KPI matrix pending',
      detail: matrix.length
        ? `${matrix.length} source KPI(s) scored against the mapped target. See the Disposition tab for the per-KPI evidence matrix.`
        : (hasReport ? 'Per-KPI scoring matrix appears once overlap calculation completes.' : 'KPI matrix appears once analysis runs.'),
      type: 'evidence',
      ...analysisDone,
    },
  ];

  if (decision?.kpiGaps?.length) {
    events.push({
      phase: 'GAPS',
      label: 'KPI gaps identified',
      detail: `${decision.kpiGaps.length} source KPI(s) without a target equivalent: ${decision.kpiGaps.slice(0, 4).join(', ')}${decision.kpiGaps.length > 4 ? ` +${decision.kpiGaps.length - 4} more` : ''}.`,
      type: 'evidence',
      ...analysisDone,
    });
  }

  events.push({
    phase: 'RECOMMENDATION',
    label: decision?.recommendation ? 'Recommendation' : 'Recommendation pending',
    detail: decision?.recommendation
      ?? (hasReport ? 'A recommendation will appear after overlap is computed.' : 'Recommendation appears once analysis runs.'),
    type: 'info',
    ...analysisDone,
  });

  events.push({
    phase: 'DECISION',
    label: dec
      ? `${dec} — ${overlap !== null ? `${Math.round(overlap)}% overlap` : 'overlap n/a'}`
      : 'Decision pending',
    detail: dec
      ? (decision?.rationale ?? `Disposition: ${dec}.`)
      : 'Disposition will appear once analysis finishes.',
    confidence: conf ?? undefined,
    type: 'decision',
    ...analysisDone,
  });

  return events;
}

// Build the Target Rationalization Trail from analysis output and inventory counts only.
// `report.kpis`, `report.allTables`, and `report.queries` are analysis findings,
// not local parsing. Source-alignment count is derived from produced decisions.
function buildTargetTrail(
  report: TargetDetailReport,
  decisions: RationalizationDecision[],
  phase: WorkbenchPhase,
  timings: PhaseTimings,
): TrailEvent[] {
  const kpis    = report.kpis ?? [];
  const tables  = report.allTables ?? [];
  const queries = report.queries ?? [];
  const hasReport = report.id !== '—';

  const ingest       = statusFor('load-started', phase, timings);
  const analysisDone = statusFor('analysis-completed', phase, timings);

  const mappedHere = decisions.filter(d => d.targetId === report.id);
  const mappedSources = mappedHere.map(d => d.sourceName).slice(0, 4);
  const dispositionMix = {
    Rationalize: mappedHere.filter(d => d.decision === 'Rationalize').length,
    Consolidate: mappedHere.filter(d => d.decision === 'Consolidate').length,
    Migrate:     mappedHere.filter(d => d.decision === 'Migrate').length,
  };

  return [
    {
      phase: 'INTAKE',
      label: hasReport ? 'Reference bundle received' : 'Awaiting reference folders',
      detail: hasReport
        ? `"${report.name}" — ${queries.length} file(s) found in the Verizon reference estate; raw text forwarded for analysis.`
        : 'No reference paths submitted yet. Enter folder paths on the Dashboard tab.',
      type: 'info',
      ...ingest,
    },
    {
      phase: 'ANALYSIS',
      label: hasReport
        ? (analysisDone.status === 'done' ? 'Analysis complete' : 'Analysis running')
        : 'Analysis pending',
      detail: hasReport
        ? (analysisDone.status === 'done'
            ? `Analysis produced ${kpis.length} KPI(s) across ${tables.length} table reference(s) for this reference report.`
            : 'Reading raw SQL/LookML/Qlik text and building the reference report metadata and lineage.')
        : 'Analysis will run once a folder is loaded.',
      type: 'info',
      ...analysisDone,
    },
    {
      phase: 'KPI INVENTORY',
      label: hasReport ? `${kpis.length} reference KPI(s)` : 'KPI inventory pending',
      detail: hasReport
        ? (kpis.length
            ? `Identified KPIs: ${kpis.slice(0, 4).map(k => k.alias).join(', ')}${kpis.length > 4 ? ` +${kpis.length - 4} more` : ''}.`
            : 'No KPIs were identified in this reference report.')
        : 'KPI inventory appears once analysis runs.',
      type: 'evidence',
      ...analysisDone,
    },
    {
      phase: 'TABLES',
      label: hasReport ? `${tables.length} table reference(s)` : 'Tables pending',
      detail: hasReport
        ? (tables.length
            ? `Identified tables: ${tables.slice(0, 4).join(', ')}${tables.length > 4 ? ` +${tables.length - 4} more` : ''}.`
            : 'No tables were identified in this reference report.')
        : 'Table references appear once analysis runs.',
      type: 'evidence',
      ...analysisDone,
    },
    {
      phase: 'ROLE',
      label: mappedHere.length
        ? `Mapped by ${mappedHere.length} source report(s)`
        : (hasReport ? 'Not yet mapped' : 'Role pending'),
      detail: mappedHere.length
        ? `Source mappings: ${mappedSources.join(', ')}${mappedHere.length > 4 ? ` +${mappedHere.length - 4} more` : ''}. Dispositions — Rationalize: ${dispositionMix.Rationalize}, Consolidate: ${dispositionMix.Consolidate}, Migrate: ${dispositionMix.Migrate}.`
        : (hasReport
            ? 'No source report has been mapped to this reference yet.'
            : 'Mapping role appears once per-source analysis finishes.'),
      type: 'match',
      ...analysisDone,
    },
  ];
}

function buildProgramTrail(
  sourceCount: number,
  targetCount: number,
  decisions: RationalizationDecision[],
  inventory: ReportInventory | null,
  liveStats: LiveAnalysisStats,
  phase: WorkbenchPhase,
  timings: PhaseTimings,
): TrailEvent[] {
  const hasData = sourceCount > 0 || targetCount > 0;
  const sources = inventory?.sources ?? [];
  const targets = inventory?.targets ?? [];

  const migrate     = decisions.filter(d => d.decision === 'Migrate').length;
  const consolidate = decisions.filter(d => d.decision === 'Consolidate').length;
  const rationalize = decisions.filter(d => d.decision === 'Rationalize').length;
  const totalGaps = decisions.reduce((sum, d) => sum + (d.kpiGaps?.length ?? 0), 0);
  const gapHeavy  = decisions.filter(d => (d.kpiGaps?.length ?? 0) > 0).length;
  const unmatched = decisions.filter(d => !d.targetId).length;

  const confs = decisions.map(d => d.confidenceScore);
  const avgConf = confs.length ? Math.round((confs.reduce((s, c) => s + c, 0) / confs.length) * 100) : null;
  const minConf = confs.length ? Math.round(Math.min(...confs) * 100) : null;
  const maxConf = confs.length ? Math.round(Math.max(...confs) * 100) : null;

  const overlaps = decisions.map(d => d.overlapPercent);
  const overlapMin = overlaps.length ? Math.min(...overlaps) : null;
  const overlapMax = overlaps.length ? Math.max(...overlaps) : null;
  const borderlineHi = decisions.filter(d => d.overlapPercent >= 38 && d.overlapPercent <= 42).length;
  const borderlineLo = decisions.filter(d => d.overlapPercent >= 78 && d.overlapPercent <= 82).length;

  const topDisposition = [...decisions].sort((a, b) => b.overlapPercent - a.overlapPercent)[0] ?? null;
  const weakestMatch   = [...decisions].sort((a, b) => a.overlapPercent - b.overlapPercent)[0] ?? null;

  // Evidence drawn from the inventory itself
  const srcKpis    = sources.reduce((n, s) => n + (s.allKpis?.length ?? 0), 0);
  const tgtKpis    = targets.reduce((n, t) => n + (t.kpis?.length ?? 0), 0);
  const srcQueries = sources.reduce((n, s) => n + (s.queries?.source?.length ?? 0), 0);
  const tgtQueries = targets.reduce((n, t) => n + (t.queries?.length ?? 0), 0);
  const srcTables  = new Set(sources.flatMap(s => s.allTables ?? [])).size;
  const tgtTables  = new Set(targets.flatMap(t => t.allTables ?? [])).size;
  const sourceDomains    = new Set(sources.map(s => s.domain));
  const referenceDomains = new Set(targets.map(t => t.domain));
  const sharedDomains    = [...sourceDomains].filter(d => referenceDomains.has(d)).length;

  const planReady     = statusFor('load-completed', phase, timings);
  const analysing     = statusFor('analysis-started', phase, timings);
  const analysisDone  = statusFor('analysis-completed', phase, timings);

  return [
    // ---- Logical plan (declared before any matching runs) ----
    {
      phase: 'OBJECTIVE',
      label: 'Modernization mandate',
      detail: hasData
        ? `Rationalize ${sourceCount} source BI reports against ${targetCount} reference catalog reports. Produce one disposition per source — Rationalize (retire), Consolidate (merge), or Migrate (rebuild).`
        : 'Goal will be stated once an estate is loaded. The workbench will produce one disposition per source.',
      rationale: 'Replace bespoke source reports with governed reference reports where KPIs already overlap. Reduces duplicate code, centralises measure definitions, and exposes gap-fill work that must precede retirement.',
      type: 'decision',
      ...planReady,
    },
    {
      phase: 'GRAIN',
      label: 'Unit of analysis',
      detail: 'One disposition per source report. KPI is the matching primitive — joins, filters, and tables are evidence under the KPI.',
      metadata: [
        { label: 'Disposition row',     value: '1 per source report' },
        { label: 'Match primitive',     value: 'KPI semantic identity' },
        { label: 'Match dimensions',    value: '7 weighted dimensions (see CANDIDATE)' },
        { label: 'Joining axis',        value: 'business domain (annotation, not constraint)' },
        { label: 'Reference role',      value: 'canonical KPI authority per domain' },
      ],
      type: 'info',
      status: 'done',
    },
    {
      phase: 'CANDIDATE',
      label: 'Candidate evaluation method',
      detail: hasData
        ? `Analysis reads raw artefacts for every source and reference, builds metadata + lineage, then maps each source to the best target using 7-dimension semantic equivalence scoring. No string-match heuristics.`
        : 'Analysis will read raw artefacts and apply 7-dimension semantic equivalence scoring once folders are loaded.',
      metadata: [
        { label: 'Semantic meaning weight',     value: '25%' },
        { label: 'Business logic weight',       value: '25%' },
        { label: 'Lineage weight',              value: '15%' },
        { label: 'Filter weight',               value: '10%' },
        { label: 'Aggregation weight',          value: '10%' },
        { label: 'Dimension weight',            value: '10%' },
        { label: 'Grain weight',                value: '5%' },
        { label: 'Candidates evaluated/source', value: hasData ? targetCount : '—' },
      ],
      type: 'match',
      ...planReady,
    },
    {
      phase: 'DECISION_RULE',
      label: 'Disposition thresholds',
      detail: 'Computed overlap is bucketed into one of three dispositions with explicit effort bands.',
      bullets: [
        '= 100 % overlap → Rationalize (every source KPI subsumed by reference; retire source). 0 days build effort, sign-off only.',
        '70 – 99 % overlap → Consolidate (extend reference to absorb gap KPIs). 1–3 days per missing KPI.',
        '<  70 % overlap → Migrate (insufficient coverage; rebuild on standard platform). 3–10 days per KPI.',
      ],
      rationale: 'Rationalize is intentionally narrow — full KPI coverage is rare. The 70 % Consolidate floor reflects a conservative migration bias: when uncertainty exists, prefer extending the reference over retiring the source.',
      type: 'decision',
      ...planReady,
    },
    {
      phase: 'ASSUMPTIONS',
      label: 'Working assumptions',
      detail: 'Held constant for this analysis. Each is auditable and overridable in the disposition matrix.',
      bullets: [
        'Reference catalog is the canonical KPI authority for its domain.',
        'Schema-prefix differences (fact_, dim_, tgt_, vz_, mkt_, fr_, ref_, stg_, rpt_, src_, lkp_) are vendor artefacts, not semantic differences.',
        'Owner and query volume are NOT signals for disposition — only KPI semantic equivalence is.',
        'Cross-domain matches are permitted when semantic overlap is strong; domain mismatch is flagged, not excluded.',
        'Generated rationale is advisory. Analyst override is final and recorded in the governance ledger.',
        'Confidence is lowered when raw artefacts are sparse, ambiguous, or contradictory — manual review is requested at low confidence.',
      ],
      type: 'assumption',
      ...planReady,
    },
    {
      phase: 'FILTERS',
      label: 'Scope and exclusions',
      detail: 'What is in vs out of the matching set. Filters are auditable upstream of every decision.',
      bullets: [
        hasData ? `All ${sourceCount} source reports in scope (no exclusions).` : 'All loaded source reports will be in scope.',
        hasData ? `All ${targetCount} reference reports eligible as targets.` : 'All loaded references will be eligible as targets.',
        'Reports whose raw artefacts contain no analyzable content (no SQL/LookML/Qlik) still appear with a reason why no KPIs were identified.',
        sharedDomains > 0
          ? `${sharedDomains} domain(s) appear on both sides — high-confidence matches concentrate here.`
          : 'Cross-domain analysis only — no shared domain names between source and reference catalogs.',
      ],
      type: 'info',
      ...planReady,
    },

    // ---- Evidence produced during analysis ----
    {
      phase: 'EVIDENCE',
      label: hasData ? 'Observed signal inventory' : 'Evidence pending',
      detail: hasData
        ? 'Quantitative findings produced after reading raw source and reference artefacts. Every number below traces to the current run output on the loaded folders.'
        : 'KPI / query / table counts will appear once folders are loaded.',
      bullets: hasData ? [
        `Source folders read: ${sources.slice(0, 5).map(s => s.id).join(', ')}${sources.length > 5 ? ` +${sources.length - 5} more` : ''}.`,
        `Reference folders read: ${targets.slice(0, 5).map(t => t.id).join(', ')}${targets.length > 5 ? ` +${targets.length - 5} more` : ''}.`,
        `Total query files identified: ${srcQueries + tgtQueries} (${srcQueries} source + ${tgtQueries} reference).`,
      ] : undefined,
      metadata: hasData ? [
        { label: 'Source KPIs identified',     value: srcKpis },
        { label: 'Reference KPIs catalogued',  value: tgtKpis },
        { label: 'Source query files',         value: srcQueries },
        { label: 'Reference query files',      value: tgtQueries },
        { label: 'Unique source tables',       value: srcTables },
        { label: 'Unique reference tables',    value: tgtTables },
        { label: 'Source domains in scope',    value: sourceDomains.size },
        { label: 'Reference domains',          value: referenceDomains.size },
      ] : undefined,
      type: 'evidence',
      ...planReady,
    },
    {
      phase: 'OVERLAP',
      label: decisions.length ? 'Semantic overlap results' : 'Semantic overlap pending',
      detail: decisions.length
        ? `Analysis evaluated ${decisions.length} source report(s) against ${targetCount} reference(s). Semantic KPI overlap and disposition assigned per source.`
        : 'Analysis will evaluate each source report against the full reference catalog. Semantic matching identifies equivalent KPIs regardless of naming convention.',
      bullets: decisions.length ? [
        ...[...decisions]
          .sort((a, b) => b.overlapPercent - a.overlapPercent)
          .slice(0, 5)
          .map(d => `${d.sourceName} → ${d.targetName ?? 'no match'} : ${Math.round(d.overlapPercent)} % overlap → ${d.decision}`),
        decisions.length > 5 ? `+ ${decisions.length - 5} more in the Disposition matrix.` : '',
      ].filter(Boolean) : undefined,
      rationale: 'Unlike string-match scoring, the analysis evaluates whether "revenue_total" and "total_revenue" are the same KPI concept. Vendor table prefixes (fact_, dim_, vz_, fr_) are treated as schema conventions, not semantic differences.',
      type: 'evidence',
      ...planReady,
    },
    {
      phase: 'ANALYSIS',
      label: decisions.length ? 'Analysis complete' : 'Analysis in progress',
      detail: decisions.length
        ? `Analysis produced ${decisions.length} disposition(s) with semantic overlap scores, rationale, and KPI gap lists.`
        : 'Each source report is being analyzed in parallel. Decisions populate the Disposition tab as each analysis completes.',
      rationale: 'The analysis output determines target matching, overlap %, disposition band, rationale, and KPI gaps. No string-match heuristics are applied.',
      metadata: [
        { label: 'Service',        value: liveStats.model ?? (decisions.length ? 'Configured' : '...') },
        { label: 'Sources',        value: hasData ? sourceCount : '—' },
        { label: 'References',     value: hasData ? targetCount : '—' },
        {
          label: 'Analysis time',
          value: liveStats.durationMs != null
            ? `${(liveStats.durationMs / 1000).toFixed(1)} s`
            : (phase === 'analysing' ? 'in flight…' : '—'),
        },
        {
          label: 'Throughput',
          value: liveStats.durationMs && decisions.length
            ? `${((decisions.length * 1000) / liveStats.durationMs).toFixed(1)} decisions/s`
            : '—',
        },
      ],
      type: 'info',
      ...analysing,
    },

    // ---- Findings derived from evidence ----
    {
      phase: 'FINDINGS',
      label: decisions.length ? 'Disposition findings' : 'Findings pending',
      detail: decisions.length
        ? 'What the analysis produced. Numbers are read directly from the disposition matrix.'
        : 'Migrate / Consolidate / Rationalize counts and effort bands will appear here once analysis completes.',
      metadata: decisions.length ? [
        { label: 'Rationalize (retire)', value: `${rationalize} report(s) · 0 days` },
        { label: 'Consolidate (extend)', value: `${consolidate} report(s) · est. ${consolidate}–${consolidate * 3} days` },
        { label: 'Migrate (rebuild)',    value: `${migrate} report(s) · est. ${migrate * 3}–${migrate * 10} days` },
        { label: 'Overlap range',        value: overlapMin !== null ? `${Math.round(overlapMin)} % – ${Math.round(overlapMax!)} %` : '—' },
        { label: 'Strongest match',      value: topDisposition ? `${topDisposition.sourceName} → ${topDisposition.targetName ?? '—'} (${Math.round(topDisposition.overlapPercent)} %)` : '—' },
        { label: 'Weakest match',        value: weakestMatch   ? `${weakestMatch.sourceName} → ${weakestMatch.targetName ?? '—'} (${Math.round(weakestMatch.overlapPercent)} %)` : '—' },
      ] : undefined,
      type: 'evidence',
      ...analysisDone,
    },
    {
      phase: 'SAMPLE',
      label: decisions.length ? 'Sample rationale (highest-overlap source)' : 'Sample rationale pending',
      detail: topDisposition
        ? `Auditable example. The full rationale per source is on the Disposition tab; selected here is the strongest overlap match as a fidelity check.`
        : 'A representative rationale will be surfaced here as evidence that the analysis is producing meaningful output, not boilerplate.',
      rationale: topDisposition?.rationale
        ? `${topDisposition.sourceName} → ${topDisposition.targetName ?? 'no target'} (${Math.round(topDisposition.overlapPercent)} %, conf ${Math.round(topDisposition.confidenceScore * 100)} %): "${topDisposition.rationale.length > 280 ? topDisposition.rationale.slice(0, 280) + '…' : topDisposition.rationale}"`
        : undefined,
      type: 'evidence',
      ...analysisDone,
    },
    {
      phase: 'CONFIDENCE',
      label: avgConf !== null ? 'Confidence calibration' : 'Confidence calibration pending',
      detail: avgConf !== null
        ? 'Enriched confidence per decision; informs which dispositions auto-qualify for fast-track approval.'
        : 'Per-decision confidence scores will appear here after analysis completes.',
      metadata: avgConf !== null ? [
        { label: 'Mean confidence',  value: `${avgConf} %` },
        { label: 'Confidence range', value: `${minConf} % – ${maxConf} %` },
        { label: 'Fast-track eligible (≥80 %)', value: decisions.filter(d => d.confidenceScore >= 0.8).length },
        { label: 'Review-required (<60 %)',     value: decisions.filter(d => d.confidenceScore < 0.6).length },
      ] : undefined,
      type: 'evidence',
      ...analysisDone,
    },

    // ---- Risks / open questions surfaced for the architect ----
    {
      phase: 'RISKS',
      label: decisions.length ? 'Open risks for analyst review' : 'Risk register pending',
      detail: decisions.length
        ? 'Items that require human judgment before retirement or migration is approved.'
        : 'Borderline cases, KPI gaps, and unmatched reports will be listed here after analysis.',
      bullets: decisions.length ? [
        `${gapHeavy} report(s) carry KPI gaps — gap-fill design required before retirement (${totalGaps} KPI(s) total).`,
        `${borderlineHi + borderlineLo} report(s) are at a band boundary (overlap 38–42 % or 78–82 %); disposition is sensitive to a single KPI change.`,
        `${unmatched} report(s) have no matched reference — verify schema-naming did not mask a real match before defaulting to Migrate.`,
        'If analysis cannot complete, no automatic disposition is generated; the run must be corrected and re-executed.',
      ] : undefined,
      type: 'assumption',
      ...analysisDone,
    },

  ];
}

const TRAIL_PHASE_STYLE: Record<string, { bg: string; text: string }> = {
  INTAKE:        { bg: '#e0f2fe', text: '#0369a1' },
  PARSE:         { bg: '#f0fdf4', text: '#166534' },
  CLASSIFY:      { bg: '#fef9c3', text: '#854d0e' },
  CANDIDATE:     { bg: '#ede9fe', text: '#5b21b6' },
  EVIDENCE:      { bg: '#fff7ed', text: '#9a3412' },
  OVERLAP:       { bg: '#fff7ed', text: '#9a3412' },
  ASSUMPTION:    { bg: '#f1f5f9', text: '#475569' },
  ASSUMPTIONS:   { bg: '#f1f5f9', text: '#475569' },
  THRESHOLD:     { bg: '#f1f5f9', text: '#475569' },
  DECISION:      { bg: '#ecfdf5', text: '#065f46' },
  DECISION_RULE: { bg: '#ecfdf5', text: '#065f46' },
  GAPS:          { bg: '#fef2f2', text: '#991b1b' },
  WAITING:       { bg: '#f2f3f3', text: '#64748b' },
  MAPPING:       { bg: '#ede9fe', text: '#5b21b6' },
  COVERAGE:      { bg: '#fff7ed', text: '#9a3412' },
  GOVERNANCE:    { bg: '#ecfdf5', text: '#065f46' },
  SCOPE:         { bg: '#e0f2fe', text: '#0369a1' },
  ANALYSIS:      { bg: '#f0fdf4', text: '#166534' },
  CONFIDENCE:    { bg: '#fff7ed', text: '#9a3412' },
  OBJECTIVE:     { bg: '#e0f2fe', text: '#0369a1' },
  GRAIN:         { bg: '#fef9c3', text: '#854d0e' },
  FILTERS:       { bg: '#f1f5f9', text: '#475569' },
  FINDINGS:      { bg: '#fff7ed', text: '#9a3412' },
  RISKS:         { bg: '#fef2f2', text: '#991b1b' },
  SAMPLE:        { bg: '#ecfdf5', text: '#065f46' },
};

const TRAIL_TYPE_ICON: Record<TrailEvent['type'], typeof Clock> = {
  info:       Clock,
  match:      Network,
  decision:   ShieldCheck,
  assumption: AlertCircle,
  evidence:   FileCode2,
};

function RationalizationTrail({
  events,
  title = 'Rationalization Trail',
}: {
  events: TrailEvent[];
  title?: string;
}) {
  const doneCount   = events.filter(e => e.status === 'done').length;
  const activeCount = events.filter(e => e.status === 'active').length;

  return (
    <aside className="trail-panel">
      <div className="trail-header">
        <Layers size={14} />
        <span>{title}</span>
        <span className="trail-progress">
          {doneCount}/{events.length}
          {activeCount > 0 && <Loader2 size={11} className="animate-spin" />}
        </span>
      </div>
      <div className="trail-events">
        {events.map((evt, i) => {
          const phaseStyle = TRAIL_PHASE_STYLE[evt.phase] ?? { bg: '#f2f3f3', text: '#64748b' };
          const IconComp = TRAIL_TYPE_ICON[evt.type];
          return (
            <div key={`${evt.phase}-${i}`} className={classNames('trail-event', `is-${evt.status}`)}>
              <div className="trail-event-left">
                <span
                  className="trail-phase"
                  style={{ background: phaseStyle.bg, color: phaseStyle.text }}
                >
                  {evt.phase}
                </span>
                {i < events.length - 1 && <div className="trail-connector" />}
              </div>
              <div className="trail-event-body">
                <div className="trail-event-label">
                  {evt.status === 'active'
                    ? <Loader2 size={12} className="animate-spin trail-active-icon" />
                    : evt.status === 'done'
                      ? <CheckCircle2 size={12} className="trail-done-icon" />
                      : <IconComp size={12} />}
                  <strong>{evt.label}</strong>
                  {evt.confidence !== undefined && (
                    <span className="trail-conf">{evt.confidence}%</span>
                  )}
                  {evt.status === 'active' && <span className="trail-status-tag active">live</span>}
                  {evt.status === 'pending' && <span className="trail-status-tag pending">queued</span>}
                  {evt.at && <span className="trail-timestamp">{formatClock(evt.at)}</span>}
                </div>
                <p className="trail-event-detail">{evt.detail}</p>
                {evt.rationale && (
                  <p className="trail-rationale"><em>Why:</em> {evt.rationale}</p>
                )}
                {evt.bullets && evt.bullets.length > 0 && (
                  <ul className="trail-bullets">
                    {evt.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                )}
                {evt.metadata && evt.metadata.length > 0 && (
                  <dl className="trail-metadata">
                    {evt.metadata.map((m, j) => (
                      <div key={j} className="trail-metadata-row">
                        <dt>{m.label}</dt>
                        <dd>{m.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---- Intake banner (horizontal, full-width) ----

function IntakeBanner({
  onApply,
  loading = false,
}: {
  onApply: (sourcePath: string, targetPath: string) => void;
  loading?: boolean;
}) {
  const [sourcePath, setSourcePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);

  const canSubmit = sourcePath.trim().length > 0 && targetPath.trim().length > 0 && !loading;

  const handleApply = () => {
    if (!canSubmit) return;
    onApply(sourcePath.trim(), targetPath.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) handleApply();
  };

  return (
    <div className="intake-banner">
      <div className="intake-banner-row">
        <div className="intake-brand">
          <FolderOpen size={16} />
          <div className="intake-brand-text">
            <strong>Analysis Intake</strong>
            <span>Report source paths</span>
          </div>
        </div>

        <div className="intake-source-target">
          <div className="intake-path-row">
            <span className="intake-org-label source">{SOURCE_ORG}</span>
            <input
              className="intake-path-input"
              value={sourcePath}
              onChange={e => setSourcePath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Local folder path — e.g. C:\reports\source"
            />
          </div>
          <div className="intake-path-row">
            <span className="intake-org-label target">{TARGET_ORG}</span>
            <input
              className="intake-path-input"
              value={targetPath}
              onChange={e => setTargetPath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Local folder path — e.g. C:\reports\reference"
            />
          </div>
        </div>

        <div className="intake-banner-actions">
          <button
            className={classNames('intake-toggle-btn', expanded && 'active')}
            onClick={() => setExpanded(v => !v)}
            disabled={loading}
          >
            <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
            Notes
          </button>
          <button
            className="primary-action"
            style={{ minHeight: 32, fontSize: 12 }}
            onClick={handleApply}
            disabled={!canSubmit}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? 'Loading…' : 'Load reports'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="intake-notes-body">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Analyst notes: migration constraints, parallel-run requirements, data quality issues, stakeholder context..."
          />
        </div>
      )}
    </div>
  );
}

// ---- Stat card ----

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof LayoutDashboard;
  accent: string;
}) {
  return (
    <section className="metric-card">
      <div className="metric-icon" style={{ background: accent }}>
        <Icon size={18} />
      </div>
      <div>
        <p className="metric-label">{label}</p>
        <p className="metric-value">{value}</p>
        <p className="metric-detail">{detail}</p>
      </div>
    </section>
  );
}

function DecisionPill({ decision }: { decision: Decision }) {
  const style = DECISION_STYLE[decision];
  return (
    <span
      className="decision-pill"
      style={{ background: style.bg, color: style.text, borderColor: style.border }}
    >
      <span className="decision-dot" style={{ background: style.accent }} />
      {decision}
    </span>
  );
}

function ConfidencePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone = pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'risk';
  return <span className={`confidence-pill ${tone}`}>{pct}%</span>;
}

// ---- App header ----

function AppHeader({
  activeTab,
  setActiveTab,
}: {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
}) {
  return (
    <header className="enterprise-header">
      <div className="hero-strip">
        <div className="brand-lockup">
          <div className="brand-emblem"><BarChart3 size={22} /></div>
          <div>
            <p className="eyebrow">BI Modernization Workbench</p>
            <h1>Report Rationalizer</h1>
          </div>
        </div>
      </div>
      <nav className="top-tabs" aria-label="Workbench sections">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={classNames('top-tab', activeTab === tab.key && 'active')}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

// ---- Dashboard ----

function DashboardView({
  inventory,
  decisions,
  onReload,
  isLoading,
  loadError,
}: {
  inventory: ReportInventory | null;
  decisions: RationalizationDecision[];
  onReload: (sourcePath: string, targetPath: string) => void;
  isLoading: boolean;
  loadError: string | null;
}) {
  const sources = inventory?.sources ?? [];
  const targets = inventory?.targets ?? [];

  const mapped = decisions.length;
  const avgConfidence = mapped
    ? decisions.reduce((sum, d) => sum + d.confidenceScore, 0) / mapped
    : 0;
  const approved  = decisions.filter(d => d.status === 'Approved').length;
  const pending   = decisions.filter(d => d.status === 'Pending').length;
  const overridden = decisions.filter(d => d.status === 'Overridden').length;

  const decisionCounts = (['Migrate', 'Consolidate', 'Rationalize'] as Decision[]).map(label => ({
    label,
    count: decisions.filter(d => d.decision === label).length,
  }));
  const migrateCount     = decisionCounts.find(d => d.label === 'Migrate')?.count ?? 0;
  const consolidateCount = decisionCounts.find(d => d.label === 'Consolidate')?.count ?? 0;
  const rationalizeCount = decisionCounts.find(d => d.label === 'Rationalize')?.count ?? 0;

  const statusCounts = [
    { label: 'Approved',   count: approved,   color: '#037f0c', bg: '#f0fdf4', text: '#166534' },
    { label: 'Pending',    count: pending,     color: '#ff9900', bg: '#fff7ed', text: '#9a3412' },
    { label: 'Overridden', count: overridden,  color: '#5f6b7a', bg: '#f1f5f9', text: '#334155' },
  ];

  const confTiers = [
    { label: 'High  ≥80%', count: decisions.filter(d => d.confidenceScore >= 0.8).length,  color: '#037f0c' },
    { label: 'Mid  60–79%', count: decisions.filter(d => d.confidenceScore >= 0.6 && d.confidenceScore < 0.8).length, color: '#ff9900' },
    { label: 'Low   <60%', count: decisions.filter(d => d.confidenceScore < 0.6).length,  color: '#dc2626' },
  ];

  const totalKpiGaps = decisions.reduce((s, d) => s + (d.kpiGaps?.length ?? 0), 0);

  const domainCounts = [...new Set(sources.map(r => r.domain))].map(domain => ({
    domain,
    sources: sources.filter(r => r.domain === domain).length,
    targets: targets.filter(r => r.domain === domain).length,
    decisions: decisions.filter(d => d.domain === domain).length,
    approved: decisions.filter(d => d.domain === domain && d.status === 'Approved').length,
  }));
  const maxDomain = Math.max(...domainCounts.map(d => Math.max(d.sources, d.targets)), 1);

  const overlapBuckets = [
    { label: '<40%',   min: 0,   max: 39  },
    { label: '40–59%', min: 40,  max: 59  },
    { label: '60–79%', min: 60,  max: 79  },
    { label: '80–99%', min: 80,  max: 99  },
    { label: '100%',   min: 100, max: 100 },
  ].map(bucket => ({
    ...bucket,
    count: decisions.filter(d => d.overlapPercent >= bucket.min && d.overlapPercent <= bucket.max).length,
  }));
  const maxBucket = Math.max(...overlapBuckets.map(b => b.count), 1);

  return (
    <main className="workspace">
      <IntakeBanner onApply={onReload} loading={isLoading} />

      {!inventory && !isLoading && (
        <div className="no-data-banner">
          <AlertCircle size={14} />
          <span>
            Enter your source and reference folder paths above and click <strong>Load reports</strong>.
            All metrics, charts, lineage, and analysis will populate once data is loaded.
          </span>
        </div>
      )}
      {loadError && (
        <div className="no-data-banner error">
          <AlertCircle size={14} />
          <span>{loadError}</span>
        </div>
      )}

      <div className="metric-grid">
        <StatCard
          label="Source report estate"
          value={sources.length || '—'}
          detail={sources.length ? `${[...new Set(sources.map(r => r.domain))].length} domains in scope` : 'No data loaded'}
          icon={FileText}
          accent="#0972d3"
        />
        <StatCard
          label="Reference report catalog"
          value={targets.length || '—'}
          detail={targets.length ? `${[...new Set(targets.map(r => r.domain))].length} reference domains` : 'No data loaded'}
          icon={Database}
          accent="#037f0c"
        />
        <StatCard
          label="Source dispositions"
          value={sources.length ? `${mapped}/${sources.length}` : '—'}
          detail={
            sources.length
              ? `${migrateCount} migrate · ${consolidateCount} consolidate · ${rationalizeCount} rationalize`
              : 'No data loaded'
          }
          icon={TrendingUp}
          accent="#ff9900"
        />
        <StatCard
          label="Avg confidence"
          value={mapped ? `${Math.round(avgConfidence * 100)}%` : '—'}
          detail={mapped ? `${totalKpiGaps} KPI gaps identified` : 'No analysis yet'}
          icon={ShieldCheck}
          accent="#5f6b7a"
        />
      </div>

      <div className="dashboard-grid">
        {/* Panel 1: Modernization direction (source-centric) */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Modernization direction · per source</p>
              <h2>Source disposition distribution</h2>
            </div>
            <span className="panel-badge">{mapped} source reports</span>
          </div>
          <div className="decision-bars">
            {decisionCounts.map(item => {
              const denom = mapped || 1;
              const pct = (item.count / denom) * 100;
              return (
                <div key={item.label} className="decision-bar-row">
                  <div className="flex items-center justify-between">
                    <DecisionPill decision={item.label} />
                    <span className="font-bold text-[#0f172a]">{item.count}</span>
                  </div>
                  <div className="chart-track">
                    <div
                      className="chart-fill"
                      style={{ width: `${pct}%`, background: DECISION_STYLE[item.label].accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel-divider" />
          <div className="panel-subheading">KPI overlap buckets</div>
          <div className="bucket-chart">
            {overlapBuckets.map(bucket => (
              <div key={bucket.label} className="bucket">
                <div className="bucket-column">
                  <span style={{ height: `${Math.max(6, (bucket.count / maxBucket) * 100)}%` }} />
                </div>
                <strong>{bucket.count}</strong>
                <p>{bucket.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Panel 2: Governance status + confidence */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Governance</p>
              <h2>Approval status</h2>
            </div>
            <span className="panel-badge">{mapped} total</span>
          </div>
          <div className="decision-bars">
            {statusCounts.map(item => {
              const pct = mapped ? (item.count / mapped) * 100 : 0;
              return (
                <div key={item.label} className="decision-bar-row">
                  <div className="flex items-center justify-between">
                    <span
                      className="status-label-chip"
                      style={{ background: item.bg, color: item.text }}
                    >
                      {item.label}
                    </span>
                    <span className="font-bold text-[#0f172a]">{item.count}</span>
                  </div>
                  <div className="chart-track">
                    <div className="chart-fill" style={{ width: `${pct}%`, background: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel-divider" />
          <div className="panel-subheading">Confidence tiers</div>
          <div className="conf-tier-grid">
            {confTiers.map(tier => (
              <div key={tier.label} className="conf-tier">
                <div className="conf-tier-bar">
                  <span
                    style={{
                      height: `${mapped ? Math.max(8, (tier.count / mapped) * 100) : 8}%`,
                      background: tier.color,
                    }}
                  />
                </div>
                <strong>{tier.count}</strong>
                <p>{tier.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Panel 3: Domain portfolio */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Portfolio view</p>
              <h2>Coverage by domain</h2>
            </div>
            <div className="domain-legend">
              <span><i style={{ background: '#0972d3' }} />{SOURCE_ORG}</span>
              <span><i style={{ background: '#ff9900' }} />{TARGET_ORG}</span>
            </div>
            {!domainCounts.length && <p className="panel-empty-note">No domain data — load reports from Dashboard.</p>}
          </div>
          <div className="domain-grid">
            {domainCounts.map(item => (
              <div key={item.domain} className="domain-row">
                <span>{item.domain}</span>
                <div className="domain-track">
                  <div className="domain-fill source" style={{ width: `${(item.sources / maxDomain) * 100}%` }} />
                  <div className="domain-fill target" style={{ width: `${(item.targets / maxDomain) * 100}%` }} />
                </div>
                <strong>{item.sources}/{item.targets}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

// ---- Shared sub-components ----

function Sidebar<T extends { id: string; name: string; domain: string }>({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = items.filter(item =>
    `${item.id} ${item.name} ${item.domain}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <aside className="record-sidebar">
      <div className="sidebar-title">
        <h3>{title}</h3>
        <p>{items.length} reports</p>
      </div>
      <div className="sidebar-search">
        <Search size={14} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search reports" />
      </div>
      <div className="sidebar-list">
        {items.length === 0 ? (
          <div className="sidebar-empty">No reports loaded — load report folders from Dashboard.</div>
        ) : (
          filtered.map(item => (
            <button
              key={item.id}
              className={classNames('sidebar-item', selectedId === item.id && 'active')}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.id}</span>
              <strong>{item.name}</strong>
              <em>{item.domain}</em>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function TableDependencies({ queries }: { queries: QueryItem[] }) {
  const tables = [...new Set(queries.flatMap(q => q.tables))].map(table => ({
    table,
    queries: queries
      .filter(q => q.tables.includes(table))
      .map(q => (q.id.split('_Q')[1] ? `Q${q.id.split('_Q')[1]}` : q.id)),
    joins: queries.filter(q => q.tables.includes(table)).flatMap(q => q.joins).length,
  }));

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Lineage</p>
          <h2>Table dependencies</h2>
        </div>
        <span className="panel-badge">{tables.length} tables</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Type</th>
              <th>Used in</th>
              <th>Joins</th>
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 ? (
              <tr className="placeholder-row">
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
            ) : (
              tables.map(row => (
                <tr key={row.table}>
                  <td className="font-mono">{row.table}</td>
                  <td>
                    <span className="soft-tag">
                      {row.table.startsWith('dim_') || row.table.startsWith('ref_') ? 'Dimension' : 'Fact'}
                    </span>
                  </td>
                  <td>{row.queries.join(', ')}</td>
                  <td>{row.joins}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SqlExplorer({ queries }: { queries: QueryItem[] }) {
  const [selectedQuery, setSelectedQuery] = useState(queries[0]?.id ?? '');
  const query = queries.find(q => q.id === selectedQuery) ?? queries[0];
  useEffect(() => {
    setSelectedQuery(queries[0]?.id ?? '');
  }, [queries]);

  if (!query) {
    return (
      <section className="panel sql-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">SQL and logic</p>
            <h2>—</h2>
          </div>
        </div>
        <div className="query-tabs">
          <button disabled>Q1</button>
        </div>
        <div className="metadata-strip">
          <span>0 tables</span>
          <span>0 aggregations</span>
          <span>0 filters</span>
          <span>0 joins</span>
        </div>
        <pre className="sql-code">-- Load reports from Dashboard to view SQL.</pre>
      </section>
    );
  }

  return (
    <section className="panel sql-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">SQL and logic</p>
          <h2>{query.kpiName}</h2>
        </div>
      </div>
      <div className="query-tabs">
        {queries.map((item, index) => (
          <button
            key={item.id}
            className={classNames(selectedQuery === item.id && 'active')}
            onClick={() => setSelectedQuery(item.id)}
          >
            Q{index + 1}
          </button>
        ))}
      </div>
      <div className="metadata-strip">
        <span>{query.tables.length} tables</span>
        <span>{query.aggregations.length} aggregations</span>
        <span>{query.filters.length} filters</span>
        <span>{query.joins.length} joins</span>
      </div>
      <pre className="sql-code">{query.fullSql}</pre>
    </section>
  );
}

function RecordHeader({
  report,
  type,
  analysedAt,
}: {
  report: FullReport | TargetDetailReport;
  type: 'Source' | 'Target';
  analysedAt?: number;
}) {
  const estate = type === 'Source' ? SOURCE_ORG : TARGET_ORG;
  const role = type === 'Source' ? 'Source estate' : 'Reference catalog';
  const hasReal = report.id !== '—';

  return (
    <section className="record-header">
      <div>
        <p className="eyebrow">{estate} {type === 'Source' ? 'source' : 'reference'} report</p>
        <h2>{report.name}</h2>
        <p>{report.description}</p>
        {hasReal && <ProvenanceBadge source="analysis" at={analysedAt} />}
      </div>
      <div className="record-meta-grid">
        <span><strong>ID</strong>{report.id}</span>
        <span><strong>Domain</strong>{report.domain}</span>
        <span><strong>Estate</strong>{estate}</span>
        <span><strong>Role</strong>{role}</span>
        <span><strong>Owner</strong>{report.owner}</span>
        <span><strong>Queries</strong>{report.numQueries}</span>
      </div>
    </section>
  );
}

// ---- Tab views ----

function KpiScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f97316' : '#ef4444';
  return (
    <div className="kpi-score-bar-wrap">
      <div className="kpi-score-bar" style={{ width: `${pct}%`, background: color }} />
      <span>{pct}%</span>
    </div>
  );
}

function MappingPatternBadge({ pattern }: { pattern: string }) {
  const styleMap: Record<string, { bg: string; text: string }> = {
    '1:1':        { bg: '#f0fdf4', text: '#166534' },
    '1:many':     { bg: '#e0f2fe', text: '#075985' },
    'many:1':     { bg: '#eaf5ff', text: '#075985' },
    'many:many':  { bg: '#fef9c3', text: '#854d0e' },
    'partial':    { bg: '#fff4e5', text: '#92400e' },
    'none':       { bg: '#fef2f2', text: '#991b1b' },
  };
  const s = styleMap[pattern] ?? { bg: '#f1f5f9', text: '#475569' };
  return (
    <span className="mapping-pattern-badge" style={{ background: s.bg, color: s.text }}>
      {pattern}
    </span>
  );
}

function CoverageMatrix({
  source,
  target,
  overlapPercent,
  decision,
  kpiMatrix,
  mappingPattern,
  lineageSummary,
  analysisCompletedAt,
}: {
  source: FullReport;
  target: TargetDetailReport | null;
  overlapPercent: number;
  decision: Decision;
  kpiMatrix: KpiMappingEntry[];
  mappingPattern: string;
  lineageSummary: string;
  analysisCompletedAt?: number;
}) {
  const noTarget     = !target || target.id === '—';
  const hasLlmMatrix = kpiMatrix.length > 0;

  const matched = kpiMatrix.filter(k => k.status === 'matched').length;
  const partial  = kpiMatrix.filter(k => k.status === 'partial').length;
  const gaps     = kpiMatrix.filter(k => k.status === 'gap').length;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Source → Reference semantic alignment · analysis</p>
          <h2>
            Coverage against{' '}
            {noTarget ? <em>no matched reference</em> : <strong>{target!.name}</strong>}
          </h2>
        </div>
        <span className="panel-badge">
          {Math.round(overlapPercent)} % overlap · {decision}
        </span>
        <MappingPatternBadge pattern={mappingPattern || '—'} />
        {analysisCompletedAt && <ProvenanceBadge source="analysis" at={analysisCompletedAt} />}
      </div>

      {lineageSummary && (
        <p className="coverage-lineage-summary">{lineageSummary}</p>
      )}

      {hasLlmMatrix && (
        <div className="coverage-breakdown">
          <div>
            <span className="coverage-stat-label">Matched KPIs</span>
            <strong style={{ color: '#166534' }}>{matched} / {kpiMatrix.length}</strong>
            <em>exact / strong equivalent</em>
          </div>
          <div>
            <span className="coverage-stat-label">Partial matches</span>
            <strong style={{ color: '#92400e' }}>{partial} / {kpiMatrix.length}</strong>
            <em>business logic differs</em>
          </div>
          <div>
            <span className="coverage-stat-label">KPI gaps</span>
            <strong style={{ color: '#991b1b' }}>{gaps} / {kpiMatrix.length}</strong>
            <em>not covered in reference</em>
          </div>
        </div>
      )}

      {!hasLlmMatrix && (
        <div className="coverage-breakdown">
          <div>
            <span className="coverage-stat-label">KPIs identified</span>
            <strong>{source.allKpis.length}</strong>
            <em>awaiting analysis</em>
          </div>
          <div>
            <span className="coverage-stat-label">Tables identified</span>
            <strong>{source.allTables.length}</strong>
            <em>from report artefacts</em>
          </div>
        </div>
      )}

      <div className="coverage-subheading" style={{ marginTop: 16 }}>
        {hasLlmMatrix ? 'KPI mapping matrix — semantic analysis' : 'KPI inventory (analysis pending)'}
      </div>
      <div className="table-scroll coverage-table-scroll">
        <table className="data-table">
          <thead>
            {hasLlmMatrix ? (
              <tr>
                <th>Source KPI</th>
                <th>Mapped target KPI</th>
                <th>Semantic</th>
                <th>Logic</th>
                <th>Lineage</th>
                <th>Overall</th>
                <th>Status</th>
                <th>Evidence / notes</th>
              </tr>
            ) : (
              <tr>
                <th>Source KPI alias</th>
                <th>Formula</th>
                <th>Column</th>
              </tr>
            )}
          </thead>
          <tbody>
            {hasLlmMatrix ? (
              kpiMatrix.length === 0 ? (
                <tr className="placeholder-row"><td colSpan={8}>—</td></tr>
              ) : kpiMatrix.map((k, i) => (
                <tr key={`${k.sourceKpi}-${i}`}>
                  <td className="font-mono">{k.sourceKpi}</td>
                  <td className="font-mono">{k.targetKpi ?? <em className="subtext">none</em>}</td>
                  <td><KpiScoreBar value={k.semanticScore} /></td>
                  <td><KpiScoreBar value={k.logicScore} /></td>
                  <td><KpiScoreBar value={k.lineageScore} /></td>
                  <td><KpiScoreBar value={k.overallScore} /></td>
                  <td>
                    <span className={classNames('coverage-flag', k.status === 'matched' ? 'ok' : k.status === 'partial' ? 'partial' : 'gap')}>
                      {k.status === 'matched' ? '✓ matched' : k.status === 'partial' ? '~ partial' : '✗ gap'}
                    </span>
                  </td>
                  <td className="subtext" style={{ maxWidth: 300 }}>{k.notes}</td>
                </tr>
              ))
            ) : (
              source.allKpis.length === 0 ? (
                <tr className="placeholder-row"><td>—</td><td>—</td><td>—</td></tr>
              ) : source.allKpis.map((k, i) => (
                <tr key={`${k.alias}-${i}`}>
                  <td className="font-mono">{k.alias}</td>
                  <td className="font-mono subtext">{k.formula}</td>
                  <td className="font-mono subtext">{k.column}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceLineageView({
  sources,
  targets,
  selectedId,
  setSelectedId,
  decisions,
  targetCount,
  phase,
  timings,
}: {
  sources: FullReport[];
  targets: TargetDetailReport[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  decisions: RationalizationDecision[];
  targetCount: number;
  phase: WorkbenchPhase;
  timings: PhaseTimings;
}) {
  const realSelected = sources.find(r => r.id === selectedId) ?? sources[0] ?? null;
  const selected = realSelected ?? placeholderSource();
  const decision = realSelected ? getSourceDecision(realSelected, decisions) : null;
  const matchedTarget = decision?.targetId
    ? (targets.find(t => t.id === decision.targetId) ?? null)
    : (realSelected?.bestMatchTargetId
        ? (targets.find(t => t.id === realSelected.bestMatchTargetId) ?? null)
        : null);
  const events = buildSourceTrail(selected, decision, targetCount, phase, timings);

  return (
    <main className="workspace three-column">
      <Sidebar title="Source lineage" items={sources} selectedId={selected.id} onSelect={setSelectedId} />
      <div className="record-workspace">
        <RecordHeader report={selected} type="Source" analysedAt={timings.analysisCompletedAt} />
        <TableDependencies queries={selected.queries.source} />
        <CoverageMatrix
          source={selected}
          target={matchedTarget}
          overlapPercent={decision?.overlapPercent ?? 0}
          decision={decision?.decision ?? 'Migrate'}
          kpiMatrix={decision?.kpiMappingMatrix ?? []}
          mappingPattern={decision?.mappingPattern ?? '—'}
          lineageSummary={decision?.lineageSummary ?? ''}
          analysisCompletedAt={timings.analysisCompletedAt}
        />
        <SqlExplorer queries={selected.queries.source} />
      </div>
      <RationalizationTrail events={events} />
    </main>
  );
}

function TargetLineageView({
  targets,
  selectedId,
  setSelectedId,
  decisions,
  phase,
  timings,
}: {
  targets: TargetDetailReport[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  decisions: RationalizationDecision[];
  phase: WorkbenchPhase;
  timings: PhaseTimings;
}) {
  const realSelected = targets.find(r => r.id === selectedId) ?? targets[0] ?? null;
  const selected = realSelected ?? placeholderTarget();
  const queries = selected.queries.map(q => ({ ...q, preview: q.fullSql.slice(0, 80) }));
  const events = buildTargetTrail(selected, decisions, phase, timings);

  return (
    <main className="workspace three-column">
      <Sidebar title="Target lineage" items={targets} selectedId={selected.id} onSelect={setSelectedId} />
      <div className="record-workspace">
        <RecordHeader report={selected} type="Target" analysedAt={timings.analysisCompletedAt} />
        <TableDependencies queries={queries} />
        <SqlExplorer queries={queries} />
      </div>
      <RationalizationTrail events={events} />
    </main>
  );
}

function MetadataView({
  type,
  reports,
  selectedId,
  setSelectedId,
  decisions,
  targetCount,
  phase,
  timings,
}: {
  type: 'Source' | 'Target';
  reports: Array<FullReport | TargetDetailReport>;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  decisions: RationalizationDecision[];
  targetCount?: number;
  phase: WorkbenchPhase;
  timings: PhaseTimings;
}) {
  const realSelected = reports.find(r => r.id === selectedId) ?? reports[0] ?? null;
  const selected: FullReport | TargetDetailReport =
    realSelected ?? (type === 'Source' ? placeholderSource() : placeholderTarget());

  const kpis = 'allKpis' in selected ? selected.allKpis : selected.kpis;
  const tables: string[] = selected.allTables;
  const sidebarItems = reports.map(r => ({ id: r.id, name: r.name, domain: r.domain }));
  const decision = decisions.find(d => d.sourceId === selected.id) ?? null;

  const trailEvents =
    type === 'Source' && 'allKpis' in selected
      ? buildSourceTrail(selected as FullReport, decision, targetCount ?? 0, phase, timings)
      : buildTargetTrail(selected as TargetDetailReport, decisions, phase, timings);

  return (
    <main className="workspace three-column">
      <Sidebar
        title={`${type === 'Source' ? SOURCE_ORG : TARGET_ORG} metadata`}
        items={sidebarItems}
        selectedId={selected.id}
        onSelect={setSelectedId}
      />
      <div className="record-workspace">
        <RecordHeader report={selected} type={type} analysedAt={timings.analysisCompletedAt} />
        <div className="metadata-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Business context</p>
                <h2>{type === 'Source' ? 'Source report purpose and usage' : 'Reference report context'}</h2>
              </div>
            </div>
            <p className="business-copy">{selected.description}</p>
            {'kpiDelta' in selected ? (
              <div className="context-metrics">
                <span><strong>{selected.numQueries}</strong> query files</span>
                <span><strong>{selected.kpiDelta.filter(k => k.missingInTarget).length}</strong> KPI gaps</span>
                <span>
                  <strong>{decision?.targetName ?? selected.bestMatchTargetName ?? 'Analysis pending'}</strong>
                  Mapped reference
                </span>
              </div>
            ) : (
              <div className="context-metrics">
                <span><strong>Reference</strong> estate</span>
                <span><strong>{kpis.length}</strong> reference KPIs</span>
                <span><strong>{tables.length}</strong> governed tables</span>
              </div>
            )}
            {decision && (
              <div className="engine-note">
                <ShieldCheck size={16} />
                <span>{decision.rationale}</span>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Schema</p>
                <h2>Tables and semantic layer</h2>
              </div>
            </div>
            <div className="schema-cloud">
              {tables.length === 0
                ? <span className="placeholder-chip">—</span>
                : tables.map(table => <span key={table}>{table}</span>)}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Measures</p>
              <h2>{type === 'Source' ? 'Source KPIs and formulas' : 'Reference KPIs and formulas'}</h2>
            </div>
            <span className="panel-badge">{kpis.length} KPIs</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Aggregation</th>
                  <th>Column</th>
                  <th>Source columns</th>
                  <th>Formula</th>
                  <th>Query</th>
                </tr>
              </thead>
              <tbody>
                {kpis.length === 0 ? (
                  <tr className="placeholder-row">
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                ) : (
                  kpis.map(kpi => (
                    <tr key={`${kpi.alias}-${kpi.queryFile}`}>
                      <td className="font-bold">{kpi.alias}</td>
                      <td>{kpi.agg}</td>
                      <td className="font-mono">{kpi.column}</td>
                      <td className="font-mono">{kpi.sourceColumns?.join(', ') || kpi.column}</td>
                      <td className="font-mono">{kpi.formula}</td>
                      <td>{kpi.queryFile}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <RationalizationTrail events={trailEvents} />
    </main>
  );
}

// Compact summary card — confidence + decisions + key assumptions at a glance,
// so analysts don't have to read the full Program Trail just to get the headline.
function AnalysisSummary({
  decisions,
  sourceCount,
  targetCount,
  phase,
}: {
  decisions: RationalizationDecision[];
  sourceCount: number;
  targetCount: number;
  phase: WorkbenchPhase;
}) {
  const mapped = decisions.length;
  const confs  = decisions.map(d => d.confidenceScore);
  const avg    = mapped ? Math.round((confs.reduce((a, b) => a + b, 0) / mapped) * 100) : null;
  const lo     = mapped ? Math.round(Math.min(...confs) * 100) : null;
  const hi     = mapped ? Math.round(Math.max(...confs) * 100) : null;

  const counts = (['Rationalize', 'Consolidate', 'Migrate'] as Decision[]).map(label => ({
    label,
    count: decisions.filter(d => d.decision === label).length,
  }));

  return (
    <section className="analysis-summary">
      <div className="analysis-summary-header">
        <p className="panel-kicker">At a glance</p>
        <h3>Analysis summary</h3>
        <span className="analysis-summary-meta">
          {sourceCount || '—'} source report{sourceCount === 1 ? '' : 's'} · {targetCount || '—'} reference{targetCount === 1 ? '' : 's'}
          {phase === 'analysing' && ' · analysis in flight'}
        </span>
      </div>

      <div className="analysis-summary-grid">
        <div className="analysis-summary-block">
          <span className="analysis-summary-kicker">Confidence</span>
          <strong className="analysis-summary-stat">{avg !== null ? `${avg}%` : '—'}</strong>
          <span className="analysis-summary-sub">
            {mapped ? `mean · range ${lo}–${hi}%` : 'no decisions yet'}
          </span>
        </div>

        <div className="analysis-summary-block">
          <span className="analysis-summary-kicker">Decisions</span>
          <div className="analysis-summary-decisions">
            {counts.map(c => (
              <span key={c.label} className={classNames('dec-badge', c.label.toLowerCase())}>
                <strong>{c.count}</strong> {c.label}
              </span>
            ))}
          </div>
          <span className="analysis-summary-sub">
            decision bands come from the analysis output
          </span>
        </div>

        <div className="analysis-summary-block">
          <span className="analysis-summary-kicker">Core assumptions</span>
          <ul className="analysis-summary-assumptions">
            <li>Business logic, formula, lineage, filters, aggregation, dimensions, and grain drive KPI comparison.</li>
            <li>Schema prefixes (fact_, dim_, vz_, mkt_, ...) are treated as vendor artefacts, not semantic differences.</li>
            <li>Decisions are generated only after source and reference metadata, lineage, mapping, and KPI comparison complete.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function DecisionView({
  sources,
  targets,
  decisions,
  phase,
  analysisNote,
  sourceFailures,
  timings,
  inventory,
  liveStats,
  onApprove,
  onOverride,
}: {
  sources: FullReport[];
  targets: TargetReport[];
  decisions: RationalizationDecision[];
  phase: WorkbenchPhase;
  analysisNote: string | null;
  sourceFailures: Array<{ bundleId: string; message: string }>;
  timings: PhaseTimings;
  inventory: ReportInventory | null;
  liveStats: LiveAnalysisStats;
  onApprove: (sourceId: string) => void;
  onOverride: (sourceId: string) => void;
}) {
  const trailEvents = buildProgramTrail(sources.length, targets.length, decisions, inventory, liveStats, phase, timings);
  const sourceRows = sources.map(source => ({
    source,
    decision: getSourceDecision(source, decisions),
  }));
  const decisionCounts = (['Rationalize', 'Consolidate', 'Migrate'] as Decision[]).map(label => ({
    label,
    count: decisions.filter(d => d.decision === label).length,
  }));

  return (
    <main className="workspace decision-workspace">
      <AnalysisSummary
        decisions={decisions}
        sourceCount={sources.length}
        targetCount={targets.length}
        phase={phase}
      />
      <section className="panel decision-table-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Governance · source-centric</p>
            <h2>Source disposition matrix · {sources.length || '—'} source reports</h2>
          </div>
          <span className="panel-badge">
            {decisionCounts.find(d => d.label === 'Rationalize')?.count ?? 0} Rationalize ·{' '}
            {decisionCounts.find(d => d.label === 'Consolidate')?.count ?? 0} Consolidate ·{' '}
            {decisionCounts.find(d => d.label === 'Migrate')?.count ?? 0} Migrate
          </span>
          {timings.analysisCompletedAt && (
            <ProvenanceBadge source="analysis" at={timings.analysisCompletedAt} />
          )}
        </div>
        {phase === 'analysing' && (
          <div className="empty-intelligence">
            <Loader2 size={16} className="animate-spin" />
            <span>Analysis is running — dispositions populate as each source completes.</span>
          </div>
        )}
        {phase === 'ready' && analysisNote && (
          <div className="empty-intelligence">
            <AlertCircle size={16} />
            <span>{analysisNote}</span>
          </div>
        )}
        {sourceFailures.length > 0 && (
          <details className="empty-intelligence" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fca5a5', display: 'block', padding: '12px' }}>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} />
              <span>
                <strong>{sourceFailures.length}</strong> source report{sourceFailures.length === 1 ? '' : 's'} could not be analyzed.
                These rows are not included in the disposition matrix below. <em>(click to expand error details)</em>
              </span>
            </summary>
            <div style={{ marginTop: 8, fontSize: 12, fontFamily: 'monospace', maxHeight: 240, overflowY: 'auto' }}>
              {sourceFailures.map((f, i) => (
                <div key={i} style={{ padding: '4px 0', borderTop: i > 0 ? '1px solid #fca5a5' : 'none' }}>
                  <strong>{f.bundleId}</strong>: {f.message}
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="table-scroll">
          <table className="data-table decision-table">
            <thead>
              <tr>
                <th>Source report</th>
                <th>Domain</th>
                <th>Verizon reference</th>
                <th>Mapping</th>
                <th>Overlap</th>
                <th>Disposition</th>
                <th>Confidence</th>
                <th>KPI gaps</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.length === 0 ? (
                <tr className="placeholder-row">
                  <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
                </tr>
              ) : (
                sourceRows.map(({ source, decision }) => {
                  const isPending = !decision && phase === 'analysing';
                  const overlap     = decision?.overlapPercent ?? 0;
                  const targetName  = decision?.targetName  ?? null;
                  const targetId    = decision?.targetId    ?? null;
                  const kpiGapCount = decision?.kpiGaps?.length ?? 0;
                  const status      = decision?.status ?? 'Pending';
                  return (
                    <tr key={source.id} className={isPending ? 'analyzing-row' : undefined}>
                    <td>
                      <strong>{source.name}</strong>
                      <span className="subtext">{source.id}</span>
                    </td>
                    <td>{source.domain}</td>
                    <td>
                      {isPending ? (
                        <span className="analyzing-badge"><Loader2 size={11} className="animate-spin" /> Analyzing…</span>
                      ) : targetName ? (
                        <>
                          <strong>{targetName}</strong>
                          <span className="subtext">{targetId}</span>
                        </>
                      ) : (
                        <span className="subtext">—</span>
                      )}
                    </td>
                    <td>
                      {decision?.mappingPattern
                        ? <MappingPatternBadge pattern={decision.mappingPattern} />
                        : <span className="subtext">—</span>
                      }
                    </td>
                    <td>
                      {isPending ? <span className="subtext">—</span> : (
                        <div className="mini-overlap">
                          <span>{formatPercent(overlap)}</span>
                          <div>
                            <i style={{ width: `${overlap}%`, background: overlapColor(decision?.decision) }} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td>{decision ? <DecisionPill decision={decision.decision} /> : <span className="subtext">—</span>}</td>
                    <td>{decision ? <ConfidencePill score={decision.confidenceScore} /> : <span className="subtext">—</span>}</td>
                    <td><span className="font-mono">{decision ? kpiGapCount : '—'}</span></td>
                    <td><span className="soft-tag">{status}</span></td>
                    <td>
                      <div className="row-actions">
                        <button
                          disabled={!decision}
                          onClick={() => onApprove(source.id)}
                          title="Approve this source disposition"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => onOverride(source.id)}
                          title="Override this source disposition"
                        >
                          Override
                        </button>
                      </div>
                    </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      <RationalizationTrail events={trailEvents} title="Program Trail" />
    </main>
  );
}

// ---- Override modal ----

function OverrideModal({
  source,
  targets,
  existing,
  onClose,
  onSave,
}: {
  source: FullReport;
  targets: TargetReport[];
  existing: RationalizationDecision | null;
  onClose: () => void;
  onSave: (decision: RationalizationDecision) => void;
}) {
  const [decision, setDecision] = useState<Decision>(existing?.decision ?? 'Consolidate');
  const [targetId, setTargetId] = useState(existing?.targetId ?? targets[0]?.id ?? '');
  const [overlap, setOverlap] = useState(existing?.overlapPercent ?? 50);
  const [reason, setReason] = useState(existing?.rationale ?? '');
  const target = targets.find(t => t.id === targetId) ?? null;

  const save = () => {
    onSave({
      sourceId:         source.id,
      sourceName:       source.name,
      domain:           source.domain,
      targetId:         target?.id ?? null,
      targetName:       target?.name ?? null,
      mappingPattern:   existing?.mappingPattern  ?? 'partial',
      overlapPercent:   overlap,
      decision,
      confidenceScore:  existing?.confidenceScore ?? 0.75,
      rationale:        reason || 'Manual override captured by analyst.',
      lineageSummary:   existing?.lineageSummary  ?? '',
      recommendation:   'Manual override — analyst decision takes precedence.',
      kpiGaps:          existing?.kpiGaps         ?? [],
      kpiMappingMatrix: existing?.kpiMappingMatrix ?? [],
      status:           'Overridden',
      source:           'manual',
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="override-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Manual governance action</p>
            <h2>Override decision</h2>
            <p>{source.id} · {source.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label>
            Decision
            <select value={decision} onChange={e => setDecision(e.target.value as Decision)}>
              <option>Migrate</option>
              <option>Consolidate</option>
              <option>Rationalize</option>
            </select>
          </label>
          <label>
            Reference report
            <select value={targetId} onChange={e => setTargetId(e.target.value)}>
              {targets.map(t => (
                <option key={t.id} value={t.id}>{t.id} · {t.name}</option>
              ))}
            </select>
          </label>
          <label>
            Overlap %
            <input
              type="number"
              min={0}
              max={100}
              value={overlap}
              onChange={e => setOverlap(Number(e.target.value))}
            />
          </label>
          <label>
            Governance rationale
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
              placeholder="Explain why this decision overrides the generated recommendation."
            />
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary-action" onClick={save}>Save override</button>
        </div>
      </div>
    </div>
  );
}

// ---- Root ----

export default function App() {
  const [phase, setPhase]                         = useState<WorkbenchPhase>('intake');
  const [activeTab, setActiveTab]                 = useState<TabKey>('dashboard');
  const [inventory, setInventory]                 = useState<ReportInventory | null>(null);
  const [loadError, setLoadError]                 = useState<string | null>(null);
  const [decisions, setDecisions]                 = useState<RationalizationDecision[]>([]);
  const [analysisNote, setAnalysisNote]           = useState<string | null>(null);
  const [sourceFailures, setSourceFailures]       = useState<Array<{ bundleId: string; message: string }>>([]);
  const [analysisModel, setAnalysisModel]         = useState<string | null>(null);
  const [analysisDurationMs, setAnalysisDurationMs] = useState<number | null>(null);
  const [phaseTimings, setPhaseTimings]           = useState<PhaseTimings>({});
  const [selectedSourceId, setSelectedSourceId]   = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId]   = useState<string | null>(null);
  const [overrideSourceId, setOverrideSourceId]   = useState<string | null>(null);

  // Holds the cleanup function for any in-flight SSE stream
  const streamCleanup = useRef<(() => void) | null>(null);

  const handleIntakeApply = useCallback(async (sourcePath: string, targetPath: string) => {
    // Cancel any in-flight analysis stream before starting a new load
    streamCleanup.current?.();
    streamCleanup.current = null;

    setPhase('loading');
    setLoadError(null);
    setDecisions([]);
    setAnalysisNote(null);
    setSourceFailures([]);
    setAnalysisModel(null);
    setAnalysisDurationMs(null);
    setPhaseTimings({ loadStartedAt: Date.now() });

    try {
      const data = await loadReportInventoryFromPaths(sourcePath, targetPath);
      const loadDoneAt = Date.now();
      setInventory(data);
      setSelectedSourceId(data.sources[0]?.id ?? null);
      setSelectedTargetId(data.targets[0]?.id ?? null);
      setActiveTab('dashboard');
      setPhaseTimings(prev => ({
        ...prev,
        loadCompletedAt:   loadDoneAt,
        analysisStartedAt: loadDoneAt,
      }));
      setPhase('analysing');

      // Targets, sources, and decisions stream independently. UI populates
      // incrementally as each analysis call returns.
      const analysisStartedAt = Date.now();
      streamCleanup.current = streamRationalizationAnalysis(
        data,
        (analysedInventory) => {
          // Legacy bulk inventory event (still emitted in some flows).
          setInventory(analysedInventory);
          setSelectedTargetId(prev => prev ?? analysedInventory.targets[0]?.id ?? null);
        },
        (target, targetIndexEntry /* , completed, total */) => {
          // Each target streams in independently — append to inventory.
          setInventory(inv => {
            if (!inv) return inv;
            const exists = inv.targets.some(t => t.id === target.id);
            return {
              ...inv,
              targets:     exists ? inv.targets.map(t => t.id === target.id ? target : t) : [...inv.targets, target],
              targetIndex: inv.targetIndex.some(t => t.id === targetIndexEntry.id)
                ? inv.targetIndex.map(t => t.id === targetIndexEntry.id ? targetIndexEntry : t)
                : [...inv.targetIndex, targetIndexEntry],
            };
          });
          setSelectedTargetId(prev => prev ?? target.id);
        },
        (source, sourceIndexEntry) => {
          // Each source streams in independently — append to inventory.
          setInventory(inv => {
            if (!inv) return inv;
            const exists = inv.sources.some(s => s.id === source.id);
            return {
              ...inv,
              sources:     exists ? inv.sources.map(s => s.id === source.id ? source : s) : [...inv.sources, source],
              sourceIndex: inv.sourceIndex.some(s => s.id === sourceIndexEntry.id)
                ? inv.sourceIndex.map(s => s.id === sourceIndexEntry.id ? sourceIndexEntry : s)
                : [...inv.sourceIndex, sourceIndexEntry],
            };
          });
          setSelectedSourceId(prev => prev ?? source.id);
        },
        (decision) => {
          // Upsert: replace if already present (e.g. retry), append if new
          setDecisions(prev => {
            const idx = prev.findIndex(d => d.sourceId === decision.sourceId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = decision;
              return next;
            }
            return [...prev, decision];
          });
          setInventory(inv => {
            if (!inv) return inv;
            const gapSet = new Set(decision.kpiGaps);
            return {
              ...inv,
              sources: inv.sources.map(s =>
                s.id !== decision.sourceId ? s : {
                  ...s,
                  bestMatchTargetId:   decision.targetId,
                  bestMatchTargetName: decision.targetName,
                  overlapPercent:      decision.overlapPercent,
                  decision:            decision.decision as import('./types').Decision,
                  confidenceScore:     decision.confidenceScore,
                  analysisExplanation: decision.rationale,
                  kpiDelta: s.kpiDelta.map(k => ({
                    ...k,
                    missingInTarget: gapSet.has(k.name),
                    suggestedAction: gapSet.has(k.name)
                      ? `Add "${k.name}" as a new calculated measure in the reference report.`
                      : undefined,
                  })),
                },
              ),
            };
          });
        },
        (_progress) => {
          // Phase progress events fire when target_catalog and source_analysis
          // phases start. Useful hook for a future progress indicator.
        },
        (bundleId, message) => {
          // Source analysis failed for this bundle. Track it so the UI can
          // display a visible warning instead of silently dropping the row.
          setSourceFailures(prev => [...prev, { bundleId, message }]);
        },
        (model, durationMs) => {
          const finishedAt = Date.now();
          setAnalysisModel(model);
          setAnalysisDurationMs(durationMs ?? (finishedAt - analysisStartedAt));
          setPhaseTimings(prev => ({ ...prev, analysisCompletedAt: finishedAt }));
          setPhase('ready');
        },
        (err) => {
          setAnalysisNote(err.message);
          setPhaseTimings(prev => ({ ...prev, analysisCompletedAt: Date.now() }));
          setPhase('ready');
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load reports.';
      setLoadError(msg);
      setPhase('intake');
      setPhaseTimings({});
      setDecisions([]);
    }
  }, []);

  const approveDecision = (sourceId: string) => {
    setDecisions(prev => prev.map(d => d.sourceId === sourceId ? { ...d, status: 'Approved' } : d));
  };

  const saveOverride = (decision: RationalizationDecision) => {
    setDecisions(prev => {
      const next = prev.filter(d => d.sourceId !== decision.sourceId);
      return [...next, decision].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
    });
    setOverrideSourceId(null);
  };

  // Full UI always renders — inventory may be null before data is loaded
  const sources     = inventory?.sources     ?? [];
  const targets     = inventory?.targets     ?? [];
  const targetIndex = inventory?.targetIndex ?? [];
  const selectedSource = sources.find(r => r.id === selectedSourceId) ?? sources[0] ?? null;
  const selectedTarget = targets.find(r => r.id === selectedTargetId) ?? targets[0] ?? null;
  const overrideSource = overrideSourceId
    ? sources.find(r => r.id === overrideSourceId) ?? null
    : null;

  return (
    <div className="enterprise-app">
      <AppHeader activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === 'dashboard' && (
        <DashboardView
          inventory={inventory}
          decisions={decisions}
          onReload={handleIntakeApply}
          isLoading={phase === 'loading'}
          loadError={loadError}
        />
      )}
      {activeTab === 'source-lineage' && (
        <SourceLineageView
          sources={sources}
          targets={targets}
          selectedId={selectedSource?.id ?? null}
          setSelectedId={setSelectedSourceId}
          decisions={decisions}
          targetCount={targets.length}
          phase={phase}
          timings={phaseTimings}
        />
      )}
      {activeTab === 'target-lineage' && (
        <TargetLineageView
          targets={targets}
          selectedId={selectedTarget?.id ?? null}
          setSelectedId={setSelectedTargetId}
          decisions={decisions}
          phase={phase}
          timings={phaseTimings}
        />
      )}
      {activeTab === 'source-metadata' && (
        <MetadataView
          type="Source"
          reports={sources}
          selectedId={selectedSource?.id ?? null}
          setSelectedId={setSelectedSourceId}
          decisions={decisions}
          targetCount={targets.length}
          phase={phase}
          timings={phaseTimings}
        />
      )}
      {activeTab === 'target-metadata' && (
        <MetadataView
          type="Target"
          reports={targets}
          selectedId={selectedTarget?.id ?? null}
          setSelectedId={setSelectedTargetId}
          decisions={decisions}
          phase={phase}
          timings={phaseTimings}
        />
      )}
      {activeTab === 'decision' && (
        <DecisionView
          sources={sources}
          targets={targetIndex}
          decisions={decisions}
          phase={phase}
          analysisNote={analysisNote}
          sourceFailures={sourceFailures}
          timings={phaseTimings}
          inventory={inventory}
          liveStats={{ model: analysisModel, durationMs: analysisDurationMs }}
          onApprove={approveDecision}
          onOverride={setOverrideSourceId}
        />
      )}

      {overrideSource && (
        <OverrideModal
          source={overrideSource}
          targets={targetIndex}
          existing={getSourceDecision(overrideSource, decisions)}
          onClose={() => setOverrideSourceId(null)}
          onSave={saveOverride}
        />
      )}
    </div>
  );
}
