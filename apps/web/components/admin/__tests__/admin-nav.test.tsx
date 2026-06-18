import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminNav } from '../admin-nav';
import { ADMIN_NAV } from '../admin-nav-items';

let mockPath = '/admin/pool';
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
  it('exposes Moderation/Content/Pool/Invites destinations in order', () => {
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/flags', '/admin/content', '/admin/pool', '/admin/invites', '/admin/audit', '/admin/capacity', '/admin/curriculum',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'User flags', 'Content', 'Pool', 'Invites', 'Audit', 'Capacity', 'Curriculum',
    ]);
  });

  it('renders every destination as a link to its href', () => {
    mockPath = '/admin/pool';
    render(<AdminNav />);
    for (const d of ADMIN_NAV) {
      expect(screen.getByRole('link', { name: d.label })).toHaveAttribute(
        'href',
        d.href,
      );
    }
  });

  it('marks the active destination with aria-current=page', () => {
    mockPath = '/admin/pool';
    render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Pool' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Content' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
