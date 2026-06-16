import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
} from './useContentBrowser';

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

describe('useContentExercises', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('builds the URL with filters, q, limit, offset', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ items: [], total: 0 }));

    const { result } = renderHook(
      () => useContentExercises({ fetchFn, params: { language: 'ES', q: 'lo', limit: 25, offset: 50 } }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/content/exercises?language=ES&q=lo&limit=25&offset=50');
  });
});

describe('useContentTheory', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('builds the theory URL', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ items: [], total: 0 }));

    const { result } = renderHook(
      () => useContentTheory({ fetchFn, params: { language: 'DE' } }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/content/theory?language=DE');
  });
});

describe('useResolveContentExercise', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs demote and returns the outcome', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ outcome: 'demoted' }));

    const { result } = renderHook(
      () => useResolveContentExercise({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({ id: 'ex-1', action: 'demote' });
    });

    expect(outcome).toBe('demoted');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/content/exercises/ex-1/demote');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
  });
});

describe('useResolveContentTheory', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs reject and returns the outcome', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ outcome: 'rejected' }));

    const { result } = renderHook(
      () => useResolveContentTheory({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({ id: 'th-1', action: 'reject' });
    });

    expect(outcome).toBe('rejected');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/content/theory/th-1/reject');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
  });
});
