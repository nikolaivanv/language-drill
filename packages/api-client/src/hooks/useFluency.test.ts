import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { useFluencyStats, useFluencySession, useSubmitFluencyAttempt } from './useFluency';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Helpers — mirror useProgress.test.ts's pattern
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
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ---------------------------------------------------------------------------
// useFluencyStats
// ---------------------------------------------------------------------------

const STATS_OK_PAYLOAD = {
  language: 'ES',
  totalAttempts: 0,
  overallAccuracy: 0,
  overallMedianLatencyMs: null,
  weeks: [],
};

describe('useFluencyStats', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('GETs /fluency/stats with the language query param and returns parsed data', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(STATS_OK_PAYLOAD));

    const { result } = renderHook(
      () => useFluencyStats({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/fluency/stats?language=ES');
    expect(result.current.data?.language).toBe('ES');
    expect(result.current.data?.weeks).toHaveLength(0);
    expect(result.current.data?.overallMedianLatencyMs).toBeNull();
  });

  it('does not fire when enabled is false', () => {
    renderHook(
      () => useFluencyStats({ fetchFn, language: Language.ES, enabled: false }),
      { wrapper: buildWrapper(queryClient) },
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useFluencySession
// ---------------------------------------------------------------------------

describe('useFluencySession', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('POSTs /fluency/session with JSON-stringified body', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ language: 'ES', exercises: [] }));

    const { result } = renderHook(
      () => useFluencySession({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync({ language: Language.ES });
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/fluency/session');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init!.body as string)).toEqual({ language: Language.ES });
  });

  it('returns parsed FluencySessionResponse', async () => {
    const payload = { language: 'ES', exercises: [] };
    fetchFn.mockResolvedValueOnce(jsonResponse(payload));

    const { result } = renderHook(
      () => useFluencySession({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync({ language: Language.ES });
    });

    expect(parsed!.language).toBe('ES');
    expect(parsed!.exercises).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// useSubmitFluencyAttempt
// ---------------------------------------------------------------------------

describe('useSubmitFluencyAttempt', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('POSTs /fluency/attempts with JSON-stringified body', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ correct: true, correctAnswer: 'está', latencyMs: 100 }));

    const { result } = renderHook(
      () => useSubmitFluencyAttempt({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    const input = {
      exerciseId: '00000000-0000-0000-0000-000000000000',
      answer: 'está',
      latencyMs: 100,
    };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/fluency/attempts');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual(input);
  });

  it('returns parsed FluencyAttemptResponse', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ correct: false, correctAnswer: 'fue', latencyMs: 800 }));

    const { result } = renderHook(
      () => useSubmitFluencyAttempt({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync({
        exerciseId: '00000000-0000-0000-0000-000000000000',
        answer: 'iba',
        latencyMs: 800,
      });
    });

    expect(parsed!.correct).toBe(false);
    expect(parsed!.correctAnswer).toBe('fue');
    expect(parsed!.latencyMs).toBe(800);
  });
});
