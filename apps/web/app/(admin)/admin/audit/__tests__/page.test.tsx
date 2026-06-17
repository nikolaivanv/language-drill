import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseAuditLog = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useAuditLog: (args: unknown) => mockUseAuditLog(args) };
});

import AuditPage from '../page';

beforeEach(() => {
  mockUseAuditLog.mockReset();
});

describe('AuditPage', () => {
  it('renders an audit row (time/admin/action/target/details)', () => {
    mockUseAuditLog.mockReturnValue({
      isLoading: false, isError: false,
      data: { items: [{ id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise', targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: '2026-06-17T00:00:00.000Z' }], total: 1 },
    });
    render(<AuditPage />);
    expect(screen.getByRole('cell', { name: 'flagged.approve' })).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByText(/ex-1/)).toBeInTheDocument();
    expect(screen.getByText(/"outcome":"approved"/)).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<AuditPage />);
    expect(screen.getByText(/no audit events/i)).toBeInTheDocument();
  });

  it('resets offset to 0 when a filter changes', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<AuditPage />);
    fireEvent.change(screen.getByLabelText(/action/i), { target: { value: 'invite.revoke' } });
    const lastArgs = mockUseAuditLog.mock.calls.at(-1)![0];
    expect(lastArgs.params).toMatchObject({ action: 'invite.revoke', offset: 0 });
  });

  it('shows the loading state', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<AuditPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the error state', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<AuditPage />);
    expect(screen.getByText(/failed to load the audit log/i)).toBeInTheDocument();
  });
});
