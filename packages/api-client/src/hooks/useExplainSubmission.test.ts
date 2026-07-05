import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useExplainSubmission } from './useExplainSubmission';
import type { AuthenticatedFetch } from '../fetchClient';
import { vi } from 'vitest';

/**
 * These tests exercise `useExplainSubmission` end-to-end through a real
 * `QueryClientProvider` so the request URL/method and the Zod response parse
 * are locked down at the hook boundary. The single mocked seam is
 * `fetchFn: AuthenticatedFetch`, matching the harness style used by
 * `useDebrief.test.ts` / `useSubmitFreeWriting.ts`.
 */

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
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

describe('useExplainSubmission', () => {
  it('POSTs to the explain endpoint and returns the parsed explanation', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({ explanation: 'because koy- takes -du' }),
      );
    const queryClient = buildQueryClient();

    const { result } = renderHook(() => useExplainSubmission({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const value = await result.current.mutateAsync({
      exerciseId: 'ex-1',
      submissionId: 'sub-1',
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      '/exercises/ex-1/submissions/sub-1/explain',
    );
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');

    expect(value).toEqual({ explanation: 'because koy- takes -du' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      explanation: 'because koy- takes -du',
    });
  });

  it('throws on a malformed response body', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ nope: true }));
    const queryClient = buildQueryClient();

    const { result } = renderHook(() => useExplainSubmission({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({
        exerciseId: 'ex-1',
        submissionId: 'sub-1',
      }),
    ).rejects.toThrow();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
