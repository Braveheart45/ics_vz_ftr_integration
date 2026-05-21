import { Decision, FullReport, SourceReport, TargetDetailReport, TargetReport } from './types';

export interface KpiMappingEntry {
  sourceKpi: string;
  targetKpi: string | null;
  semanticScore: number;
  logicScore: number;
  lineageScore: number;
  overallScore: number;
  status: 'matched' | 'partial' | 'gap';
  notes: string;
}

export interface RationalizationDecision {
  sourceId: string;
  sourceName: string;
  domain: string;
  targetId: string | null;
  targetName: string | null;
  mappingPattern: string;
  overlapPercent: number;
  decision: Decision;
  confidenceScore: number;
  rationale: string;
  lineageSummary: string;
  recommendation: string;
  kpiGaps: string[];
  kpiMappingMatrix: KpiMappingEntry[];
  status: 'Pending' | 'Approved' | 'Overridden';
  source: 'analysis' | 'manual';
}

export interface RawFileItem {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  isText: boolean;
  content: string | null;
  contentTruncated: boolean;
}

export interface ReportInventory {
  sourceFiles: RawFileItem[];
  targetFiles: RawFileItem[];
  sources: FullReport[];
  sourceIndex: SourceReport[];
  targetIndex: TargetReport[];
  targets: TargetDetailReport[];
}

export async function loadReportInventoryFromPaths(
  sourcePath: string,
  targetPath: string,
): Promise<ReportInventory> {
  const response = await fetch('/api/load-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, targetPath }),
  });

  const data = await response.json() as
    | ({ status: 'ok' } & ReportInventory)
    | { status: 'error'; error: { code: string; message: string; details?: unknown } };

  if (!response.ok || data.status === 'error') {
    const msg = data.status === 'error' ? data.error.message : `Server error ${response.status}`;
    throw new Error(msg);
  }

  return {
    sourceFiles: data.sourceFiles,
    targetFiles: data.targetFiles,
    sources: data.sources,
    sourceIndex: data.sourceIndex,
    targetIndex: data.targetIndex,
    targets: data.targets,
  };
}

export interface PhaseProgress {
  phase: 'target_catalog' | 'source_analysis';
  total: number;
}

export function streamRationalizationAnalysis(
  inventory: ReportInventory,
  onInventory: (inventory: ReportInventory) => void,
  onTarget: (target: TargetDetailReport, targetIndex: TargetReport, completed: number, total: number) => void,
  onSource: (source: FullReport, sourceIndex: SourceReport) => void,
  onDecision: (d: RationalizationDecision) => void,
  onPhase: (progress: PhaseProgress) => void,
  onSourceFailure: (bundleId: string, message: string) => void,
  onComplete: (model: string, durationMs: number) => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch('/api/rationalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sourceFiles: inventory.sourceFiles,
          targetFiles: inventory.targetFiles,
        }),
      });

      if (!response.ok) {
        throw new Error(`Analysis request failed with HTTP ${response.status}.`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from analysis endpoint.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event = JSON.parse(json) as { type: string; [key: string]: unknown };

            if (event.type === 'phase') {
              onPhase({
                phase: event.phase as PhaseProgress['phase'],
                total: event.total as number,
              });
            } else if (event.type === 'inventory') {
              // Legacy bulk inventory event — still handled for backward compatibility.
              onInventory({
                sourceFiles: inventory.sourceFiles,
                targetFiles: inventory.targetFiles,
                sources: (event.sources as FullReport[]) ?? [],
                sourceIndex: (event.sourceIndex as SourceReport[]) ?? [],
                targetIndex: (event.targetIndex as TargetReport[]) ?? [],
                targets: (event.targets as TargetDetailReport[]) ?? [],
              });
            } else if (event.type === 'target') {
              onTarget(
                event.target as TargetDetailReport,
                event.targetIndex as TargetReport,
                event.completed as number,
                event.total as number,
              );
            } else if (event.type === 'target_error') {
              console.warn('Target analysis error:', event.bundleId, event.message);
            } else if (event.type === 'source') {
              onSource(
                event.source as FullReport,
                event.sourceIndex as SourceReport,
              );
            } else if (event.type === 'decision') {
              onDecision(event.decision as RationalizationDecision);
            } else if (event.type === 'source_error') {
              onSourceFailure(
                (event.bundleId as string) ?? 'unknown',
                (event.message as string) ?? 'analysis failed',
              );
            } else if (event.type === 'complete') {
              onComplete(event.model as string, event.durationMs as number);
            } else if (event.type === 'not_configured') {
              onError(new Error('Analysis service is not configured on the server.'));
            } else if (event.type === 'error') {
              onError(new Error((event.message as string) ?? 'Analysis error.'));
            }
          } catch {
            // Ignore malformed SSE lines.
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') onError(err as Error);
    }
  })();

  return () => controller.abort();
}
