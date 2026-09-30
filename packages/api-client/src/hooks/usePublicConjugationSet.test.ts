import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePublicConjugationSet,
  usePublicConjugationPoints,
} from './usePublicConjugationSet';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const payload = {
  exercises: [
    {
      id: 'a',
      type: 'conjugation',
      language: 'TR',
      difficulty: 'B1',
      grammarPointKey: 'tr-b1-evidential',
      contentJson: { type: 'conjugation', lemma: 'gitmek', targetForm: 'gitmiş' },
    },
  ],
  available: 1,
  difficulty: 'B1',
};

describe('usePublicConjugationSet', () => {
  it('requests the public path with lang/level/count and parses the response', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));

    const { result } = renderHook(
      () =>
        usePublicConjugationSet({ lang: 'TR', level: 'B1', count: 10, fetchFn }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith(
      '/public/conjugation/set?lang=TR&level=B1&count=10',
    );
    expect(result.current.data?.available).toBe(1);
  });

  it('omits the count param when count is not provided', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));

    const { result } = renderHook(
      () => usePublicConjugationSet({ lang: 'ES', level: 'A2', fetchFn }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/public/conjugation/set?lang=ES&level=A2');
  });

  it('does not fetch while disabled', () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));
    renderHook(
      () => usePublicConjugationSet({ lang: 'ES', level: 'A2', fetchFn, enabled: false }),
      { wrapper: wrapper() },
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces a schema violation as an error', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ exercises: 'nope', available: -1 })),
    );
    const { result } = renderHook(
      () => usePublicConjugationSet({ lang: 'DE', level: 'A1', fetchFn }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('passes a grammar point through to the query string', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));
    const { result } = renderHook(
      () =>
        usePublicConjugationSet({
          lang: 'ES',
          level: 'B1',
          grammarPoint: 'es-b1-conditional',
          fetchFn,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-b1-conditional',
    );
  });

  it('keys a targeted sitting separately from the mixed one', async () => {
    // Same lang/level, different point — the cache must not serve one for the
    // other, which is what a queryKey missing `grammarPoint` would do.
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const a = renderHook(
      () => usePublicConjugationSet({ lang: 'ES', level: 'B1', fetchFn }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));

    const b = renderHook(
      () =>
        usePublicConjugationSet({
          lang: 'ES',
          level: 'B1',
          grammarPoint: 'es-b1-conditional',
          fetchFn,
        }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('usePublicConjugationPoints', () => {
  const pointsPayload = {
    points: [
      { key: 'es-b1-conditional', name: 'Conditional', category: 'tenses', order: 3, count: 12 },
    ],
    language: 'ES',
    difficulty: 'B1',
  };

  it('requests the points for a cell and parses them', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(pointsPayload)));
    const { result } = renderHook(
      () => usePublicConjugationPoints({ lang: 'ES', level: 'B1', fetchFn }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/public/conjugation/points?lang=ES&level=B1');
    expect(result.current.data?.points[0]?.name).toBe('Conditional');
  });

  it('surfaces a schema violation as an error', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ points: [{ key: 'x' }] })),
    );
    const { result } = renderHook(
      () => usePublicConjugationPoints({ lang: 'ES', level: 'B1', fetchFn }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
