import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../lib/api-server', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock('../../components/admin/admin-shell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-shell">{children}</div>
  ),
}));

import AdminLayout from './layout';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function meBody(isAdmin: boolean) {
  return {
    plan: isAdmin ? 'boosted' : 'free',
    isAdmin,
    limits: { evaluation: 50, annotation: 50, deepSpan: 150 },
    usageToday: { evaluation: 0, annotation: 0, deepSpan: 0 },
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockRedirect.mockClear();
});

describe('AdminLayout', () => {
  it('renders children inside the shell when isAdmin is true', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(meBody(true)));
    render(await AdminLayout({ children: <p>admin content</p> }));
    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to / when isAdmin is false', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(meBody(false)));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects to / when /me returns a non-200', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects to / when apiFetch throws (unauthenticated)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('no token'));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });
});
