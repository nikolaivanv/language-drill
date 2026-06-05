import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NavItems, NAV_DESTINATIONS } from '../nav-items';

vi.mock('../use-review-due-count', () => ({
  useReviewDueCount: () => 0,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('NavItems', () => {
  it('exposes the primary destinations in order (review + theory between read and progress)', () => {
    expect(NAV_DESTINATIONS.map((d) => d.href)).toEqual([
      '/home',
      '/drill',
      '/read',
      '/review',
      '/theory',
      '/progress',
    ]);
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual([
      'today',
      'drill',
      'read',
      'review',
      'theory',
      'progress',
    ]);
  });

  it('renders a link for every destination with the right href and label', () => {
    render(<NavItems />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(NAV_DESTINATIONS.length);

    for (const dest of NAV_DESTINATIONS) {
      const link = screen.getByRole('link', { name: dest.label });
      expect(link).toHaveAttribute('href', dest.href);
    }
  });
});
