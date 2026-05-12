'use client';

import { TaskTypeSelector } from './task-type-selector';
import { InputSection } from './input-section';
import { ChatPanel } from './chat-panel';

// ── Component ─────────────────────────────────────────────────
export function RightPanel() {
  return (
    <div className="flex h-full flex-col bg-secondary/20">
      {/* Task Type Selector */}
      <TaskTypeSelector />

      {/* Input Section */}
      <div className="border-b border-border/50 px-4 py-4">
        <InputSection />
      </div>

      {/* Chat Panel */}
      <ChatPanel />
    </div>
  );
}
