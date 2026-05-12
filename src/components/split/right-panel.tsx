'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { TaskTypeSelector } from './task-type-selector';
import { InputSection } from './input-section';
import { ChatPanel } from './chat-panel';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── Component ─────────────────────────────────────────────────
export function RightPanel() {
  const [inputExpanded, setInputExpanded] = useState(true);

  const toggleInput = useCallback(() => {
    setInputExpanded((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Section 1: Task Type Selector */}
      <div className="shrink-0 border-b">
        <TaskTypeSelector />
      </div>

      {/* Section 2: Input Section (collapsible) */}
      <div className="shrink-0 border-b">
        {/* Collapse toggle header */}
        <button
          type="button"
          onClick={toggleInput}
          className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={inputExpanded}
        >
          <span>Input Configuration</span>
          {inputExpanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>

        {/* Collapsible content */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-200 ease-in-out',
            inputExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="px-3 pb-3">
            <InputSection />
          </div>
        </div>
      </div>

      {/* Section 3: Chat Panel (flex-1) */}
      <ChatPanel />
    </div>
  );
}
