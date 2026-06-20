import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({
  UserProfile: () => <div data-testid="clerk-user-profile" />,
}));

import { AccountSection } from '../account-section';

describe('AccountSection', () => {
  it('renders the Clerk UserProfile inside the account section', () => {
    render(<AccountSection />);
    expect(document.getElementById('set-account')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-user-profile')).toBeInTheDocument();
  });
});
