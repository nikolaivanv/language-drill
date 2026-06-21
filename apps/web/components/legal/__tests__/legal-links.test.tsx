import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: () => {} }),
}));

import { LegalLinks } from '../legal-links';

describe('LegalLinks', () => {
  it('renders all three policy links, cookie preferences, and contact email', () => {
    render(<LegalLinks />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /cookies/i })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('button', { name: /cookie preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /info@langdrill\.app/i })).toHaveAttribute(
      'href', 'mailto:info@langdrill.app',
    );
  });
});
