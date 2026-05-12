'use client';

import { useAppStore } from '@/stores/use-app-store';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { NewJobView } from '@/components/jobs/new-job-view';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { PipelineView } from '@/components/pipeline/pipeline-view';
import { ActivityView } from '@/components/activity/activity-view';
import { SettingsView } from '@/components/settings/settings-view';

export default function Home() {
  const currentView = useAppStore((s) => s.currentView);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <AppHeader />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {currentView === 'dashboard' && <DashboardView />}
          {currentView === 'pipeline' && <PipelineView />}
          {currentView === 'new-job' && <NewJobView />}
          {currentView === 'job-detail' && <JobDetailView />}
          {currentView === 'activity' && <ActivityView />}
          {currentView === 'settings' && <SettingsView />}
        </main>

        {/* Footer */}
        <footer className="border-t bg-muted/30 px-6 py-3 mt-auto">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>SQLForge v1.2.0 — AI-Powered SQL Generation & Conversion Agent</span>
            <span>Data Engineering Automation Platform</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
