'use client';

import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/use-app-store';

interface ViewMeta {
  title: string;
  badge?: string;
}

function getViewMeta(view: string, selectedJobTitle?: string | null): ViewMeta {
  switch (view) {
    case 'dashboard':
      return { title: 'Command Center', badge: 'DASHBOARD' };
    case 'pipeline':
      return { title: 'Pipeline', badge: 'WORKFLOW' };
    case 'job-detail':
      return { title: selectedJobTitle ?? 'Job Details' };
    case 'new-job':
      return { title: 'New Job', badge: 'CREATE' };
    case 'activity':
      return { title: 'Activity', badge: 'FEED' };
    case 'settings':
      return { title: 'Settings', badge: 'CONFIG' };
    default:
      return { title: 'SQLForge' };
  }
}

export function AppHeader() {
  const { currentView, goBack, selectedJobId, jobs } = useAppStore();

  const selectedJob = selectedJobId
    ? jobs.find((j) => j.id === selectedJobId)
    : null;

  const { title, badge } = getViewMeta(currentView, selectedJob?.title);
  const showBack = currentView !== 'dashboard';

  return (
    <header className="flex items-center h-14 px-4 border-b border-border bg-background">
      {/* Left: Back button */}
      <div className="flex items-center gap-2 min-w-0">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={goBack}
            aria-label="Go back"
          >
            <ChevronLeft className="size-4" />
          </Button>
        )}
        <div className="flex items-center gap-2.5 min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate">
            {title}
          </h1>
          {badge && (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold tracking-wide px-1.5 py-0 shrink-0"
            >
              {badge}
            </Badge>
          )}
        </div>
      </div>

      {/* Right: Avatar */}
      <div className="ml-auto flex items-center gap-3">
        <div
          className="flex items-center justify-center size-8 rounded-full bg-slate-900 text-white text-xs font-bold shrink-0"
          aria-label="Data Engineer avatar"
        >
          DE
        </div>
      </div>
    </header>
  );
}
