import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileTabBar } from '../mobile-tab-bar';
import { NAV_DESTINATIONS } from '../nav-items';

vi.mock('../use-review-due-count', () => ({
  useReviewDueCount: () => 0,
}));

const mockUsePathname = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
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

describe('MobileTabBar', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
  });

  it('renders all four destinations with hrefs and labels', () => {
    mockUsePathname.mockReturnValue('/');
    render(<MobileTabBar />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(NAV_DESTINATIONS.length);
    for (const dest of NAV_DESTINATIONS) {
      const link = screen.getByRole('link', { name: dest.label });
      expect(link).toHaveAttribute('href', dest.href);
    }
  });

  it('marks the tab matching the current route active', () => {
    mockUsePathname.mockReturnValue('/drill/cloze');
    render(<MobileTabBar />);

    expect(screen.getByRole('link', { name: 'drill' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Root `/` must only be active on an exact match.
    expect(screen.getByRole('link', { name: 'today' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'read' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks today active only on the exact root path', () => {
    mockUsePathname.mockReturnValue('/');
    render(<MobileTabBar />);
    expect(screen.getByRole('link', { name: 'today' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
