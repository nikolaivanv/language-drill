import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import { usePoolCell } from './usePoolCell';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePoolCell', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('builds the cell query string and parses the detail', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ floors: {}, rejectionReasonCounts: {} }));

    const { result } = renderHook(
      () => usePoolCell({ fetchFn, cell: { language: 'ES', level: 'A2', type: 'cloze', grammarPoint: 'obj-pronoun' } }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ floors: {}, rejectionReasonCounts: {} });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/pool-cell?language=ES&level=A2&type=cloze&grammarPoint=obj-pronoun');
  });
});
