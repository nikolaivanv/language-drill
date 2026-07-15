import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Language } from '@language-drill/shared';
import { useTheoryTopic } from './use-theory-topic';

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

const VALID_TOPIC_JSON = {
  id: 'b1-test-topic',
  title: 'a small B1 theory topic',
  subtitle: 'test',
  cefr: 'B1',
  sections: [
    {
      id: 'overview',
      title: 'overview',
      body: [
        {
          kind: 'paragraph',
          text: [{ kind: 'text', text: 'A short paragraph.' }],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTheoryTopic', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('renders the DB-fetched topic on 200', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(VALID_TOPIC_JSON));

    const { result } = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'b1-test-topic',
          fetchFn,
        }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.topic).not.toBeNull());

    expect(result.current.topic?.id).toBe('b1-test-topic');
    expect(result.current.topic?.title).toBe('a small B1 theory topic');
    expect(result.current.isError).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/theory/ES/b1-test-topic');
  });

  it('surfaces 404 as { topic: null, isError: false }', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockRejectedValue(errorWithStatus('Topic not found', 404));

    const { result } = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'no-such-topic',
          fetchFn,
        }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.topic).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    // 4xx terminates retries — exactly one attempt.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces 500 as { topic: null, isError: true } (after one retry)', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockRejectedValue(errorWithStatus('Internal error', 500));

    const { result } = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'broken-topic',
          fetchFn,
        }),
      { wrapper: buildWrapper(queryClient) },
    );

    // TanStack Query's default retry delay is 1s for the first retry — give
    // waitFor enough headroom for the retry round-trip.
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });

    expect(result.current.topic).toBeNull();
    expect(result.current.error).not.toBeNull();
    // 5xx retries exactly once.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('surfaces parser failures as isError when API returns 200 with corrupt JSON', async () => {
    // Missing `sections` → parser throws. The thrown error has no `status`,
    // so the hook's retry policy treats it like a 5xx — one retry, then settle.
    const corrupt = { id: 'bad', title: 'bad', subtitle: 'bad', cefr: 'B1' };
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(corrupt));

    const { result } = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'corrupt-topic',
          fetchFn,
        }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });

    expect(result.current.topic).toBeNull();
    expect(result.current.error?.message).toMatch(/sections/);
  });

  it('returns { topic: null, isLoading: false } without fetchFn (graceful degradation)', () => {
    const { result } = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'b1-present-subjunctive',
        }),
      { wrapper: buildWrapper(queryClient) },
    );

    expect(result.current.topic).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('re-renders within staleTime window do not refetch', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(VALID_TOPIC_JSON));

    const wrapper = buildWrapper(queryClient);

    const first = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'b1-test-topic',
          fetchFn,
        }),
      { wrapper },
    );

    await waitFor(() => expect(first.result.current.topic).not.toBeNull());
    expect(fetchFn).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(
      () =>
        useTheoryTopic({
          language: Language.ES,
          topicId: 'b1-test-topic',
          fetchFn,
        }),
      { wrapper },
    );

    // Cache hit — topic available immediately, fetchFn count unchanged.
    await waitFor(() => expect(second.result.current.topic).not.toBeNull());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
