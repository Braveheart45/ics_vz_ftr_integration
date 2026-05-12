'use client';

import {
  Database,
  LayoutDashboard,
  GitBranch,
  PlusCircle,
  Activity,
  Settings,
  ChevronLeft,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/use-app-store';
import { WORKFLOW_STAGES, STAGE_COLORS, mockPipelineStats } from '@/lib/mock-data';
import type { WorkflowStage } from '@/lib/types';

// Navigation items
const navItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pipeline' as const, label: 'Pipeline', icon: GitBranch, showBadge: true },
  { id: 'new-job' as const, label: 'New Job', icon: PlusCircle },
  { id: 'activity' as const, label: 'Activity', icon: Activity },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  const { currentView, setCurrentView, jobs, stageFilter, setStageFilter } =
    useAppStore();

  const handleNavClick = (viewId: string) => {
    setCurrentView(viewId as typeof currentView);
  };

  const handleStageFilter = (stage: WorkflowStage) => {
    setStageFilter(stageFilter === stage ? 'all' : stage);
    setCurrentView('pipeline');
  };

  // Calculate job counts per stage from store jobs
  const stageCounts: Record<WorkflowStage, number> = {
    intake: jobs.filter((j) => j.currentStage === 'intake').length,
    requirement_analysis: jobs.filter((j) => j.currentStage === 'requirement_analysis').length,
    object_resolution: jobs.filter((j) => j.currentStage === 'object_resolution').length,
    schema_verification: jobs.filter((j) => j.currentStage === 'schema_verification').length,
    design_decisions: jobs.filter((j) => j.currentStage === 'design_decisions').length,
    sql_construction: jobs.filter((j) => j.currentStage === 'sql_construction').length,
    validation: jobs.filter((j) => j.currentStage === 'validation').length,
    delivery: jobs.filter((j) => j.currentStage === 'delivery').length,
  };

  return (
    <aside className="hidden md:flex w-[260px] flex-col border-r border-border bg-slate-50 h-screen">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-primary">
          <Database className="size-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            SQLForge
          </span>
          <span className="text-[10px] text-muted-foreground leading-none">
            v1.2.0
          </span>
        </div>
      </div>

      <Separator />

      {/* ── Navigation ──────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-3 pt-4 pb-2">
          <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Workspace
          </p>
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const isActive = currentView === item.id;
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  className={`
                    relative h-9 w-full justify-start gap-2.5 px-2 text-sm font-normal rounded-md
                    transition-colors
                    ${isActive
                      ? 'bg-white shadow-sm text-foreground font-medium border-l-2 border-l-primary pl-[6px]'
                      : 'text-muted-foreground hover:text-foreground hover:bg-slate-100'
                    }
                  `}
                  onClick={() => handleNavClick(item.id)}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.showBadge && (
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-[20px] px-1.5 text-[10px] font-semibold"
                    >
                      {mockPipelineStats.totalJobs}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </nav>
        </div>

        <Separator className="mx-3" />

        {/* ── Pipeline Status ─────────────────────────── */}
        <div className="px-3 pt-3 pb-4">
          <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Pipeline Status
          </p>
          <div className="flex flex-col gap-0.5">
            {WORKFLOW_STAGES.map((stage) => {
              const count = stageCounts[stage.id];
              const isActive = stageFilter === stage.id;
              return (
                <button
                  key={stage.id}
                  onClick={() => handleStageFilter(stage.id)}
                  className={`
                    relative flex items-center gap-2.5 h-8 px-2 rounded-md text-left text-sm
                    transition-colors cursor-pointer
                    ${isActive
                      ? 'bg-white shadow-sm'
                      : 'hover:bg-slate-100'
                    }
                  `}
                >
                  {/* Color indicator dot */}
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: STAGE_COLORS[stage.id] }}
                  />
                  {/* Stage label */}
                  <span
                    className={`flex-1 truncate text-xs ${
                      isActive
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {stage.label}
                  </span>
                  {/* Count badge */}
                  {count > 0 && (
                    <span
                      className={`
                        text-[11px] font-semibold tabular-nums min-w-[18px] text-right
                        ${isActive ? 'text-foreground' : 'text-muted-foreground'}
                      `}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      <Separator />

      {/* ── Footer ──────────────────────────────────── */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 px-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-muted-foreground flex-1">
            Agent Online
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => setCurrentView('settings')}
          >
            <Settings className="size-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
