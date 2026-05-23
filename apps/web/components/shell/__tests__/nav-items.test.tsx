import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NavItems, NAV_DESTINATIONS } from '../nav-items';

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
  it('exposes the four primary destinations in order', () => {
    expect(NAV_DESTINATIONS.map((d) => d.href)).toEqual([
      '/',
      '/drill',
      '/read',
      '/progress',
    ]);
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual([
      'today',
      'drill',
      'read',
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
