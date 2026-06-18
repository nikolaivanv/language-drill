import * as React from 'react';
import { cn } from '../../lib/cn';

// Down-chevron in ink-mute (#8a8074), URL-encoded for use as a CSS background.
// We render our own (with `appearance-none`) so the native control's chevron
// doesn't double up with `field-sizing: content` — that pair makes the box hug
// the *selected* value (not the widest option), so the chevron sits a
// consistent distance from the text across every filter. Browsers without
// `field-sizing` (pre-Chrome 123 / Safari) fall back to widest-option sizing.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238a8074' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")";

/**
 * Bordered admin filter dropdown. Matches the height and border treatment of
 * the text inputs (`Input` / GrammarPointCombobox) so the filter row reads as a
 * single cohesive set of controls.
 */
export function FilterSelect({
  className,
  style,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'cursor-pointer appearance-none [field-sizing:content] min-w-[120px] rounded-md border border-rule bg-card py-[12px] pl-[14px] pr-9 text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]',
        className,
      )}
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        ...style,
      }}
      {...rest}
    />
  );
}
