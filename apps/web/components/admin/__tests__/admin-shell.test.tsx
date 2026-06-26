import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../admin-nav', () => ({
  AdminNav: () => <ul data-testid="admin-nav" />,
}));
vi.mock('../../shell/user-footer', () => ({
  UserFooter: () => <div data-testid="user-footer" />,
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

import { AdminShell } from '../admin-shell';

describe('AdminShell', () => {
  it('renders the admin rail, nav, and its children', () => {
    render(
      <AdminShell>
        <p>panel body</p>
      </AdminShell>,
    );
    expect(screen.getByTestId('admin-rail')).toBeInTheDocument();
    expect(screen.getByTestId('admin-nav')).toBeInTheDocument();
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('links the rail title back to /admin', () => {
    render(
      <AdminShell>
        <p>x</p>
      </AdminShell>,
    );
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });

  it('offers an escape hatch to the learner app and mounts the account menu', () => {
    render(
      <AdminShell>
        <p>x</p>
      </AdminShell>,
    );
    expect(screen.getByRole('link', { name: /open app/i })).toHaveAttribute(
      'href',
      '/home',
    );
    expect(screen.getByTestId('user-footer')).toBeInTheDocument();
  });
});
