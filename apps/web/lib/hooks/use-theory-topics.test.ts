import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Language } from '@language-drill/shared';
import { useTheoryTopics } from './use-theory-topics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function errorWithStatus(message: string, status: number): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
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
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTheoryTopics', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('returns [] synchronously without fetchFn (graceful degradation)', () => {
    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.topics).toEqual([]);
  });

  it('returns the DB list alpha-sorted by title', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'db-zzz', title: 'zzz-tail', cefr: 'B2' },
          { id: 'db-mmm', title: 'mmm-middle', cefr: 'B1' },
          { id: 'db-aaa', title: 'aaa-head', cefr: 'A2' },
        ],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topics).toHaveLength(3));

    expect(result.current.topics.map((t) => t.title)).toEqual([
      'aaa-head',
      'mmm-middle',
      'zzz-tail',
    ]);
    expect(result.current.isError).toBe(false);
  });

  it('returns [] when DB returns []', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ topics: [] }));

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.topics).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('surfaces the error and an empty list when the DB query errors', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockRejectedValue(errorWithStatus('Internal error', 500));

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.topics).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it('carries category + order through from DB topics', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [
          {
            id: 'topic-tenses',
            title: 'compound tenses',
            cefr: 'B2',
            category: 'tenses',
            order: 7,
          },
        ],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.DE, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topics).toHaveLength(1));

    expect(result.current.topics[0]).toMatchObject({
      id: 'topic-tenses',
      category: 'tenses',
      order: 7,
    });
  });

  it("defaults DB topics lacking category/order to 'other'/null (legacy payload)", async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [{ id: 'topic-legacy', title: 'legacy', cefr: 'B1' }],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.DE, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topics).toHaveLength(1));

    expect(result.current.topics[0].category).toBe('other');
    expect(result.current.topics[0].order).toBeNull();
  });
});
