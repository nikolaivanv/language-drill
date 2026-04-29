import * as React from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  /**
   * IDs of the elements that label this checkbox. Forwarded to
   * `aria-labelledby` on the underlying `<button role="checkbox">` so screen
   * readers announce the visible label text — the wrapping `<label>` element
   * does not auto-associate for non-native controls.
   */
  'aria-labelledby'?: string;
  /** Inline accessible name. Use `aria-labelledby` instead when the label is
   * already in the DOM. */
  'aria-label'?: string;
}

export function Checkbox({
  checked,
  onChange,
  className,
  'aria-labelledby': ariaLabelledBy,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center justify-center min-w-[32px] min-h-[32px] cursor-pointer',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-ink transition-colors duration-150',
          checked ? 'bg-ink text-paper' : 'bg-transparent'
        )}
      >
        {checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.5 6l2.5 2.5L9.5 3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
