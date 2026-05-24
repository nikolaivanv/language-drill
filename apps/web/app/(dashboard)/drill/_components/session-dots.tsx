'use client';

import { cn } from '../../../../lib/cn';

export interface SessionDotsProps {
  /** 1-based position of the current item. */
  current: number;
  total: number;
}

// Horizontal, scrollable session-position indicator shown above the prompt on
// mobile. Past items show a check, the current item is filled ink, future
// items are muted.
export function SessionDots({ current, total }: SessionDotsProps) {
  return (
    <ol
      aria-label={`item ${current} of ${total}`}
      // `overflow-x-auto` makes the browser compute `overflow-y` to `auto` too,
      // which clips the current item's 2px `ring`. The `p-s-1` padding (4px)
      // gives the ring room so it isn't cropped at the row's edges.
      className="m-0 flex list-none items-center gap-s-2 overflow-x-auto p-s-1"
    >
      {Array.from({ length: total }, (_, i) => {
        const position = i + 1;
        const isPast = position < current;
        const isCurrent = position === current;
        return (
          <li
            key={i}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px]',
              isPast && 'bg-ink text-paper',
              isCurrent && 'bg-ink text-paper ring-2 ring-accent',
              !isPast && !isCurrent && 'bg-paper-3 text-ink-mute',
            )}
          >
            {isPast ? '✓' : position}
          </li>
        );
      })}
    </ol>
  );
}
