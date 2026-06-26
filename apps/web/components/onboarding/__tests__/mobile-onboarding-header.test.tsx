import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingProvider } from '../onboarding-context';
import { initialNewUserState } from '../use-onboarding-reducer';
import { MobileOnboardingHeader } from '../mobile-onboarding-header';

function renderHeader(step: 1 | 2 | 3 | 4) {
  return render(
    <OnboardingProvider initialState={{ ...initialNewUserState(), step }}>
      <MobileOnboardingHeader />
    </OnboardingProvider>
  );
}

describe('MobileOnboardingHeader', () => {
  it('shows the step counter and a progressbar, no coach copy', () => {
    renderHeader(2);
    expect(screen.getByTestId('onboarding-mobile-header')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByText(/coach|tutor/i)).toBeNull();
  });
});
