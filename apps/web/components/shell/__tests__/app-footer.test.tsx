import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: () => {} }),
}));

import { AppFooter } from '../app-footer';

describe('AppFooter', () => {
  it('renders the legal links, cookie preferences, contact, and a copyright line', () => {
    render(<AppFooter />);

    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /cookies/i })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('button', { name: /cookie preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /info@langdrill\.app/i })).toHaveAttribute(
      'href',
      'mailto:info@langdrill.app',
    );
    expect(screen.getByText(/©\s*2026 drill/i)).toBeInTheDocument();
  });
});
