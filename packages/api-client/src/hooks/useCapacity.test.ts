import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCapacity } from './useCapacity';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useCapacity', () => {
  it('fetches /admin/capacity and parses the response', async () => {
    const payload = {
      killSwitch: false,
      globalDailyCap: null,
      usage24h: { total: 0, byEventType: [] },
      topConsumers: [],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const { result } = renderHook(() => useCapacity({ fetchFn }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith('/admin/capacity');
  });
});
