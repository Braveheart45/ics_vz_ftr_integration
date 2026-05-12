'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/stores/use-app-store';
import { Database } from 'lucide-react';

// ── Sample Projects ──────────────────────────────────────────
const JIRA_PROJECTS = [
  { value: 'ENGCORE', label: 'ENGCORE — Engineering Core' },
  { value: 'DATAPIPE', label: 'DATAPIPE — Data Pipeline' },
  { value: 'ANALYTICS', label: 'ANALYTICS — Analytics Platform' },
  { value: 'RETAILOPS', label: 'RETAILOPS — Retail Operations' },
  { value: 'FINREP', label: 'FINREP — Financial Reporting' },
  { value: 'MARKTECH', label: 'MARKTECH — Marketing Tech' },
  { value: 'SUPPLYCHAIN', label: 'SUPPLYCHAIN — Supply Chain' },
];

const BQ_PROJECTS = [
  { value: 'prod-data-warehouse', label: 'prod-data-warehouse' },
  { value: 'analytics-prod', label: 'analytics-prod' },
  { value: 'staging-data-lake', label: 'staging-data-lake' },
  { value: 'dev-sandbox-01', label: 'dev-sandbox-01' },
  { value: 'marketing-insights', label: 'marketing-insights' },
  { value: 'finance-warehouse', label: 'finance-warehouse' },
  { value: 'retail-analytics', label: 'retail-analytics' },
];

// ── Component ─────────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);
  const setBqProjectInput = useAppStore((s) => s.setBqProjectInput);

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Jira Project + Story Number */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/70">
            Jira Project
          </Label>
          <Select
            value={jiraInput.project || '__none__'}
            onValueChange={(v) => setJiraInput({ project: v === '__none__' ? '' : v })}
          >
            <SelectTrigger className="h-9 text-sm border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus:ring-primary/20 focus:border-primary/30 transition-all duration-200">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent className="max-h-[220px]">
              {JIRA_PROJECTS.map((proj) => (
                <SelectItem key={proj.value} value={proj.value}>
                  <span className="font-semibold text-foreground">{proj.value}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{proj.label.split(' — ')[1]}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/70">
            Story No.
          </Label>
          <Input
            placeholder="e.g. 1234"
            value={jiraInput.storyNumber}
            onChange={(e) => setJiraInput({ storyNumber: e.target.value })}
            className="h-9 text-sm border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus-visible:border-primary/30 focus-visible:shadow-[0_1px_3px_0_oklch(0.55_0.15_264/0.08)] transition-all duration-200"
            aria-label="Jira story number"
          />
        </div>
      </div>

      {/* Row 2: BigQuery Project — Mandatory */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/70">
          <Database className="inline size-3 mr-1 text-[#4285F4]" />
          BigQuery Project
          <span className="text-red-500 ml-0.5">*</span>
        </Label>
        <Select
          value={bqProjectInput.projectId || '__none__'}
          onValueChange={(v) => setBqProjectInput({ projectId: v === '__none__' ? '' : v })}
        >
          <SelectTrigger className="h-9 text-sm border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus:ring-primary/20 focus:border-primary/30 transition-all duration-200">
            <SelectValue placeholder="Select BigQuery project *" />
          </SelectTrigger>
          <SelectContent className="max-h-[220px]">
            {BQ_PROJECTS.map((proj) => (
              <SelectItem key={proj.value} value={proj.value}>
                <span className="font-mono text-xs font-semibold text-foreground">{proj.value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
