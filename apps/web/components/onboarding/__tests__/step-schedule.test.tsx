// ---------------------------------------------------------------------------
// StepSchedule tests
// ---------------------------------------------------------------------------
// Locks the contract for the schedule step (R5.1, R5.2, R5.3, R5.5): all
// 4 daily-minutes tiles render in `DAILY_MINUTES` order with the canonical
// `10` default selected, clicking a tile flips selection (and unselects
// any previous), the gentle-nudges checkbox defaults to checked and
// toggles on click, and the WizardFooter primary CTA reads
// "finish setup →" in new mode at step 4 versus "save changes →" in edit
// mode at step 4. Always renders inside a real `OnboardingProvider` so we
// exercise the actual reducer + component wiring rather than mocking
// dispatch.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CefrLevel, DAILY_MINUTES, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { StepSchedule } from '../steps/step-schedule';
import { WizardFooter } from '../wizard-footer';

// Next.js Link gets used by `Button` when `href` is set (e.g. the edit-mode
// "cancel" link in the footer); stub it to a plain anchor so JSDOM can
// render it without a Next.js test harness.
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

function renderInProvider(state: OnboardingState, ui: React.ReactNode) {
  return render(
    <OnboardingProvider initialState={state}>{ui}</OnboardingProvider>,
  );
}

describe('StepSchedule — mobile stack/wrap (R10.5, 1.6)', () => {
  it('reconciles the time grid to the canonical breakpoint (2×2 ≤760, 4-up above, no ad-hoc 600px)', () => {
    renderInProvider({ ...initialNewUserState(), step: 4 }, <StepSchedule />);
    const group = screen.getByRole('radiogroup', { name: /daily time/i });
    expect(group).toHaveClass('grid-cols-4', 'mobile:grid-cols-2');
    expect(group.className).not.toContain('min-width:600px');
  });
});

describe('StepSchedule', () => {
  it('renders 4 time tiles in DAILY_MINUTES order with the default 10-min tile selected (R5.1, R5.2)', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(state, <StepSchedule />);

    const group = screen.getByRole('radiogroup', { name: /daily time/i });
    const tiles = within(group).getAllByRole('radio');
    expect(tiles).toHaveLength(4);

    // Order matches the canonical DAILY_MINUTES tuple — `[5, 10, 20, 30]`.
    DAILY_MINUTES.forEach((minutes, i) => {
      expect(tiles[i]).toHaveTextContent(String(minutes));
    });

    // R5.2: the 10-min tile (index 1) is selected by default.
    expect(tiles[0]).toHaveAttribute('aria-checked', 'false');
    expect(tiles[1]).toHaveAttribute('aria-checked', 'true');
    expect(tiles[2]).toHaveAttribute('aria-checked', 'false');
    expect(tiles[3]).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking a time tile selects it and unselects the previous selection', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(state, <StepSchedule />);

    const group = screen.getByRole('radiogroup', { name: /daily time/i });
    const tiles = within(group).getAllByRole('radio');

    // Click the 30-min tile (last in DAILY_MINUTES).
    fireEvent.click(tiles[3]);

    expect(tiles[3]).toHaveAttribute('aria-checked', 'true');
    // The default 10-min tile is no longer selected.
    expect(tiles[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('the gentle-nudges checkbox defaults to checked and is labelled by the visible text (R5.3)', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(state, <StepSchedule />);

    // The Checkbox uses `aria-labelledby` to bind to the visible label
    // text, so `getByRole('checkbox', { name: ... })` works — and acts as
    // a regression guard against the a11y wiring being removed.
    const checkbox = screen.getByRole('checkbox', {
      name: /gentle nudges on quiet days/i,
    });
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking the checkbox toggles gentleNudges', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(state, <StepSchedule />);

    const checkbox = screen.getByRole('checkbox', {
      name: /gentle nudges on quiet days/i,
    });
    expect(checkbox).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('the weekly-summary checkbox defaults to unchecked and toggles on click', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(state, <StepSchedule />);

    const checkbox = screen.getByRole('checkbox', { name: /weekly summary/i });
    // Off by default — opt-in, not opt-out.
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
  });

  it('WizardFooter primary CTA reads "finish setup →" in new mode at step 4', () => {
    const state: OnboardingState = { ...initialNewUserState(), step: 4 };
    renderInProvider(
      state,
      <>
        <StepSchedule />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );

    // The arrow below is the literal U+2192 character — embedding it
    // directly is the regression guard against someone replacing it
    // with the ASCII fallback `->`.
    const cta = screen.getByRole('button', { name: /finish setup →/ });
    expect(cta).toBeInTheDocument();
  });

  it('WizardFooter primary CTA reads "save changes →" in edit mode at step 4', () => {
    const state: OnboardingState = {
      ...initialNewUserState(),
      mode: 'edit',
      step: 4,
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      levels: { [Language.ES]: CefrLevel.B2 },
    };
    renderInProvider(
      state,
      <>
        <StepSchedule />
        <WizardFooter onPrimary={() => {}} />
      </>,
    );

    const cta = screen.getByRole('button', { name: /save changes →/ });
    expect(cta).toBeInTheDocument();
  });
});
