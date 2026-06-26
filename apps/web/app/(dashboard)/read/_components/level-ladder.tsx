'use client';

// ---------------------------------------------------------------------------
// LevelLadder — horizontal CEFR level bar with "your level" marker
// ---------------------------------------------------------------------------
// Props: value, yourLevel, onChange, disabled
// Renders A1 → C2 as a segmented horizontal bar.
// Selected → bg-ink text-paper rounded-pill.
// The cell matching `yourLevel` gets:
//   • data-your-level="true" (test hook)
//   • a bottom border in accent color to indicate the user's tracked level
// Below the bar: "• matched to your level" caption (only when yourLevel set).
// Header row: "LEVEL" left, "CEFR" right.
// ---------------------------------------------------------------------------

import { CefrLevel } from '@language-drill/shared';
import { cn } from '../../../../lib/cn';

type Props = {
  value: CefrLevel;
  yourLevel: CefrLevel | null;
  onChange: (c: CefrLevel) => void;
  disabled?: boolean;
};

const CEFR_ORDER = Object.values(CefrLevel) as CefrLevel[];

export function LevelLadder({ value, yourLevel, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-[6px]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="t-micro">LEVEL</span>
        <span className="t-micro text-ink-mute">CEFR</span>
      </div>

      {/* Segmented bar */}
      <div className="flex overflow-hidden rounded-pill bg-paper-2">
        {CEFR_ORDER.map((level) => {
          const isSelected = value === level;
          const isYourLevel = yourLevel === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={isSelected}
              data-your-level={isYourLevel ? 'true' : undefined}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(level);
              }}
              className={cn(
                'flex flex-1 items-center justify-center py-[8px] text-[12px] font-medium transition-colors',
                isSelected
                  ? 'rounded-pill bg-ink text-paper'
                  : 'text-ink hover:bg-paper-3',
                isYourLevel && !isSelected && 'border-b-2 border-accent',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {level}
            </button>
          );
        })}
      </div>

      {/* "matched to your level" caption */}
      {yourLevel != null && (
        <p className="t-micro flex items-center gap-[4px]">
          <span className="text-accent">•</span>
          <span>matched to your level</span>
        </p>
      )}
    </div>
  );
}
