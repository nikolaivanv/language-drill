import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import { initialNewUserState, type OnboardingState } from '../use-onboarding-reducer';
import { ProgressRail } from '../progress-rail';

function build(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}
function renderRail(state: OnboardingState) {
  return render(
    <OnboardingProvider initialState={state}>
      <ProgressRail />
    </OnboardingProvider>
  );
}
const row = (n: number) =>
  document.querySelector(`[data-testid="onboarding-progress-rail"] [data-step="${n}"]`)!;

describe('ProgressRail', () => {
  it('renders the four step labels and the footer note', () => {
    renderRail(build());
    expect(screen.getByText('languages')).toBeInTheDocument();
    expect(screen.getByText('primary + level')).toBeInTheDocument();
    expect(screen.getByText('goals')).toBeInTheDocument();
    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('~2 min total · skip anything')).toBeInTheDocument();
  });

  it('marks the current step and shows a number marker for non-completed steps', () => {
    renderRail(build({ step: 2 }));
    expect(row(2).getAttribute('data-status')).toBe('current');
    expect(within(row(2) as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(row(3).getAttribute('data-status')).toBe('pending');
  });

  it('shows a check (not the number) for completed steps', () => {
    renderRail(build({ step: 3 }));
    expect(row(1).getAttribute('data-status')).toBe('completed');
    expect(within(row(1) as HTMLElement).queryByText('1')).toBeNull();
    expect((row(1) as HTMLElement).querySelector('svg')).not.toBeNull();
  });

  it('renders the per-step selected value once the step is reached', () => {
    renderRail(
      build({
        step: 2,
        languages: [Language.ES, Language.DE],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B1 },
      })
    );
    // step 1 completed → "2 selected"; step 2 current → "ES · B1"
    expect(within(row(1) as HTMLElement).getByText('2 selected')).toBeInTheDocument();
    expect(within(row(2) as HTMLElement).getByText('ES · B1')).toBeInTheDocument();
  });

  it('hides the value for steps not yet reached', () => {
    renderRail(build({ step: 1, languages: [Language.ES] }));
    expect(within(row(4) as HTMLElement).queryByText(/min\/day/)).toBeNull();
  });
});
