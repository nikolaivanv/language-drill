import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePublicConjugationSet } from './usePublicConjugationSet';

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
});
