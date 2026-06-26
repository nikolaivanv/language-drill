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
        // Track colours + hover. Off: a visible rule track that deepens to
        // ink-mute on hover. On: the ink fill (lightens slightly on hover); in
        // dark mode `bg-ink` is cream with poor contrast against the white knob,
        // so the on-state uses the terracotta accent there (darker on hover),
        // matching the app's dark-CTA treatment.
        checked
          ? 'bg-ink hover:bg-ink-2 dark:bg-accent dark:hover:bg-[#b15535]'
          : 'bg-rule-strong hover:bg-ink-mute',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // White knob reads on both the ink (light) and terracotta (dark) fills.
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-1 transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
