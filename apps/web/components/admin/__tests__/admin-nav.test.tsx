import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminNav } from '../admin-nav';
import { ADMIN_NAV } from '../admin-nav-items';

let mockPath = '/admin/generation';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
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

describe('AdminNav', () => {
  it('exposes Moderation/Content/Pool/Theory/Invites destinations in order', () => {
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/content', '/admin/generation', '/admin/theory', '/admin/invites', '/admin/audit', '/admin/capacity',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'Content', 'Pool', 'Theory', 'Invites', 'Audit', 'Capacity',
    ]);
  });

  it('renders every destination as a link to its href', () => {
    mockPath = '/admin/generation';
    render(<AdminNav />);
    for (const d of ADMIN_NAV) {
      expect(screen.getByRole('link', { name: d.label })).toHaveAttribute(
        'href',
        d.href,
      );
    }
  });

  it('marks the active destination with aria-current=page', () => {
    mockPath = '/admin/theory';
    render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Theory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Pool' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
