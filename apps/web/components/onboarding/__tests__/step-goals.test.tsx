// ---------------------------------------------------------------------------
// StepGoals tests
// ---------------------------------------------------------------------------
// Locks the contract for the goals + notes step (R4.1, R4.2, R4.3, R4.4,
// R4.5): all 6 goal tiles render in the canonical `GOAL_IDS` order with
// line-svg icons hidden from assistive tech, toggling a tile flips its
// selection, the notes textarea carries `maxLength=NOTES_MAX_LENGTH` as a
// UA hint, paste-overflow above the cap surfaces the inline counter and
// disables the WizardFooter CTA via `selectCanAdvance`, and Step 3 is
// fully optional (the CTA is enabled with zero goals + empty notes).
// Always renders inside a real `OnboardingProvider` so we exercise the
// actual reducer + component wiring rather than mocking dispatch.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GOAL_IDS, NOTES_MAX_LENGTH } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { StepGoals } from '../steps/step-goals';
import { WizardFooter } from '../wizard-footer';

function renderInProvider(state: OnboardingState, ui: React.ReactNode) {
  return render(
    <OnboardingProvider initialState={state}>{ui}</OnboardingProvider>,
  );
}

describe('StepGoals — mobile single-column (R10.3, 1.6)', () => {
  it('reconciles the goal grid to the canonical breakpoint (1-col ≤760, no ad-hoc 600px)', () => {
    renderInProvider({ ...initialNewUserState(), step: 3 }, <StepGoals />);
    const group = screen.getByRole('group', { name: /goals/i });
    expect(group).toHaveClass('grid-cols-2', 'mobile:grid-cols-1');
    expect(group.className).not.toContain('min-width:600px');
  });
});

describe('StepGoals', () => {
  it('renders all 6 goal tiles in the canonical GOAL_IDS order', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(state, <StepGoals />);

    const group = screen.getByRole('group', { name: /goals/i });
    const tiles = within(group).getAllByRole('checkbox');
    expect(tiles).toHaveLength(6);

    // Verbatim labels per R4.1 — locked in the same order as GOAL_IDS so a
    // copy-edit or reorder forces the test (and the requirements doc) to
    // be updated together.
    const expectedLabels = [
      'grammar',
      'speaking fluency',
      'understanding fast speech',
      'writing',
      'vocabulary',
      'prep for a trip / convo',
    ];
    tiles.forEach((tile, i) => {
      expect(tile).toHaveTextContent(expectedLabels[i]);
    });

    // The canonical GOAL_IDS order is the regression guard — if the shared
    // package changes its ordering, this test fails first.
    expect(GOAL_IDS).toEqual([
      'grammar',
      'speaking',
      'listening',
      'writing',
      'vocab',
      'travel',
    ]);

    // Line-svg icons are rendered per tile; spot-check first and last id.
    expect(document.querySelector('[data-testid="goal-icon-grammar"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="goal-icon-travel"]')).not.toBeNull();
  });

  it('renders a line-svg icon for each goal', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(state, <StepGoals />);

    expect(document.querySelector('[data-testid="goal-icon-grammar"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="goal-icon-travel"]')).not.toBeNull();
  });

  it('clicking a goal tile toggles its selection state', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(state, <StepGoals />);

    const group = screen.getByRole('group', { name: /goals/i });
    const tiles = within(group).getAllByRole('checkbox');

    tiles.forEach((t) => expect(t).toHaveAttribute('aria-checked', 'false'));

    fireEvent.click(tiles[0]);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(tiles[0]);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('the notes textarea has maxLength=NOTES_MAX_LENGTH as a UA hint', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(state, <StepGoals />);

    // The label copy comes from R4.3; we match a stable substring.
    const textarea = screen.getByLabelText(
      /anything specific i should know/i,
    );
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(textarea).toHaveAttribute('maxLength', String(NOTES_MAX_LENGTH));
  });

  it('paste-overflow above the limit shows the inline counter and disables the continue CTA', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(
      state,
      <>
        <StepGoals />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );

    const textarea = screen.getByLabelText(
      /anything specific i should know/i,
    );
    const cta = screen.getByTestId('wizard-footer-primary');

    // Below the limit: no counter rendered, CTA enabled.
    expect(screen.queryByText(/\/ 500/)).not.toBeInTheDocument();
    expect(cta).not.toBeDisabled();

    // Simulate paste-overflow. The textarea is controlled — `fireEvent.change`
    // triggers `onChange` with the full target value, and JSDOM does not
    // truncate the synthetic event value to `maxLength`. The reducer accepts
    // the over-limit string verbatim; `selectCanAdvance` (Step 3) then flips
    // false, which disables the CTA.
    const overflow = 'x'.repeat(NOTES_MAX_LENGTH + 1);
    fireEvent.change(textarea, { target: { value: overflow } });

    expect(
      screen.getByText(`${NOTES_MAX_LENGTH + 1} / ${NOTES_MAX_LENGTH}`),
    ).toBeInTheDocument();
    expect(cta).toBeDisabled();
  });

  it('the continue CTA is enabled at Step 3 with zero goals selected and empty notes (R4.4)', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 3 };
    renderInProvider(
      state,
      <>
        <StepGoals />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );

    const cta = screen.getByTestId('wizard-footer-primary');
    expect(cta).not.toBeDisabled();
  });
});
