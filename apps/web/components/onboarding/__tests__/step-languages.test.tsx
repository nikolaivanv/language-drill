// ---------------------------------------------------------------------------
// StepLanguages tests
// ---------------------------------------------------------------------------
// Locks the contract for the learning-language tile grid (R2.1, R2.3, R2.4,
// R2.5, R2.7): fixed ES → DE → TR order, toggle behaviour, the
// integration with `WizardFooter` for CTA enablement, EN never showing in
// the rendered output, and the edit-mode last-language guard. Always
// renders inside a real `OnboardingProvider` so we exercise the actual
// reducer + component wiring rather than mocking dispatch.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CefrLevel,
  LANGUAGE_NATIVE_NAMES,
  Language,
} from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { StepLanguages } from '../steps/step-languages';
import { WizardFooter } from '../wizard-footer';

function renderInProvider(state: OnboardingState, ui: React.ReactNode) {
  return render(
    <OnboardingProvider initialState={state}>{ui}</OnboardingProvider>,
  );
}

describe('StepLanguages — mobile single-column (R10.3, 1.6)', () => {
  it('stacks the language grid to one column at ≤760', () => {
    renderInProvider(initialNewUserState(), <StepLanguages />);
    const group = screen.getByRole('group', { name: /learning languages/i });
    expect(group).toHaveClass('grid-cols-2', 'mobile:grid-cols-1');
  });
});

describe('StepLanguages', () => {
  it('renders the 3 learning-language tiles in ES → DE → TR order', () => {
    renderInProvider(initialNewUserState(), <StepLanguages />);
    const tiles = screen.getAllByRole('checkbox');
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveTextContent(LANGUAGE_NATIVE_NAMES[Language.ES]);
    expect(tiles[1]).toHaveTextContent(LANGUAGE_NATIVE_NAMES[Language.DE]);
    expect(tiles[2]).toHaveTextContent(LANGUAGE_NATIVE_NAMES[Language.TR]);
  });

  it('clicking a tile toggles language selection (select → deselect)', () => {
    renderInProvider(initialNewUserState(), <StepLanguages />);
    const [esTile] = screen.getAllByRole('checkbox');
    expect(esTile).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(esTile);
    expect(esTile).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(esTile);
    expect(esTile).toHaveAttribute('aria-checked', 'false');
  });

  it('WizardFooter continue button is disabled with 0 languages, enabled with ≥1', () => {
    renderInProvider(
      initialNewUserState(),
      <>
        <StepLanguages />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );
    const cta = screen.getByTestId('wizard-footer-primary');
    expect(cta).toBeDisabled();
    const [esTile] = screen.getAllByRole('checkbox');
    fireEvent.click(esTile);
    expect(cta).not.toBeDisabled();
  });

  it('does not render an EN tile or the EN native name anywhere', () => {
    const { container } = renderInProvider(
      initialNewUserState(),
      <StepLanguages />,
    );
    // Exactly 3 tiles — never a 4th for EN.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    // The English language name (LANGUAGE_NAMES[Language.EN]) must not leak
    // into the step.
    expect(screen.queryByText(/english/i)).not.toBeInTheDocument();
    // The Flagdot for EN renders the lowercase ISO code "en" — guard
    // against a regression that adds an EN tile and surfaces that token.
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('english');
  });

  it('in edit mode, clicking the last selected tile shows the inline guard message and keeps it selected', () => {
    const editStateOneLang: OnboardingState = {
      ...initialNewUserState(),
      mode: 'edit',
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
    };
    renderInProvider(editStateOneLang, <StepLanguages />);
    const [esTile] = screen.getAllByRole('checkbox');
    expect(esTile).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(esTile);
    // Tile remains selected — the component's guard returns before
    // dispatching, and the reducer would silently reject `setLanguages([])`
    // anyway.
    expect(esTile).toHaveAttribute('aria-checked', 'true');
    // Inline guard appears with the canonical em-dash (U+2014) string.
    const guard = screen.getByRole('status');
    expect(guard).toHaveTextContent(
      'you need at least one language — to fully reset, delete your account from settings.',
    );
    expect(guard).toHaveAttribute('aria-live', 'polite');
  });
});
