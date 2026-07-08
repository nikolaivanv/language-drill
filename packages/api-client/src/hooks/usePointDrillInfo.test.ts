import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import { usePointDrillInfo } from './usePointDrillInfo';

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

const DRILL_INFO = {
  grammarPointKey: 'es-a2-ser-vs-estar',
  exerciseCounts: { cloze: 12, translation: 8 },
  mastery: {
    masteryScore: 0.82,
    confidence: 0.9,
    evidenceCount: 10,
    lastPracticedAt: '2026-07-01T00:00:00.000Z',
  },
};

describe('usePointDrillInfo', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('fetches /progress/points/:key and parses the response', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(jsonResponse(DRILL_INFO));

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a2-ser-vs-estar' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DRILL_INFO);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/progress/points/es-a2-ser-vs-estar');
  });

  it('parses a never-practiced point (mastery: null, empty counts)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({ grammarPointKey: 'es-a1-noun-gender', exerciseCounts: {}, mastery: null }),
    );

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a1-noun-gender' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mastery).toBeNull();
  });

  it('rejects a malformed payload (schema mismatch surfaces as query error)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({ topics: [] }),
    );

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a2-ser-vs-estar' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
