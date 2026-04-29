// ---------------------------------------------------------------------------
// WizardFooter tests
// ---------------------------------------------------------------------------
// Covers all five CTA-label cases (R1.5), the back/cancel slot rules
// (R1.6, R8.5), CTA disable rules (R7.9), the loading state (R7.7), and
// the inline error display (R7.8). Always renders inside a real
// `OnboardingProvider` so we exercise the actual reducer/selector wiring.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { WizardFooter } from '../wizard-footer';

// Next.js Link gets used by `Button` when `href` is set; stub it to a plain
// anchor so JSDOM can render it without a Next.js test harness.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}

function renderFooter(
  state: OnboardingState,
  onPrimary: () => void = () => {}
) {
  return render(
    <OnboardingProvider initialState={state}>
      <WizardFooter onPrimary={onPrimary} />
    </OnboardingProvider>
  );
}

describe('WizardFooter — CTA label resolution (R1.5)', () => {
  it('reads "continue →" on step 1 in new mode', () => {
    renderFooter(
      buildState({ step: 1, languages: [Language.ES] })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'continue →'
    );
  });

  it('reads "continue →" on step 2 in new mode', () => {
    renderFooter(
      buildState({
        step: 2,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'continue →'
    );
  });

  it('reads "continue →" on step 3 in new mode', () => {
    renderFooter(buildState({ step: 3, languages: [Language.ES] }));
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'continue →'
    );
  });

  it('reads "finish setup →" on step 4 in new mode', () => {
    renderFooter(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'finish setup →'
    );
  });

  it('reads "save changes →" on step 4 in edit mode', () => {
    renderFooter(
      buildState({
        mode: 'edit',
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'save changes →'
    );
  });

  it('still reads "continue →" on steps 1–3 in edit mode', () => {
    renderFooter(
      buildState({
        mode: 'edit',
        step: 2,
        languages: [Language.ES, Language.DE],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toHaveTextContent(
      'continue →'
    );
  });
});

describe('WizardFooter — back / cancel slot (R1.6, R8.5)', () => {
  it('hides the back button on step 1 in new mode', () => {
    renderFooter(buildState({ step: 1, languages: [Language.ES] }));
    expect(screen.queryByTestId('wizard-footer-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard-footer-cancel')).not.toBeInTheDocument();
  });

  it('shows a ghost "cancel" link to /settings on step 1 in edit mode', () => {
    renderFooter(
      buildState({
        mode: 'edit',
        step: 1,
        languages: [Language.ES],
      })
    );
    // `Button` with an internal `href` renders an anchor; it doesn't
    // forward arbitrary props onto the anchor, so we query by role.
    const cancel = screen.getByRole('link', { name: 'cancel' });
    expect(cancel).toBeInTheDocument();
    expect(cancel.getAttribute('href')).toBe('/settings');
    // The ghost variant carries its border-transparent + ink-soft text.
    expect(cancel.className).toContain('border-transparent');
    expect(cancel.className).toContain('text-ink-soft');
    expect(screen.queryByTestId('wizard-footer-back')).not.toBeInTheDocument();
  });

  it('shows the back button on step 2', () => {
    renderFooter(
      buildState({
        step: 2,
        languages: [Language.ES],
      })
    );
    expect(screen.getByTestId('wizard-footer-back')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-footer-cancel')).not.toBeInTheDocument();
  });

  it('clicking back dispatches goBack (steps to previous step)', () => {
    renderFooter(
      buildState({
        step: 3,
        languages: [Language.ES],
      })
    );
    fireEvent.click(screen.getByTestId('wizard-footer-back'));
    // The counter reads from state — after `goBack` it should drop to 2/4.
    expect(screen.getByTestId('wizard-footer-counter')).toHaveTextContent(
      '2 / 4'
    );
  });
});

describe('WizardFooter — counter', () => {
  it('renders a t-mono "X / 4" counter', () => {
    renderFooter(buildState({ step: 3, languages: [Language.ES] }));
    const counter = screen.getByTestId('wizard-footer-counter');
    expect(counter).toHaveTextContent('3 / 4');
    expect(counter.className).toContain('t-mono');
  });
});

describe('WizardFooter — CTA disable rules (R7.9)', () => {
  it('disables the CTA when selectCanAdvance is false (no language on step 1)', () => {
    renderFooter(buildState({ step: 1, languages: [] }));
    expect(screen.getByTestId('wizard-footer-primary')).toBeDisabled();
  });

  it('enables the CTA when selectCanAdvance is true', () => {
    renderFooter(
      buildState({
        step: 1,
        languages: [Language.ES],
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).not.toBeDisabled();
  });

  it('disables the CTA while submission is loading', () => {
    renderFooter(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
        submission: { status: 'loading' },
      })
    );
    expect(screen.getByTestId('wizard-footer-primary')).toBeDisabled();
  });
});

describe('WizardFooter — loading state (R7.7)', () => {
  it('passes loading=true to the Button so the spinner renders', () => {
    renderFooter(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
        submission: { status: 'loading' },
      })
    );
    const cta = screen.getByTestId('wizard-footer-primary');
    // `Button` sets aria-busy when its `loading` prop is true.
    expect(cta).toHaveAttribute('aria-busy', 'true');
    // The label text is hidden while the spinner takes its place.
    expect(cta.textContent).not.toContain('finish setup');
  });
});

describe('WizardFooter — error display (R7.8)', () => {
  it('renders nothing in the error slot when submission is idle', () => {
    renderFooter(buildState({ step: 4, languages: [Language.ES] }));
    expect(screen.queryByTestId('wizard-footer-error')).not.toBeInTheDocument();
  });

  it('renders a t-small role="alert" with the server message on error', () => {
    renderFooter(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
        submission: {
          status: 'error',
          kind: '4xx',
          message: 'primaryLanguage must match one of the submitted profiles',
        },
      })
    );
    const error = screen.getByTestId('wizard-footer-error');
    expect(error).toHaveTextContent(
      'primaryLanguage must match one of the submitted profiles'
    );
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.className).toContain('t-small');
    expect(error.className).toContain('text-accent-2');
  });
});

describe('WizardFooter — primary onClick', () => {
  it('invokes onPrimary when the CTA is clicked', () => {
    const onPrimary = vi.fn();
    renderFooter(
      buildState({
        step: 1,
        languages: [Language.ES],
      }),
      onPrimary
    );
    fireEvent.click(screen.getByTestId('wizard-footer-primary'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onPrimary while loading', () => {
    const onPrimary = vi.fn();
    renderFooter(
      buildState({
        step: 4,
        languages: [Language.ES],
        primaryLanguage: Language.ES,
        primaryLevel: CefrLevel.B1,
        dailyMinutes: 10,
        submission: { status: 'loading' },
      }),
      onPrimary
    );
    fireEvent.click(screen.getByTestId('wizard-footer-primary'));
    expect(onPrimary).not.toHaveBeenCalled();
  });
});
