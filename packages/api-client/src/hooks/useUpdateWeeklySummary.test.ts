import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateWeeklySummary } from './useUpdateWeeklySummary';

function buildQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function buildWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useUpdateWeeklySummary', () => {
  it('POSTs { enabled } and parses the response', async () => {
    const qc = buildQueryClient();
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ weeklySummary: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useUpdateWeeklySummary({ fetchFn }), {
      wrapper: buildWrapper(qc),
    });
    result.current.mutate({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith(
      '/email/weekly-summary',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: true }) }),
    );
    expect(result.current.data).toEqual({ weeklySummary: 'pending' });
  });
});
