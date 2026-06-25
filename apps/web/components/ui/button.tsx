import * as React from 'react';
import Link from 'next/link';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'chip';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  href?: string;
}

const shared =
  'inline-flex items-center justify-center gap-[6px] font-medium whitespace-nowrap transition-all duration-150';

const variantClasses: Record<ButtonVariant, string> = {
  // Primary CTA — ink fill, lightens on hover (never terracotta). Desktop shadow lift.
  primary:
    'border border-ink bg-ink text-paper hover:bg-ink-hover hover:border-ink-hover hover:shadow-2',
  // Secondary — bordered transparent, no fill. The single ghost/secondary style.
  ghost:
    'border border-rule-strong bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink',
  // `default` is an alias of the secondary ghost so only two button styles ship.
  default:
    'border border-rule-strong bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink',
  // Bordered pill control on paper/card — the sole intended bg-card exception.
  chip: 'border border-rule bg-card text-ink hover:border-ink hover:bg-paper-2',
};

// `mobile:` floors give every button a ≥44px square tap target at ≤760px
// (Req 11.1) — the min-width also pads icon-only buttons into a ≥44px hit box.
// Desktop sizes are unchanged (the floors sit below the natural md/lg heights
// and only raise the sm/icon cases on touch).
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-s-3 py-[6px] text-[12px] rounded-r-sm min-h-[32px] mobile:min-h-[44px] mobile:min-w-[44px]',
  md: 'px-[18px] py-[10px] text-[13px] rounded-r-md mobile:min-h-[44px] mobile:min-w-[44px]',
  lg: 'px-s-6 py-[14px] text-[15px] rounded-r-md mobile:min-h-[44px] mobile:min-w-[44px]',
};

const disabledClasses =
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function isInternalHref(href: string): boolean {
  return href.startsWith('/') || href.startsWith('#');
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'default',
      size = 'md',
      loading = false,
      href,
      disabled,
      className,
      children,
      ...rest
    },
    ref
  ) {
    const classes = cn(
      shared,
      variantClasses[variant],
      sizeClasses[size],
      disabledClasses,
      loading && 'pointer-events-none',
      className
    );

    const content = loading ? <Spinner /> : children;

    // Link rendering
    if (href) {
      if (isInternalHref(href)) {
        return (
          <Link
            href={href}
            className={classes}
            aria-disabled={disabled || undefined}
            aria-busy={loading || undefined}
          >
            {content}
          </Link>
        );
      }

      return (
        <a
          href={href}
          className={classes}
          aria-disabled={disabled || undefined}
          aria-busy={loading || undefined}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        {...rest}
      >
        {content}
      </button>
    );
  }
);
