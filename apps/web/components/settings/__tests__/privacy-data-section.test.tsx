import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'tok') }),
}));
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: vi.fn() }),
}));

import { PrivacyDataSection } from '../privacy-data-section';

describe('PrivacyDataSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the download button and policy links', () => {
    render(<PrivacyDataSection />);
    expect(screen.getByRole('button', { name: /download my data/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /cookie policy/i })).toHaveAttribute('href', '/cookies');
  });

  it('points to account → Security for deletion (no duplicate delete button)', () => {
    render(<PrivacyDataSection />);
    expect(screen.getByText(/delete your account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete account$/i })).not.toBeInTheDocument();
  });
});
