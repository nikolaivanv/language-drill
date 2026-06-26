'use client';

// ---------------------------------------------------------------------------
// DailyLoadControl — compact segmented control for "today's load" (daily goal
// preference). Pure presentational: no hooks, no side effects.
// Props: current (selected value or null), onSelect (callback), disabled.
// Renders a radiogroup with one option per DAILY_GOALS value (quick/medium/long).
// ---------------------------------------------------------------------------

import { DAILY_GOALS, type DailyGoal } from '@language-drill/shared';
import { cn } from '../../../lib/cn';

export type DailyLoadControlProps = {
  current: DailyGoal | null;
  onSelect: (g: DailyGoal) => void;
  disabled?: boolean;
};

export function DailyLoadControl({ current, onSelect, disabled = false }: DailyLoadControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-s-4 gap-y-s-2">
      <span className="t-micro text-ink-mute whitespace-nowrap">today's load</span>
      <div
        role="radiogroup"
        aria-label="today's load"
        aria-disabled={disabled}
        className={cn(
          'inline-flex gap-1 rounded-pill bg-paper-3 p-[5px]',
          disabled && 'opacity-60 pointer-events-none'
        )}
      >
        {DAILY_GOALS.map((g) => {
          const selected = current === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => !disabled && onSelect(g)}
              className={cn(
                'min-w-[88px] justify-center rounded-pill px-s-5 py-[10px] text-[15px] font-semibold transition-all duration-150',
                selected
                  // The selected pill sits on the theme-invariant yellow
                  // (--color-hilite), so its label must stay dark in both
                  // themes — `text-ink` flips to cream in dark and would wash
                  // out on yellow. Pin the prototype's near-black ink.
                  ? 'bg-hilite text-[#1a1612] shadow-1'
                  : 'bg-transparent text-ink-soft hover:text-ink'
              )}
            >
              {g}
            </button>
          );
        })}
      </div>
    </div>
  );
}
