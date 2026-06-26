'use client';

// ---------------------------------------------------------------------------
// MobileOnboardingHeader — narrow-viewport top bar (≤760px). Brand + "N / 4"
// counter + the segmented WizardProgress. Replaces the coach strip; no
// persona message. Hidden ≥761 where ProgressRail takes over.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { useOnboarding } from './onboarding-context';
import { WizardProgress } from './wizard-progress';

const STEP_COUNT = 4;

export function MobileOnboardingHeader() {
  const { state } = useOnboarding();
  return (
    <header
      data-testid="onboarding-mobile-header"
      className="hidden mobile:flex flex-col gap-s-3 border-b border-rule bg-paper px-s-4 pt-s-4 pb-s-3"
    >
      <div className="flex items-center justify-between">
        <Brand />
        <span className="t-mono text-ink-mute">
          {state.step} / {STEP_COUNT}
        </span>
      </div>
      <WizardProgress />
    </header>
  );
}
