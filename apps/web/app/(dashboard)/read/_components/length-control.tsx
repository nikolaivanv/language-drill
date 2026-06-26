'use client';

// ---------------------------------------------------------------------------
// LengthControl — segmented 3-card length picker
// ---------------------------------------------------------------------------
// Props: value, onChange, disabled
// Renders SHORT / MEDIUM / LONG as a 3-column grid of buttons.
// Each button shows the length name + approx word count.
// Selected → bg-ink text-paper.
// ---------------------------------------------------------------------------

import { ReadingTextLength, READING_LENGTH_APPROX } from '@language-drill/shared';
import { cn } from '../../../../lib/cn';

type Props = {
  value: ReadingTextLength;
  onChange: (l: ReadingTextLength) => void;
  disabled?: boolean;
};

const LENGTH_ORDER = [
  ReadingTextLength.SHORT,
  ReadingTextLength.MEDIUM,
  ReadingTextLength.LONG,
] as const;

export function LengthControl({ value, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-3 gap-[10px] mobile:grid-cols-1">
      {LENGTH_ORDER.map((length) => {
        const isSelected = value === length;
        return (
          <button
            key={length}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(length);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-[4px] rounded-md border p-[12px] transition-colors',
              isSelected
                ? 'border-ink bg-ink text-paper'
                : 'border-rule bg-card text-ink hover:bg-paper-2',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {/* `.t-body` hard-codes `color: var(--color-ink-2)` as an unlayered
                rule, which outranks the `text-paper` utility on the button. On
                the selected (ink-filled) card that left dark text on a near-black
                fill, so force the paper colour inline when selected. */}
            <span
              className="t-body font-serif capitalize"
              style={isSelected ? { color: 'var(--color-paper)' } : undefined}
            >
              {length}
            </span>
            <span className={cn('t-mono text-[11px]', isSelected ? 'text-paper/70' : 'text-ink-mute')}>
              ≈ {READING_LENGTH_APPROX[length]} words
            </span>
          </button>
        );
      })}
    </div>
  );
}
