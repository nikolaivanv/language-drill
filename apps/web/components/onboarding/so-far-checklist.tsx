'use client';

// ---------------------------------------------------------------------------
// SoFarChecklist
// ---------------------------------------------------------------------------
// The "so far" progress checklist inside `CoachPane`. Renders one row per
// step with a `✓` / `●` / `○` glyph, label, and a summary value once the
// step has been completed. The "languages" row also surfaces the
// placeholder-A1 disclosure (R6.6) when ≥1 non-primary language has been
// selected and the user has reached or passed Step 2.
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
  /** Optional second line — used for the placeholder-A1 disclosure. */
  subLine: string | null;
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
  const { languages, primaryLanguage, primaryLevel, goals, dailyMinutes, step } =
    state;

  // languages row -----------------------------------------------------------
  const languagesSummary =
    languages.length >= 1 ? `${languages.length} selected` : null;

  // R6.6: show "level: a1 (adjustable later)" once the user has reached or
  // passed Step 2 AND has at least one non-primary language selected.
  const hasNonPrimaryLanguage =
    primaryLanguage !== null
      ? languages.some((l) => l !== primaryLanguage)
      : languages.length >= 1;
  const showA1SubLine = step >= 2 && hasNonPrimaryLanguage;

  // primary + level row -----------------------------------------------------
  const primarySummary =
    primaryLanguage !== null && primaryLevel !== null
      ? `${primaryLanguage} ${MIDDLE_DOT} ${primaryLevel}`
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
      subLine: showA1SubLine ? 'level: a1 (adjustable later)' : null,
    },
    {
      step: 2,
      label: 'primary + level',
      summary: primarySummary,
      subLine: null,
    },
    {
      step: 3,
      label: 'goals',
      // Goals are optional, so always render a summary when the row is
      // completed (R6.5: "N picked" or "none" when zero).
      summary: goalsSummary,
      subLine: null,
    },
    {
      step: 4,
      label: 'schedule',
      summary: scheduleSummary,
      subLine: null,
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
              {row.subLine !== null ? (
                <span className="t-small text-ink-mute">{row.subLine}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
