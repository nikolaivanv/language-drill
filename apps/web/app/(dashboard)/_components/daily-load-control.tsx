'use client';

// ---------------------------------------------------------------------------
// DailyLoadControl — compact segmented control for "today's load" (daily goal
// preference). Pure presentational: no hooks, no side effects.
// Props: current (selected value or null), onSelect (callback), disabled.
// Renders a radiogroup with one option per DAILY_GOALS value (quick/medium/long).
// ---------------------------------------------------------------------------

import { DAILY_GOALS, type DailyGoal } from '@language-drill/shared';
import { cn } from '../../../lib/cn';
import { Choice } from '../../../components/ui/choice';

export type DailyLoadControlProps = {
  current: DailyGoal | null;
  onSelect: (g: DailyGoal) => void;
  disabled?: boolean;
};

export function DailyLoadControl({
  current,
  onSelect,
  disabled = false,
}: DailyLoadControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-s-4 gap-y-s-2">
      <span className="t-micro text-ink-mute whitespace-nowrap">today's load</span>
      <div
        role="radiogroup"
        aria-label="today's load"
        aria-disabled={disabled}
        className={cn('flex flex-wrap gap-[6px]', disabled && 'opacity-60 pointer-events-none')}
      >
        {DAILY_GOALS.map((g) => (
          <Choice
            key={g}
            mode="radio"
            selected={current === g}
            onSelect={() => !disabled && onSelect(g)}
            className="px-s-3 py-[6px] text-sm min-w-[54px] justify-center"
          >
            <span className="t-label whitespace-nowrap">{g}</span>
          </Choice>
        ))}
      </div>
    </div>
  );
}
