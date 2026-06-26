'use client';

// ---------------------------------------------------------------------------
// WizardProgress
// ---------------------------------------------------------------------------
// 4-segment progress bar above the active step. Segments at or before the
// current step are filled (`bg-ink`); the rest sit on `bg-paper-3`. The
// active segment renders 2× the width of the others (`flex-[2]` vs
// `flex-1`) so the user always knows where they are at a glance, regardless
// of viewport width. Reads `state.step` from `useOnboarding()` — no props.
// ---------------------------------------------------------------------------

import { useOnboarding } from './onboarding-context';

const STEP_COUNT = 4;

export function WizardProgress() {
  const { state } = useOnboarding();

  return (
    <div
      className="flex w-full gap-s-2"
      role="progressbar"
      aria-valuenow={state.step}
      aria-valuemin={1}
      aria-valuemax={STEP_COUNT}
      aria-label={`onboarding step ${state.step} of ${STEP_COUNT}`}
    >
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const stepNum = (i + 1) as 1 | 2 | 3 | 4;
        const isActive = stepNum === state.step;
        const isFilled = stepNum <= state.step;
        return (
          <div
            key={stepNum}
            data-testid={`wizard-progress-segment-${stepNum}`}
            data-active={isActive ? 'true' : undefined}
            data-filled={isFilled ? 'true' : undefined}
            aria-hidden="true"
            className={[
              'h-[4px] rounded-pill transition-colors duration-150',
              isFilled ? 'bg-ink' : 'bg-paper-3',
              isActive ? 'flex-[2]' : 'flex-1',
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}
