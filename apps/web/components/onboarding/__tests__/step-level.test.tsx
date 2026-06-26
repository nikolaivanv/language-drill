// ---------------------------------------------------------------------------
// StepLevel tests
// ---------------------------------------------------------------------------
// Locks the contract for the proficiency-level step (R3.1, R3.2, R3.3, R3.5,
// R3.7): the primary-language radiogroup is suppressed in the single-language
// fast-path and visible (with roving-focus arrow-key navigation) for ≥2
// languages, the CEFR cards drive per-language levels, the placement callout
// is rendered, and `WizardFooter`'s "continue" gate flips on as soon as a
// level is picked. Always renders inside a real `OnboardingProvider` so we
// exercise the actual reducer + component wiring rather than mocking dispatch.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingAction,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { StepLevel } from '../steps/step-level';
import { WizardFooter } from '../wizard-footer';

function renderInProvider(state: OnboardingState, ui: React.ReactNode) {
  return render(
    <OnboardingProvider initialState={state}>{ui}</OnboardingProvider>,
  );
}

/**
 * Render StepLevel with an optional custom dispatch spy. When dispatch is
 * provided, the context is seeded with the given state and the spy captures
 * all dispatched actions. When omitted, the real OnboardingProvider reducer
 * is used.
 */
function renderStepLevel(
  stateOverrides: Partial<OnboardingState> & {
    languages: Language[];
    primaryLanguage: Language | null;
  },
  dispatchSpy?: (action: OnboardingAction) => void,
) {
  const state: OnboardingState = {
    ...initialNewUserState(),
    step: 2,
    ...stateOverrides,
  };
  if (dispatchSpy) {
    return render(
      <OnboardingProvider initialState={state} dispatchOverride={dispatchSpy}>
        <StepLevel />
      </OnboardingProvider>,
    );
  }
  return renderInProvider(state, <StepLevel />);
}

describe('StepLevel', () => {
  it('hides the primary-language radiogroup when only 1 language is selected', () => {
    // Set primaryLanguage explicitly so the on-mount setPrimary effect is a
    // no-op — the suppression rule is purely about `languages.length > 1`.
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    expect(
      screen.queryByRole('radiogroup', { name: /primary language/i }),
    ).not.toBeInTheDocument();
    // The proficiency-level radiogroup IS rendered — the aria-label uses the
    // language's native name.
    expect(
      screen.getByRole('radiogroup', { name: /español level/i }),
    ).toBeInTheDocument();
  });

  it('shows the primary-language radiogroup with both tiles in selection order when ≥2 languages are selected', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    const primaryGroup = screen.getByRole('radiogroup', {
      name: /primary language/i,
    });
    const tiles = within(primaryGroup).getAllByRole('radio');
    expect(tiles).toHaveLength(2);
    // Tiles now show native language names, not bare codes.
    expect(tiles[0]).toHaveTextContent('español');
    expect(tiles[1]).toHaveTextContent('deutsch');
    // ES is the current primary — only the first tile is checked.
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    expect(tiles[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('moves focus among primary-language tiles on ArrowRight / ArrowLeft without changing selection (roving focus)', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    const primaryGroup = screen.getByRole('radiogroup', {
      name: /primary language/i,
    });
    const tiles = within(primaryGroup).getAllByRole('radio');

    tiles[0].focus();
    expect(tiles[0]).toHaveFocus();

    // ArrowRight → second tile.
    fireEvent.keyDown(tiles[0], { key: 'ArrowRight' });
    expect(tiles[1]).toHaveFocus();

    // Selection state is unchanged — ES remains primary.
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    expect(tiles[1]).toHaveAttribute('aria-checked', 'false');

    // Wrap-around: ArrowRight from last → first.
    fireEvent.keyDown(tiles[1], { key: 'ArrowRight' });
    expect(tiles[0]).toHaveFocus();

    // Wrap-around: ArrowLeft from first → last.
    fireEvent.keyDown(tiles[0], { key: 'ArrowLeft' });
    expect(tiles[1]).toHaveFocus();
  });

  it('renders one proficiency radiogroup per selected language', () => {
    renderStepLevel({
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
    });
    expect(
      screen.getByRole('radiogroup', { name: /español level/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: /deutsch level/i }),
    ).toBeInTheDocument();
  });

  it('dispatches setLevel with the language when a card is clicked', () => {
    const dispatch = vi.fn();
    renderStepLevel(
      { languages: [Language.ES, Language.DE], primaryLanguage: Language.ES },
      dispatch,
    );
    const deGroup = screen.getByRole('radiogroup', { name: /deutsch level/i });
    fireEvent.click(within(deGroup).getByRole('radio', { name: /B1/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setLevel',
      language: Language.DE,
      level: CefrLevel.B1,
    });
  });

  it('selecting a CEFR card sets the level for that language (and only that card becomes checked)', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    const cefrGroup = screen.getByRole('radiogroup', {
      name: /español level/i,
    });
    const cards = within(cefrGroup).getAllByRole('radio');
    expect(cards).toHaveLength(6);

    // None checked initially — no level has been picked.
    cards.forEach((c) => expect(c).toHaveAttribute('aria-checked', 'false'));

    // CEFR_LEVELS order is A1, A2, B1, B2, C1, C2 — index 3 is B2 and the
    // tile's accessible name includes the code.
    const b2 = cards[3];
    expect(b2).toHaveTextContent(CefrLevel.B2);

    fireEvent.click(b2);
    expect(b2).toHaveAttribute('aria-checked', 'true');
    cards.forEach((c, i) => {
      if (i !== 3) expect(c).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('does not render a placement-test callout', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    expect(screen.queryByTestId('placement-test-callout')).toBeNull();
  });

  it('shows a "primary" badge on the selected primary language tile', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES, Language.DE],
      primaryLanguage: Language.ES,
    };
    renderInProvider(state, <StepLevel />);
    expect(screen.getByText('primary')).toBeInTheDocument();
    // The badge appears only on the primary tile, not on the non-primary tile.
    const primaryGroup = screen.getByRole('radiogroup', {
      name: /primary language/i,
    });
    const tiles = within(primaryGroup).getAllByRole('radio');
    expect(within(tiles[0]).getByText('primary')).toBeInTheDocument();
    expect(within(tiles[1]).queryByText('primary')).toBeNull();
  });

  it('WizardFooter continue button is disabled until a CEFR level is picked', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      step: 2,
      languages: [Language.ES],
      primaryLanguage: Language.ES,
    };
    renderInProvider(
      state,
      <>
        <StepLevel />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );
    const cta = screen.getByTestId('wizard-footer-primary');
    expect(cta).toBeDisabled();

    const cefrGroup = screen.getByRole('radiogroup', {
      name: /español level/i,
    });
    const b2 = within(cefrGroup).getAllByRole('radio')[3];
    fireEvent.click(b2);
    expect(cta).not.toBeDisabled();
  });
});
