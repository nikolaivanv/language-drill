'use client';

import { cn } from '../../lib/cn';
import type { ThemeChoice } from '../../lib/theme/theme';
import { useTheme } from './theme-provider';

// Stroke icons matching the design prototype's account-menu controls.
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M19.4 4.6l-1.7 1.7M6.3 17.7l-1.7 1.7" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8.5 20h7M12 17v3" />
    </svg>
  );
}

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'System', icon: <MonitorIcon /> },
];

// The Appearance control that lives inside the account menu. A 3-way segmented
// radiogroup (Light / Dark / System). The selected segment uses the ink fill
// (which inverts to cream in dark) — the app's "active = inverse" language.
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={className}>
      <div className="px-s-2 pb-s-1 pt-s-1 text-[11px] font-semibold uppercase tracking-[1.1px] text-ink-mute">
        appearance
      </div>
      <div role="radiogroup" aria-label="appearance" className="flex gap-[6px]">
        {OPTIONS.map((opt) => {
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              onClick={() => setTheme(opt.value)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-[5px] rounded-[8px] border px-[4px] py-[9px] text-[11px] font-semibold transition-colors duration-150 outline-none focus-visible:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-ink)]',
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-transparent text-ink-soft hover:border-rule-strong hover:text-ink',
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
