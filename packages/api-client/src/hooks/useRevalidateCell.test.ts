import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import { useRevalidateCell } from './useRevalidateCell';

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

const summary = {
  apply: false,
  scanned: 2,
  noChange: 1,
  demotedToFlagged: 1,
  demotedToRejected: 0,
  skipped: 0,
  skipReasons: {},
  estCostUsd: 0.01,
  truncated: false,
  totalCandidates: 2,
  demotions: [{ id: 'e1', from: 'auto-approved', to: 'flagged', reasons: ['Ambiguous'] }],
};

describe('useRevalidateCell', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('posts the body to /admin/revalidate and parses the summary', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(jsonResponse(summary));

    const { result } = renderHook(
      () => useRevalidateCell({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let out: typeof summary | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        language: 'TR',
        level: 'A1',
        type: 'cloze',
        grammarPoint: 'tr-a1-vowel-harmony',
        apply: false,
      });
    });

    expect(out).toEqual(summary);
    expect(fetchFn).toHaveBeenCalledWith('/admin/revalidate', {
      method: 'POST',
      body: JSON.stringify({
        language: 'TR',
        level: 'A1',
        type: 'cloze',
        grammarPoint: 'tr-a1-vowel-harmony',
        apply: false,
      }),
    });
  });

  it('propagates an error from fetchFn', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(err);

    const { result } = renderHook(
      () => useRevalidateCell({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await expect(
      result.current.mutateAsync({
        language: 'TR',
        level: 'A1',
        type: 'cloze',
        grammarPoint: 'tr-a1-vowel-harmony',
        apply: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
