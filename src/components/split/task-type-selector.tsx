'use client';

import { Sparkles } from 'lucide-react';

// SQL generation is the only supported mode — conversion is out of scope.
export function TaskTypeSelector() {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-[#4285F4] px-2.5 py-1 text-xs font-semibold text-white shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]">
      <Sparkles className="size-3 text-white/80" />
      <span>Intake</span>
    </div>
  );
}
