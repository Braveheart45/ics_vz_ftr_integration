'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, MessageSquare } from 'lucide-react';
import { TaskTypeSelector } from './task-type-selector';
import { InputSection } from './input-section';
import { ChatPanel } from './chat-panel';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

export function RightPanel() {
  const [inputMaximized, setInputMaximized] = useState(false);
  const [chatMaximized, setChatMaximized] = useState(false);

  const closeAll = useCallback(() => {
    setInputMaximized(false);
    setChatMaximized(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAll]);

  const inputSection = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border/40 bg-muted/40 px-3">
        <div className="min-w-0 overflow-hidden">
          <TaskTypeSelector />
        </div>
        <button
          onClick={() => setInputMaximized((v) => !v)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={inputMaximized ? 'Restore (Esc)' : 'Maximize'}
        >
          {inputMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>
      <div className="overflow-y-auto p-4 custom-scrollbar flex-1">
        <InputSection />
      </div>
    </div>
  );

  const chatSection = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border/40 bg-muted/40 px-3">
        <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-[#4285F4] px-2.5 py-1 text-xs font-semibold text-white shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
          <MessageSquare className="size-3 text-white/80" />
          <span className="truncate">Clarification Panel</span>
        </div>
        <button
          onClick={() => setChatMaximized((v) => !v)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={chatMaximized ? 'Restore (Esc)' : 'Maximize'}
        >
          {chatMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-2.5">
      {/* Maximized overlays */}
      {inputMaximized && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 overflow-hidden bg-background">{inputSection}</div>,
        document.body,
      )}
      {chatMaximized && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 overflow-hidden bg-background">{chatSection}</div>,
        document.body,
      )}

      {/* Normal layout — vertical resizable split */}
      <ResizablePanelGroup
        direction="vertical"
        autoSaveId="sql-curator-right-panel"
        className="h-full"
      >
        <ResizablePanel defaultSize={55} minSize={25}>
          <div className="h-full min-h-0 pb-1.5">
            {inputSection}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={45} minSize={25}>
          <div className="h-full min-h-0 pt-1.5">
            {chatSection}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
