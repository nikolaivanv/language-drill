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

  it('returns the static list (alpha-sorted by title) when DB returns []', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ topics: [] }));

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Static ES titles: 'el condicional' < 'el subjuntivo' < 'pretérito vs. imperfecto'
    expect(result.current.topics.map((t) => t.id)).toEqual([
      'conditional',
      'subjunctive',
      'preterite-imperfect',
    ]);
    expect(result.current.isError).toBe(false);
  });

  it('returns only the DB list (sorted) when the static registry is empty (DE)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'topic-b', title: 'b-title', cefr: 'B1' },
          { id: 'topic-a', title: 'a-title', cefr: 'B1' },
        ],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.DE, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topics).toHaveLength(2));

    expect(result.current.topics.map((t) => t.title)).toEqual([
      'a-title',
      'b-title',
    ]);
  });

  it('keeps the static entry on id collision (static wins)', async () => {
    // DB tries to override `subjunctive` with a different title — static must
    // take precedence per Req 5.2.
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'subjunctive', title: 'DB OVERRIDE — should NOT appear', cefr: 'B2' },
        ],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const subj = result.current.topics.find((t) => t.id === 'subjunctive');
    expect(subj?.title).toBe('el subjuntivo');
    expect(
      result.current.topics.some((t) => t.title.includes('DB OVERRIDE')),
    ).toBe(false);
    // Total = 3 static topics (DB override deduped).
    expect(result.current.topics).toHaveLength(3);
  });

  it('falls back to the static-only list when the DB query errors', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockRejectedValue(errorWithStatus('Internal error', 500));

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Static floor: the three ES topics still render.
    expect(result.current.topics.map((t) => t.id).sort()).toEqual(
      ['conditional', 'preterite-imperfect', 'subjunctive'].sort(),
    );
    expect(result.current.error).not.toBeNull();
  });

  it('returns the static list synchronously without fetchFn (graceful degradation)', () => {
    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.topics).toHaveLength(3);
    // Static-only result is still alpha-sorted by title.
    expect(result.current.topics.map((t) => t.id)).toEqual([
      'conditional',
      'subjunctive',
      'preterite-imperfect',
    ]);
  });

  it('sorts a mixed static + DB list by title across 4 sources', async () => {
    // DB contributes two new topics: 'aaa' (should sort first) and 'zzz'
    // (should sort last). Static contributes 'el condicional', 'el subjuntivo',
    // 'pretérito vs. imperfecto'. Total = 5 topics.
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'db-zzz', title: 'zzz-tail', cefr: 'B2' },
          { id: 'db-aaa', title: 'aaa-head', cefr: 'A2' },
        ],
      }),
    );

    const { result } = renderHook(
      () => useTheoryTopics({ language: Language.ES, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topics).toHaveLength(5));

    expect(result.current.topics.map((t) => t.title)).toEqual([
      'aaa-head',
      'el condicional',
      'el subjuntivo',
      'pretérito vs. imperfecto',
      'zzz-tail',
    ]);
  });
});
