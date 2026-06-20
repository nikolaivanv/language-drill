'use client';

// ---------------------------------------------------------------------------
// SoFarChecklist
// ---------------------------------------------------------------------------
// The "so far" progress checklist inside `CoachPane`. Renders one row per
// step with a `✓` / `●` / `○` glyph, label, and a summary value once the
// step has been completed.
//
// Pure presentational — reads `OnboardingState` from context only.
// ---------------------------------------------------------------------------

import { useOnboarding } from './onboarding-context';
import type { OnboardingState, OnboardingStep } from './use-onboarding-reducer';

type RowStatus = 'completed' | 'current' | 'pending';

type ChecklistRow = {
  /** Step number this row represents (1–4). */
  step: OnboardingStep;
  /** Lowercase label, per the design system voice. */
  label: string;
  /** Optional summary value rendered when the row is completed. */
  summary: string | null;
};

// `·` is U+00B7 (middle dot), matching the prototype copy and R-spec note.
const MIDDLE_DOT = '·';

const GLYPH_BY_STATUS: Record<RowStatus, string> = {
  completed: '✓', // ✓
  current: '●', // ●
  pending: '○', // ○
};

const GLYPH_COLOR_BY_STATUS: Record<RowStatus, string> = {
  completed: 'text-ok',
  current: 'text-accent',
  pending: 'text-ink-mute',
};

function rowStatus(rowStep: OnboardingStep, current: OnboardingStep): RowStatus {
  if (rowStep < current) return 'completed';
  if (rowStep === current) return 'current';
  return 'pending';
}

function buildRows(state: OnboardingState): ChecklistRow[] {
  const { languages, primaryLanguage, levels, goals, dailyMinutes } = state;

  // languages row -----------------------------------------------------------
  const languagesSummary =
    languages.length >= 1 ? `${languages.length} selected` : null;

  // primary + level row -----------------------------------------------------
  const primarySummary =
    primaryLanguage !== null && levels[primaryLanguage] !== undefined
      ? `${primaryLanguage} ${MIDDLE_DOT} ${levels[primaryLanguage]}`
      : null;

  // goals row ---------------------------------------------------------------
  const goalsSummary = goals.length === 0 ? 'none' : `${goals.length} picked`;

  // schedule row ------------------------------------------------------------
  const scheduleSummary =
    dailyMinutes !== null ? `${dailyMinutes} min/day` : null;

  return [
    {
      step: 1,
      label: 'languages',
      summary: languagesSummary,
    },
    {
      step: 2,
      label: 'primary + level',
      summary: primarySummary,
    },
    {
      step: 3,
      label: 'goals',
      // Goals are optional, so always render a summary when the row is
      // completed (R6.5: "N picked" or "none" when zero).
      summary: goalsSummary,
    },
    {
      step: 4,
      label: 'schedule',
      summary: scheduleSummary,
    },
  ];
}

export function SoFarChecklist() {
  const { state } = useOnboarding();
  const rows = buildRows(state);

  return (
    <ul className="flex flex-col gap-s-2" aria-label="onboarding progress">
      {rows.map((row) => {
        const status = rowStatus(row.step, state.step);
        const glyph = GLYPH_BY_STATUS[status];
        const glyphColor = GLYPH_COLOR_BY_STATUS[status];
        // Summary is shown whenever the row's data is meaningful — i.e. on
        // any non-pending row. This includes the schedule row at step 4
        // (which is always `current`, never `completed`, within the 1–4
        // range) so the "10 min/day" value the user is editing stays
        // visible while they're on it. R6.5.
        const showSummary =
          (status === 'completed' || status === 'current') &&
          row.summary !== null;

        return (
          <li key={row.step} className="flex gap-s-2">
            <span
              aria-hidden="true"
              className={`${glyphColor} t-body w-[14px] flex-shrink-0 leading-[1.55]`}
            >
              {glyph}
            </span>
            <div className="flex flex-col">
              <span className="t-body">
                {row.label}
                {showSummary ? (
                  <>
                    <span className="text-ink-mute">: </span>
                    <span className="text-ink-2">{row.summary}</span>
                  </>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
