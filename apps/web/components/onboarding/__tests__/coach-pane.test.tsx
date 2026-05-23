// ---------------------------------------------------------------------------
// CoachPane tests
// ---------------------------------------------------------------------------
// Locks the per-step coach copy (R6.3) and the bottom footer note. Always
// renders inside a real `OnboardingProvider` so we exercise the actual
// `selectCoachMessage` selector via context.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language, LANGUAGE_NATIVE_NAMES } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { CoachPane } from '../coach-pane';
import { MobileCoachHeader } from '../mobile-coach-header';

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}

function renderCoachPane(state: OnboardingState) {
  return render(
    <OnboardingProvider initialState={state}>
      <CoachPane />
    </OnboardingProvider>
  );
}

describe('CoachPane — per-step coach message (R6.3)', () => {
  it('renders the step 1 message verbatim', () => {
    renderCoachPane(buildState({ step: 1 }));
    expect(
      screen.getByText("let's start with languages. you can add more later.")
    ).toBeInTheDocument();
  });

  it('renders the step 2 fallback when no primary language is set', () => {
    renderCoachPane(
      buildState({ step: 2, languages: [Language.ES], primaryLanguage: null })
    );
    expect(
      screen.getByText(
        'for your primary language — where would you place yourself? rough is fine.'
      )
    ).toBeInTheDocument();
  });

  it('renders the step 2 message with the native language name and em dash when primary is ES', () => {
    renderCoachPane(
      buildState({
        step: 2,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
      })
    );
    // The em dash is U+2014; we embed it directly to guard against a
    // regression where someone substitutes a hyphen.
    expect(
      screen.getByText(
        `for ${LANGUAGE_NATIVE_NAMES[Language.ES]} — where would you place yourself? rough is fine.`
      )
    ).toBeInTheDocument();
  });

  it('renders the step 3 message verbatim', () => {
    renderCoachPane(buildState({ step: 3, languages: [Language.ES] }));
    expect(
      screen.getByText(
        'what do you want to drill? pick whatever fits — even all of them.'
      )
    ).toBeInTheDocument();
  });

  it('renders the step 4 message verbatim', () => {
    renderCoachPane(buildState({ step: 4, languages: [Language.ES] }));
    expect(
      screen.getByText(
        'last thing — how much time can you usually give me?'
      )
    ).toBeInTheDocument();
  });
});

describe('CoachPane / MobileCoachHeader — canonical breakpoint visibility (R10.1, 1.6)', () => {
  it('the coach pane shows ≥761 and hides ≤760 (flex + mobile:hidden, no lg:)', () => {
    renderCoachPane(buildState({ step: 1 }));
    const pane = screen.getByTestId('onboarding-coach-pane');
    expect(pane).toHaveClass('flex', 'mobile:hidden');
    expect(pane.className).not.toContain('lg:');
  });

  it('the mobile coach header hides ≥761 and shows ≤760 (hidden + mobile:flex, no lg:)', () => {
    render(
      <OnboardingProvider initialState={buildState({ step: 1 })}>
        <MobileCoachHeader />
      </OnboardingProvider>,
    );
    const header = screen.getByTestId('onboarding-mobile-coach-header');
    expect(header).toHaveClass('hidden', 'mobile:flex');
    expect(header.className).not.toContain('lg:');
  });
});

describe('CoachPane — footer note', () => {
  it('renders the "~2 min total · skip anything" hand-script footer', () => {
    renderCoachPane(buildState({ step: 1 }));
    // The middle dot is U+00B7; embed it directly so a regression to a
    // regular dot or bullet fails this assertion.
    expect(
      screen.getByText('~2 min total · skip anything')
    ).toBeInTheDocument();
  });
});
