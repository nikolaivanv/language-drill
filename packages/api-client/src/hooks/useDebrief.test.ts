import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionDebrief } from './useDebrief';
import type { AuthenticatedFetch } from '../fetchClient';

/**
 * These tests exercise `useSessionDebrief` end-to-end through a real
 * `QueryClientProvider` so the request URL/method, the Zod response parse,
 * and the `staleTime: Infinity` cache behavior are all locked down at the
 * hook boundary (Req 2.1, NFR Reliability).
 *
 * The single mocked seam is `fetchFn: AuthenticatedFetch`.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_EVALUATION = {
  score: 0.85,
  grammarAccuracy: 0.9,
  vocabularyRange: 'B1',
  taskAchievement: 0.8,
  feedback: 'Solid attempt — minor verb form slip.',
  errors: [],
  estimatedCefrEvidence: 'B1',
};

const SAMPLE_RESPONSE = {
  id: '11111111-2222-3333-4444-555555555555',
  language: 'ES',
  difficulty: 'B1',
  startedAt: '2026-05-04T10:00:00.000Z',
  completedAt: '2026-05-04T10:04:38.000Z',
  durationSeconds: 278,
  exerciseCount: 5,
  correctCount: 3,
  attemptedCount: 4,
  skippedCount: 1,
  items: [
    {
      exerciseId: 'aaaaaaaa-1111-4111-8111-111111111111',
      type: 'cloze',
      contentJson: { instructions: 'Fill in', sentence: 'Yo ___ libros' },
      status: 'correct',
      userAnswer: 'leo',
      score: 0.95,
      evaluation: SAMPLE_EVALUATION,
    },
    {
      exerciseId: 'bbbbbbbb-2222-4222-8222-222222222222',
      type: 'translation',
      contentJson: {
        instructions: 'Translate',
        sourceText: 'I am hungry',
        referenceTranslation: 'tengo hambre',
      },
      status: 'skipped',
      userAnswer: null,
      score: null,
      evaluation: null,
    },
  ],
};

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

// ---------------------------------------------------------------------------
// useSessionDebrief — request shape
// ---------------------------------------------------------------------------

describe('useSessionDebrief — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('GETs /sessions/:sessionId/debrief with the templated URL', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`/sessions/${SESSION_ID}/debrief`);

    // No init arg passed → defaults to GET (no method override).
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBeUndefined();
  });

  it('does NOT fetch when enabled is false', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(
      () =>
        useSessionDebrief({ sessionId: SESSION_ID, fetchFn, enabled: false }),
      { wrapper: buildWrapper(queryClient) },
    );

    // Wait one microtask cycle to ensure no fetch is dispatched.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useSessionDebrief — response parsing
// ---------------------------------------------------------------------------

describe('useSessionDebrief — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed DebriefResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe(SAMPLE_RESPONSE.id);
    expect(result.current.data?.language).toBe('ES');
    expect(result.current.data?.items).toHaveLength(2);
    expect(result.current.data?.items[0]?.status).toBe('correct');
    expect(result.current.data?.items[1]?.status).toBe('skipped');
  });

  it('rejects when the response body fails Zod validation', async () => {
    // `id` is not a UUID — schema rejects.
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({ ...SAMPLE_RESPONSE, id: 'not-a-uuid' }),
      );

    const { result } = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useSessionDebrief — error propagation
// ---------------------------------------------------------------------------

describe('useSessionDebrief — error propagation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('exposes the server-side error when fetchFn throws on 4xx', async () => {
    const serverError = new Error('Session not found');
    (serverError as unknown as { status: number }).status = 404;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Session not found');
  });

  it('exposes a generic 5xx network failure', async () => {
    const networkError = new Error('Request failed: 500');
    (networkError as unknown as { status: number }).status = 500;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(networkError);

    const { result } = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Request failed: 500');
  });
});

// ---------------------------------------------------------------------------
// useSessionDebrief — caching (staleTime: Infinity)
// ---------------------------------------------------------------------------

describe('useSessionDebrief — caching', () => {
  it('does not refetch on remount within the same QueryClient', async () => {
    // staleTime: Infinity means a successful query is served from cache on
    // subsequent mounts of the same hook+key, with no network call (NFR
    // Reliability — completedAt-keyed responses are immutable).
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    // First mount: fetches once.
    const first = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    first.unmount();

    // Second mount with the same QueryClient + sessionId: no new fetch.
    const second = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.result.current.data?.id).toBe(SAMPLE_RESPONSE.id);
  });

  it('refetches when sessionId changes (different cache key)', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValueOnce(jsonResponse(SAMPLE_RESPONSE))
      .mockResolvedValueOnce(
        jsonResponse({
          ...SAMPLE_RESPONSE,
          id: '99999999-9999-4999-8999-999999999999',
        }),
      );

    const first = renderHook(
      () => useSessionDebrief({ sessionId: SESSION_ID, fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(
      () =>
        useSessionDebrief({
          sessionId: '99999999-9999-4999-8999-999999999999',
          fetchFn,
        }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(second.result.current.data?.id).toBe(
      '99999999-9999-4999-8999-999999999999',
    );
  });
});
