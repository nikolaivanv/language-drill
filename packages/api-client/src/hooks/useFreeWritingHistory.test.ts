import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { useFreeWritingHistory, useFreeWritingAttempt } from './useFreeWritingHistory';
import { parseStoredFreeWritingEvaluation } from '../schemas/free-writing-history';
import type { AuthenticatedFetch } from '../fetchClient';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function buildQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const item = {
  id: 'sub-1', exerciseId: 'ex-1', evaluatedAt: '2026-10-01T10:00:00.000Z',
  language: 'ES', difficulty: 'B1', title: 'El teletrabajo', score: 0.72,
  overallCefr: 'B1', headline: 'h', wordCount: 180,
};

const evaluation = {
  overallScore: 0.72, overallCefr: 'B1', headline: 'h', summary: 's',
  criteria: [{ id: 'task', label: 'Task', score: 0.7, cefr: 'B1', note: 'n' }],
  errors: [], goodSpans: [], improved: { text: 'mejor' },
  wordCount: 180, improvedWordCount: 185,
};

describe('useFreeWritingHistory', () => {
  it('requests the language-scoped list and pages with the returned cursor', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [item], nextCursor: '2026-10-01T10:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ ...item, id: 'sub-2' }], nextCursor: null }));

    const { result } = renderHook(
      () => useFreeWritingHistory({ language: Language.ES, fetchFn }),
      { wrapper: wrapperFor(buildQueryClient()) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/free-writing/history?language=ES');
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      '/free-writing/history?language=ES&cursor=2026-10-01T10%3A00%3A00.000Z',
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.flatMap((p) => p.items).map((i) => i.id)).toEqual([
      'sub-1',
      'sub-2',
    ]);
  });
});

describe('useFreeWritingAttempt', () => {
  it('fetches one attempt and keeps its evaluation unparsed', async () => {
    const attempt = {
      id: 'sub-1', exerciseId: 'ex-1', evaluatedAt: '2026-10-01T10:00:00.000Z',
      language: 'ES', difficulty: 'B1', content: { title: 't' },
      userAnswer: 'Mi ensayo', evaluation: { legacy: true },
    };
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(jsonResponse(attempt));

    const { result } = renderHook(
      () => useFreeWritingAttempt({ submissionId: 'sub-1', fetchFn }),
      { wrapper: wrapperFor(buildQueryClient()) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/free-writing/history/sub-1');
    expect(result.current.data?.evaluation).toEqual({ legacy: true });
  });
});

describe('parseStoredFreeWritingEvaluation', () => {
  it('returns the evaluation when it matches the current schema', () => {
    expect(parseStoredFreeWritingEvaluation(evaluation)?.overallScore).toBe(0.72);
  });

  it('returns null for an outdated or missing evaluation', () => {
    expect(parseStoredFreeWritingEvaluation(null)).toBeNull();
    expect(parseStoredFreeWritingEvaluation({ ...evaluation, improved: 'stringified' })).toBeNull();
  });
});
