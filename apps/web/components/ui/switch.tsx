import * as React from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Switch({
  checked,
  onChange,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-pill transition-colors duration-150',
        // Hover deepens the track: off → ink-mute, on → a slight shift of the
        // ink fill (matches the prototype's switch hover treatment).
        checked ? 'bg-ink hover:bg-ink-2' : 'bg-rule-strong hover:bg-ink-mute',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full shadow-1 transition-transform duration-150',
          // White knob reads on the ink fill in light mode; in dark the ink
          // token flips to cream, so the on-knob darkens to paper for contrast.
          checked ? 'bg-white dark:bg-paper' : 'bg-white',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
