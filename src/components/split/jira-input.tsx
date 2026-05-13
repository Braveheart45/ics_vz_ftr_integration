'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Database, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────
interface JiraProject {
  key: string;
  name: string;
}

// ── Component ─────────────────────────────────────────────
export function JiraInput() {
  const jiraInput = useAppStore((s) => s.jiraInput);
  const setJiraInput = useAppStore((s) => s.setJiraInput);
  const bqProjectInput = useAppStore((s) => s.bqProjectInput);
  const setBqProjectInput = useAppStore((s) => s.setBqProjectInput);

  // ── Jira Projects State ──
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const jiraFetched = useRef(false);

  // ── BQ Projects State ──
  const [bqProjects, setBqProjects] = useState<string[]>([]);
  const [bqLoading, setBqLoading] = useState(false);
  const [bqError, setBqError] = useState<string | null>(null);
  const bqFetched = useRef(false);

  // ── Fetch Jira Projects ──
  const fetchJiraProjects = useCallback(async () => {
    setJiraLoading(true);
    setJiraError(null);
    try {
      const res = await fetch('/api/projects/jira');
      const data = await res.json();
      if (data.projects && data.projects.length > 0) {
        setJiraProjects(data.projects);
      } else {
        setJiraProjects([]);
        if (data.error) setJiraError(data.error);
      }
    } catch {
      setJiraError('Claude Bridge not reachable');
      setJiraProjects([]);
    } finally {
      setJiraLoading(false);
      jiraFetched.current = true;
    }
  }, []);

  // ── Fetch BQ Projects ──
  const fetchBqProjects = useCallback(async () => {
    setBqLoading(true);
    setBqError(null);
    try {
      const res = await fetch('/api/projects/bq');
      const data = await res.json();
      if (data.projects && data.projects.length > 0) {
        setBqProjects(data.projects);
      } else {
        setBqProjects([]);
        if (data.error) setBqError(data.error);
      }
    } catch {
      setBqError('Claude Bridge not reachable');
      setBqProjects([]);
    } finally {
      setBqLoading(false);
      bqFetched.current = true;
    }
  }, []);

  // ── Auto-fetch on mount ──
  useEffect(() => {
    fetchJiraProjects();
    fetchBqProjects();
  }, [fetchJiraProjects, fetchBqProjects]);

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Jira Project + Story Number */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/70">
              Jira Project
            </Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-muted-foreground/50 hover:text-foreground/70"
              onClick={fetchJiraProjects}
              disabled={jiraLoading}
            >
              <RefreshCw className={cn('size-2.5', jiraLoading && 'animate-spin')} />
            </Button>
          </div>
          <Select
            value={jiraInput.project || '__none__'}
            onValueChange={(v) => setJiraInput({ project: v === '__none__' ? '' : v })}
            disabled={jiraLoading}
          >
            <SelectTrigger className={cn(
              'h-9 text-sm border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus:ring-primary/20 focus:border-primary/30 transition-all duration-200',
              jiraError && 'border-amber-400/50'
            )}>
              {jiraLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  <span>Fetching from Jira...</span>
                </span>
              ) : (
                <SelectValue placeholder={jiraError ? 'Connection error' : 'Select project'} />
              )}
            </SelectTrigger>
            <SelectContent className="max-h-[220px]">
              {jiraError && (
                <div className="px-2 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50/50">
                  <AlertCircle className="size-3 shrink-0" />
                  <span className="truncate">{jiraError}</span>
                </div>
              )}
              {jiraProjects.map((proj) => (
                <SelectItem key={proj.key} value={proj.key}>
                  <span className="font-semibold text-foreground">{proj.key}</span>
                  {proj.name !== proj.key && (
                    <span className="ml-2 text-muted-foreground text-xs">{proj.name}</span>
                  )}
                </SelectItem>
              ))}
              {jiraProjects.length === 0 && !jiraError && jiraFetched.current && (
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground text-center">
                  No Jira projects found
                </div>
              )}
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

      {/* Row 2: BigQuery Project — Mandatory (label + dropdown inline) */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 shrink-0">
          <Label className="text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/70">
            <Database className="inline size-3 mr-1 text-[#4285F4]" />
            BigQuery Project
            <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground/50 hover:text-foreground/70"
            onClick={fetchBqProjects}
            disabled={bqLoading}
          >
            <RefreshCw className={cn('size-2.5', bqLoading && 'animate-spin')} />
          </Button>
        </div>
        <Select
          value={bqProjectInput.projectId || '__none__'}
          onValueChange={(v) => setBqProjectInput({ projectId: v === '__none__' ? '' : v })}
          disabled={bqLoading}
        >
          <SelectTrigger className={cn(
            'h-9 text-sm flex-1 border-border bg-background shadow-[0_1px_2px_0_oklch(0_0_0/0.03)] focus:ring-primary/20 focus:border-primary/30 transition-all duration-200',
            bqError && 'border-amber-400/50'
          )}>
            {bqLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                <span>Fetching from BigQuery...</span>
              </span>
            ) : (
              <SelectValue placeholder={bqError ? 'Connection error' : 'Select BigQuery project *'} />
            )}
          </SelectTrigger>
          <SelectContent className="max-h-[220px]">
            {bqError && (
              <div className="px-2 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50/50">
                <AlertCircle className="size-3 shrink-0" />
                <span className="truncate">{bqError}</span>
              </div>
            )}
            {bqProjects.map((proj) => (
              <SelectItem key={proj} value={proj}>
                <span className="font-mono text-xs font-semibold text-foreground">{proj}</span>
              </SelectItem>
            ))}
            {bqProjects.length === 0 && !bqError && bqFetched.current && (
              <div className="px-2 py-1.5 text-[10px] text-muted-foreground text-center">
                No BigQuery projects found
              </div>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
