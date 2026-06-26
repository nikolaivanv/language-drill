'use client';

// ---------------------------------------------------------------------------
// ProgressRail — desktop left rail of the onboarding wizard (≥761px).
// Brand + "setup" label + numbered step list (with the value selected so far)
// + an italic footer note. Replaces the old coach pane; no persona. Hidden at
// the `mobile:` breakpoint, where `MobileOnboardingHeader` takes over.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { cn } from '../../lib/cn';
import { useOnboarding } from './onboarding-context';
import type { OnboardingState, OnboardingStep } from './use-onboarding-reducer';

const MIDDLE_DOT = '·'; // U+00B7
const FOOTER_NOTE = '~2 min total · skip anything';

type RowStatus = 'completed' | 'current' | 'pending';
type RailRow = { step: OnboardingStep; label: string; summary: string | null };

function rowStatus(rowStep: OnboardingStep, current: OnboardingStep): RowStatus {
  if (rowStep < current) return 'completed';
  if (rowStep === current) return 'current';
  return 'pending';
}

function buildRows(state: OnboardingState): RailRow[] {
  const { languages, primaryLanguage, levels, goals, dailyMinutes } = state;
  return [
    { step: 1, label: 'languages', summary: languages.length >= 1 ? `${languages.length} selected` : null },
    {
      step: 2,
      label: 'primary + level',
      summary:
        primaryLanguage !== null && levels[primaryLanguage] !== undefined
          ? `${primaryLanguage} ${MIDDLE_DOT} ${levels[primaryLanguage]}`
          : null,
    },
    { step: 3, label: 'goals', summary: goals.length === 0 ? 'none' : `${goals.length} picked` },
    { step: 4, label: 'schedule', summary: dailyMinutes !== null ? `${dailyMinutes} min/day` : null },
  ];
}

function Marker({ step, status }: { step: OnboardingStep; status: RowStatus }) {
  if (status === 'completed') {
    return (
      <span
        aria-hidden="true"
        className="mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-ok text-paper"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.8px] t-mono text-[12px] font-bold',
        status === 'current' ? 'border-accent text-accent' : 'border-rule-strong text-ink-mute'
      )}
    >
      {step}
    </span>
  );
}

export function ProgressRail() {
  const { state } = useOnboarding();
  const rows = buildRows(state);

  return (
    <aside
      data-testid="onboarding-progress-rail"
      className="flex mobile:hidden w-[300px] flex-shrink-0 flex-col border-r border-rule bg-paper px-s-6 py-[30px]"
    >
      <Brand />
      <p className="t-micro text-ink-mute mt-s-5 mb-s-2 px-s-1">setup</p>
      <ol className="flex flex-col" aria-label="onboarding steps">
        {rows.map((r) => {
          const status = rowStatus(r.step, state.step);
          const showSummary = (status === 'completed' || status === 'current') && r.summary !== null;
          return (
            <li
              key={r.step}
              data-step={r.step}
              data-status={status}
              className="flex gap-s-3 border-b border-dashed border-rule px-s-1 py-s-3 last:border-b-0"
            >
              <Marker step={r.step} status={status} />
              <div className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    't-body',
                    status === 'current' ? 'text-ink' : status === 'completed' ? 'text-ink-2' : 'text-ink-soft'
                  )}
                >
                  {r.label}
                </span>
                {showSummary ? (
                  <span className="t-mono text-[12px] text-ink-mute mt-[3px]">{r.summary}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-auto px-s-1 pt-s-5 t-hand text-ink-mute">{FOOTER_NOTE}</p>
    </aside>
  );
}
