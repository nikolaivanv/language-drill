// ---------------------------------------------------------------------------
// WizardProgress tests
// ---------------------------------------------------------------------------
// Renders the bar inside a real `OnboardingProvider` so the segments reflect
// the current `state.step`. Asserts the "active 2× width" rule, the filled
// vs unfilled classes, and the `progressbar` ARIA contract.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingProvider } from '../onboarding-context';
import {
  initialNewUserState,
  type OnboardingState,
} from '../use-onboarding-reducer';
import { WizardProgress } from '../wizard-progress';

function withStep(step: 1 | 2 | 3 | 4): OnboardingState {
  return { ...initialNewUserState(), step };
}

function renderAtStep(step: 1 | 2 | 3 | 4) {
  return render(
    <OnboardingProvider initialState={withStep(step)}>
      <WizardProgress />
    </OnboardingProvider>
  );
}

describe('WizardProgress', () => {
  it('renders 4 segments', () => {
    renderAtStep(1);
    for (const i of [1, 2, 3, 4] as const) {
      expect(
        screen.getByTestId(`wizard-progress-segment-${i}`)
      ).toBeInTheDocument();
    }
  });

  it('exposes a progressbar with the current step', () => {
    renderAtStep(2);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemin', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
  });

  it('marks the active segment 2× width and others 1×', () => {
    renderAtStep(2);
    const active = screen.getByTestId('wizard-progress-segment-2');
    expect(active.className).toContain('flex-[2]');
    expect(active).toHaveAttribute('data-active', 'true');

    for (const i of [1, 3, 4] as const) {
      const seg = screen.getByTestId(`wizard-progress-segment-${i}`);
      expect(seg.className).toContain('flex-1');
      expect(seg).not.toHaveAttribute('data-active');
    }
  });

  it('fills segments at or before the active step with bg-ink', () => {
    renderAtStep(3);
    for (const i of [1, 2, 3] as const) {
      const seg = screen.getByTestId(`wizard-progress-segment-${i}`);
      expect(seg.className).toContain('bg-ink');
      expect(seg).toHaveAttribute('data-filled', 'true');
    }
    const empty = screen.getByTestId('wizard-progress-segment-4');
    expect(empty.className).toContain('bg-paper-3');
    expect(empty).not.toHaveAttribute('data-filled');
  });

  it('fills all four segments at step 4', () => {
    renderAtStep(4);
    for (const i of [1, 2, 3, 4] as const) {
      const seg = screen.getByTestId(`wizard-progress-segment-${i}`);
      expect(seg.className).toContain('bg-ink');
    }
  });

  it('only the active segment carries data-active', () => {
    renderAtStep(1);
    expect(
      screen.getByTestId('wizard-progress-segment-1')
    ).toHaveAttribute('data-active', 'true');
    for (const i of [2, 3, 4] as const) {
      expect(
        screen.getByTestId(`wizard-progress-segment-${i}`)
      ).not.toHaveAttribute('data-active');
    }
  });
});
