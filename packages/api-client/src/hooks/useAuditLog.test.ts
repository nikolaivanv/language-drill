import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useAuditLog } from './useAuditLog';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useAuditLog', () => {
  it('builds the query string from params and parses the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(
      () => useAuditLog({ fetchFn, params: { action: 'invite.revoke', limit: 50, offset: 0 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [], total: 0 });
    expect(fetchFn).toHaveBeenCalledWith('/admin/audit?action=invite.revoke&limit=50&offset=0');
  });
});
