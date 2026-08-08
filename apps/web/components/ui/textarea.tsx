import * as React from 'react';
import { cn } from '../../lib/cn';

/** `answer` is reserved for the learner's own target-language sentence — see
 *  `.t-answer` in globals.css. Everything else (flag-a-problem notes, the read
 *  paste/generate boxes, onboarding free-text) is UI chrome and stays sans. */
export type TextareaVariant = 'default' | 'answer';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  className?: string;
  variant?: TextareaVariant;
};

const base =
  'w-full border border-rule rounded-md bg-card text-ink resize-none outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_var(--ring-app)]';

/* Type and padding live per-variant rather than in `base` + an override,
   because `cn()` has no tailwind-merge — two competing font-size utilities
   would be resolved by stylesheet order, not by which one was passed last. */
const VARIANT: Record<TextareaVariant, string> = {
  default: 'p-[14px] text-[14px] leading-[1.6]',
  answer: 'px-[16px] py-[14px] t-answer',
};

/* The answer variant defaults to one row fewer: its lines are ~1.7x taller, so
   4 rows of display serif would leave the box mostly empty for a one-sentence
   response. Callers can still pass `rows` explicitly. */
const DEFAULT_ROWS: Record<TextareaVariant, number> = {
  default: 4,
  answer: 3,
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, variant = 'default', rows, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(base, VARIANT[variant], className)}
        rows={rows ?? DEFAULT_ROWS[variant]}
        {...rest}
      />
    );
  }
);
