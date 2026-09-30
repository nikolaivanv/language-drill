'use client';

import { cn } from '../../lib/cn';
import type { ThemeChoice } from '../../lib/theme/theme';
import { useTheme } from '../theme/theme-provider';

/**
 * Compact theme control for the public chrome.
 *
 * The account menu's `ThemeToggle` is a labelled three-column radiogroup built
 * for a dropdown panel — too heavy for a page header, and a signed-out visitor
 * has no account menu to open. This is the same three choices in one button:
 * it shows the current one and advances on click.
 *
 * Three states rather than a light/dark switch so a visitor who overrides the
 * theme can still hand control back to their OS. `THEME_INIT_SCRIPT` in the
 * root layout already honours the system setting before first paint, so an
 * untouched page is correct without this button being pressed.
 */

const ORDER: readonly ThemeChoice[] = ['light', 'dark', 'system'];

const COPY: Record<ThemeChoice, { now: string; next: string }> = {
  light: { now: 'Light theme', next: 'Switch to dark theme' },
  dark: { now: 'Dark theme', next: 'Match your system theme' },
  system: { now: 'Matching your system theme', next: 'Switch to light theme' },
};

function Icon({ choice }: { choice: ThemeChoice }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'h-[15px] w-[15px]',
  };
  if (choice === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M19.4 4.6l-1.7 1.7M6.3 17.7l-1.7 1.7" />
      </svg>
    );
  }
  if (choice === 'dark') {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8.5 20h7M12 17v3" />
    </svg>
  );
}

export function ThemeCycleButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const copy = COPY[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={copy.now}
      title={copy.next}
      className={cn(
        'inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-rule text-ink-soft transition-colors duration-150',
        'hover:border-rule-strong hover:text-ink',
        'outline-none focus-visible:shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]',
        className,
      )}
    >
      <Icon choice={theme} />
    </button>
  );
}
