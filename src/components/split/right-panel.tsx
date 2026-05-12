'use client';

import { TaskTypeSelector } from './task-type-selector';
import { InputSection } from './input-section';
import { ChatPanel } from './chat-panel';

// ── Component ─────────────────────────────────────────────────
export function RightPanel() {
  return (
    <div className="flex h-full flex-col">
      {/* Task Type Selector */}
      <TaskTypeSelector />

      {/* Input Section */}
      <div className="border-b px-4 py-3">
        <InputSection />
      </div>

      {/* Chat Panel (fills remaining space) */}
      <ChatPanel />
    </div>
  );
}
