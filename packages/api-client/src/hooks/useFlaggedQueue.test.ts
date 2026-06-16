import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFlaggedExercises, useResolveFlaggedExercise } from './useFlaggedQueue';
import type { AuthenticatedFetch } from '../fetchClient';

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

describe('useFlaggedExercises', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('fetches + parses the list with filters in the query string', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ items: [], total: 0 }));

    const { result } = renderHook(
      () => useFlaggedExercises({ fetchFn, filters: { language: 'ES' } }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [], total: 0 });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/flagged/exercises?language=ES');
  });
});

describe('useResolveFlaggedExercise', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs the action and returns the outcome', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ outcome: 'approved' }));

    const { result } = renderHook(
      () => useResolveFlaggedExercise({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({ id: 'ex-1', action: 'approve' });
    });

    expect(outcome).toBe('approved');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/flagged/exercises/ex-1/approve');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
  });
});
