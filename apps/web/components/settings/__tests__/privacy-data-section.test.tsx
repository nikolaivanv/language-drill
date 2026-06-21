import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openPreferencesSpy } = vi.hoisted(() => ({ openPreferencesSpy: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'tok') }),
}));
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: openPreferencesSpy }),
}));

import { PrivacyDataSection } from '../privacy-data-section';

describe('PrivacyDataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPreferencesSpy.mockClear();
  });

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

  it('cookie preferences button calls openPreferences', () => {
    render(<PrivacyDataSection />);
    fireEvent.click(screen.getByRole('button', { name: /cookie preferences/i }));
    expect(openPreferencesSpy).toHaveBeenCalledTimes(1);
  });
});
