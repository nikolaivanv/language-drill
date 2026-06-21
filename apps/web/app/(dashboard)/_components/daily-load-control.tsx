'use client';

// ---------------------------------------------------------------------------
// DailyLoadControl — compact segmented control for "today's load" (daily
// minutes preference). Pure presentational: no hooks, no side effects.
// Props: current (selected value or null), onSelect (callback), disabled.
// Renders a radiogroup with one option per DAILY_MINUTES value (5/10/20/30).
// ---------------------------------------------------------------------------

import { DAILY_MINUTES, type DailyMinutes } from '@language-drill/shared';
import { Choice } from '../../../components/ui/choice';

export type DailyLoadControlProps = {
  current: number | null;
  onSelect: (m: DailyMinutes) => void;
  disabled?: boolean;
};

export function DailyLoadControl({
  current,
  onSelect,
  disabled = false,
}: DailyLoadControlProps) {
  return (
    <div className="flex items-center gap-s-4">
      <span className="t-micro text-ink-mute whitespace-nowrap">today's load</span>
      <div
        role="radiogroup"
        aria-label="today's load"
        className="flex gap-[6px]"
      >
        {DAILY_MINUTES.map((m) => (
          <Choice
            key={m}
            mode="radio"
            selected={current === m}
            onSelect={() => !disabled && onSelect(m)}
            className="px-s-3 py-[6px] text-sm min-w-[54px] justify-center"
          >
            <span className="t-label whitespace-nowrap">{m} min</span>
          </Choice>
        ))}
      </div>
    </div>
  );
}
