'use client';

// ---------------------------------------------------------------------------
// IntensityToggle — keyboard-accessible "subtle / assertive" pill switch
// ---------------------------------------------------------------------------
// WAI-ARIA radiogroup with two radio children (Requirement 14.1). Roving
// tabindex: the active option owns tab focus; arrow keys cycle and auto-
// select. Enter / Space on a focused option re-affirms it (no-op when focus
// and selection are in sync, but covers cases where the host page programs
// focus separately from the selection).
// ---------------------------------------------------------------------------

import * as React from 'react';
import { cn } from '../../../../lib/cn';
import type { Intensity } from '../_state/read-page-reducer';

type Props = {
  value: Intensity;
  onChange: (v: Intensity) => void;
};

const OPTIONS: readonly Intensity[] = ['subtle', 'assertive'] as const;

function nextIndex(i: number, dir: 1 | -1): number {
  return (i + dir + OPTIONS.length) % OPTIONS.length;
}

export function IntensityToggle({ value, onChange }: Props) {
  const refs = React.useRef<Record<Intensity, HTMLButtonElement | null>>({
    subtle: null,
    assertive: null,
  });

  const move = (dir: 1 | -1) => {
    const target = OPTIONS[nextIndex(OPTIONS.indexOf(value), dir)];
    refs.current[target]?.focus();
    onChange(target);
  };

  const onKeyDown =
    (option: Intensity) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onChange(option);
      }
    };

  return (
    <div
      role="radiogroup"
      aria-label="highlight intensity"
      className="flex items-center rounded-full border border-rule bg-card p-[2px]"
    >
      {OPTIONS.map((option) => {
        const checked = option === value;
        return (
          <button
            key={option}
            ref={(el) => {
              refs.current[option] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={onKeyDown(option)}
            className={cn(
              // NB: no `t-small` here — that class hard-sets color:ink-soft and
              // (being unlayered) beats the `text-paper` utility, which left the
              // selected pill with low-contrast muted text on the ink fill.
              'rounded-full px-[12px] py-[4px] text-[11px] font-medium transition-colors',
              checked
                ? 'bg-ink text-paper hover:bg-ink-hover'
                : 'bg-transparent text-ink-soft hover:text-ink',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
