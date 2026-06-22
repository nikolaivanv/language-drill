import * as React from 'react';
import { cn } from '../../lib/cn';

export type ChoiceMode = 'radio' | 'checkbox';

export interface ChoiceProps {
  selected: boolean;
  onSelect: () => void;
  mode?: ChoiceMode;
  children: React.ReactNode;
  className?: string;
  /**
   * Hide the leading radio/checkbox dot and let the content fill the tile.
   * Selection is then conveyed purely by the highlighted border/background
   * (and `aria-checked`), which gives short word labels the full tile width
   * — used by the daily-target quick/medium/long picker so "medium" doesn't
   * get squeezed past the tile edge.
   */
  hideIndicator?: boolean;
}

// `mobile:min-h-[48px]` gives choice cards a ≥48px tap target at ≤760px
// (Req 11.1); `items-center` keeps the content vertically centred in the taller
// box. Desktop height (driven by padding) is unchanged.
const shared =
  'flex items-center gap-[10px] px-s-4 py-s-3 rounded-r-md cursor-pointer transition-all duration-150 text-left w-full mobile:min-h-[48px]';

function RadioIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-full border-[1.5px] flex-shrink-0',
        selected ? 'border-ink' : 'border-rule'
      )}
    >
      {selected && <span className="w-2 h-2 rounded-full bg-ink" />}
    </span>
  );
}

function CheckboxIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-[3px] border-[1.5px] flex-shrink-0',
        selected ? 'border-ink bg-ink text-paper' : 'border-rule bg-transparent'
      )}
    >
      {selected && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2 5l2 2 4-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export function Choice({
  selected,
  onSelect,
  mode = 'radio',
  children,
  className,
  hideIndicator = false,
}: ChoiceProps) {
  const stateClasses = selected
    ? 'border-ink bg-hilite-soft'
    : 'border-rule bg-card hover:border-ink hover:bg-paper-2';

  return (
    <button
      type="button"
      role={mode}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(shared, 'border', stateClasses, className)}
    >
      {!hideIndicator &&
        (mode === 'radio' ? (
          <RadioIndicator selected={selected} />
        ) : (
          <CheckboxIndicator selected={selected} />
        ))}
      <span className="flex-1 min-w-0">{children}</span>
    </button>
  );
}
