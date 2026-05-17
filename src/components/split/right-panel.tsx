'use client';

import { TaskTypeSelector } from './task-type-selector';
import { InputSection } from './input-section';
import { ChatPanel } from './chat-panel';

export function RightPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 bg-background p-2.5">
      <section className="flex max-h-[58dvh] shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
        <div className="flex h-11 shrink-0 items-center justify-center border-b border-border/40 bg-muted/40">
          <TaskTypeSelector />
        </div>
        <div className="overflow-y-auto p-4 custom-scrollbar">
          <InputSection />
        </div>
      </section>

      <section className="min-h-[300px] flex-1 overflow-hidden flex flex-col rounded-xl border border-border/60 bg-background shadow-[0_2px_8px_0_oklch(0_0_0/0.04),0_1px_2px_0_oklch(0_0_0/0.03)]">
        <ChatPanel />
      </section>
    </div>
  );
}
