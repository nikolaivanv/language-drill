'use client';

// ---------------------------------------------------------------------------
// Onboarding shell
// ---------------------------------------------------------------------------
// Top-level layout for the 4-step onboarding wizard. Renders a two-pane
// layout: a 320px coach rail on the left (hidden below `lg`), the mobile
// coach header (visible below `lg`), and the wizard right pane.
//
// The shell assumes an `OnboardingProvider` wraps it (the page owns the
// provider so `handleComplete` can read state and dispatch via the context).
// The shell does not render the provider itself.
// ---------------------------------------------------------------------------

import { CoachPane } from './coach-pane';
import { MobileCoachHeader } from './mobile-coach-header';
import { useOnboarding } from './onboarding-context';
import { StepGoals } from './steps/step-goals';
import { StepLanguages } from './steps/step-languages';
import { StepLevel } from './steps/step-level';
import { StepSchedule } from './steps/step-schedule';
import { WizardFooter } from './wizard-footer';
import { WizardProgress } from './wizard-progress';

type OnboardingMode = 'new' | 'edit';

export interface OnboardingShellProps {
  mode: OnboardingMode;
  onComplete: (mode: OnboardingMode) => void;
}

export function OnboardingShell({ mode, onComplete }: OnboardingShellProps) {
  return (
    // Row on desktop (coach rail + content). At ≤760 the rail is hidden and the
    // layout stacks so the MobileCoachHeader sits on top and the content fills
    // the width (Req 10.1).
    <div className="flex mobile:flex-col min-h-screen bg-paper">
      <CoachPane />
      <MobileCoachHeader />
      <WizardRightPane mode={mode} onComplete={onComplete} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// `WizardRightPane` is intentionally inline. Per the spec (task 15), it's
// only ever an inline composition of `WizardProgress` + the active step +
// `WizardFooter`. Promoting it to its own file would buy nothing.
//
// The pane owns the "advance vs submit" branching for the primary CTA: on
// steps 1–3 the click dispatches `goNext`; on step 4 it calls
// `onComplete(mode)` so the page-level submission orchestration (task 31c)
// can take over. The footer itself stays neutral about which behaviour
// fires.
// ---------------------------------------------------------------------------

function WizardRightPane({
  mode,
  onComplete,
}: {
  mode: OnboardingMode;
  onComplete: (mode: OnboardingMode) => void;
}) {
  const { state, dispatch } = useOnboarding();

  const onPrimary =
    state.step < 4
      ? () => dispatch({ type: 'goNext' })
      : () => onComplete(mode);

  return (
    <section
      data-testid="onboarding-wizard-right-pane"
      className="flex-1"
    >
      {/* Canonical 18px gutter + tighter vertical rhythm at ≤760 so the
          WizardProgress sits near the top of the screen (Req 10.2, 10.4). */}
      <div className="max-w-[760px] mx-auto px-[64px] mobile:px-[18px] py-[56px] mobile:py-[24px] flex flex-col gap-s-7">
        <WizardProgress />
        <ActiveStep />
        <WizardFooter onPrimary={onPrimary} />
      </div>
    </section>
  );
}

function ActiveStep() {
  const { state } = useOnboarding();
  switch (state.step) {
    case 1:
      return <StepLanguages />;
    case 2:
      return <StepLevel />;
    case 3:
      return <StepGoals />;
    case 4:
      return <StepSchedule />;
  }
}
