import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMe } from './useMe';
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

const ME_RESPONSE = {
  plan: 'boosted',
  isAdmin: true,
  limits: { evaluation: 100, annotation: 50, deepSpan: 25 },
  usageToday: { evaluation: 3, annotation: 1, deepSpan: 0 },
};

describe('useMe', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('fetches GET /me and parses the response', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(ME_RESPONSE));

    const { result } = renderHook(() => useMe({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/me');
    expect(result.current.data).toEqual(ME_RESPONSE);
  });

  it('does not call fetchFn when enabled: false', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(ME_RESPONSE));

    const { result } = renderHook(() => useMe({ fetchFn, enabled: false }), {
      wrapper: buildWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
