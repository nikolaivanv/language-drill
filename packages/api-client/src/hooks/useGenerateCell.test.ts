import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import { useGenerateCell } from './useGenerateCell';

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

describe('useGenerateCell', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs the cell + count and returns the queued job', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ jobId: 'job-1', status: 'queued' }));

    const { result } = renderHook(
      () => useGenerateCell({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let out: { jobId: string; status: 'queued' } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 });
    });

    expect(out).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(fetchFn).toHaveBeenCalledWith('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 }),
    });
  });

  it('propagates a 409 error from fetchFn', async () => {
    const err = Object.assign(new Error('in progress'), { status: 409 });
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(err);

    const { result } = renderHook(
      () => useGenerateCell({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await expect(
      result.current.mutateAsync({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
