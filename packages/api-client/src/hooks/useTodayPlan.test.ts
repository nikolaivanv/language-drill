import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { useTodayPlan } from './useTodayPlan';
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
    defaultOptions: { queries: { retry: false } },
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
// Canonical valid response payload
// ---------------------------------------------------------------------------

const TODAY_OK_PAYLOAD = {
  language: 'ES',
  generatedAt: '2026-05-04T12:00:00.000Z',
  totalEstimatedMinutes: 12,
  items: [
    {
      index: 1,
      type: 'cloze',
      topicHint: 'subjunctive',
      difficulty: 'B1',
      itemCount: 4,
      estimatedMinutes: 2,
      status: 'queued',
    },
    {
      index: 2,
      type: 'cloze',
      topicHint: 'pronoun-placement',
      difficulty: 'B1',
      itemCount: 4,
      estimatedMinutes: 2,
      status: 'queued',
    },
    {
      index: 3,
      type: 'translation',
      topicHint: null,
      difficulty: 'B1',
      itemCount: 1,
      estimatedMinutes: 4,
      status: 'queued',
    },
    {
      index: 4,
      type: 'vocab_recall',
      topicHint: 'food',
      difficulty: 'B1',
      itemCount: 6,
      estimatedMinutes: 2,
      status: 'queued',
    },
    {
      index: 5,
      type: 'cloze',
      topicHint: 'preterite',
      difficulty: 'B1',
      itemCount: 4,
      estimatedMinutes: 2,
      status: 'queued',
    },
  ],
  summary: null,
  code: null,
};

// ---------------------------------------------------------------------------
// useTodayPlan
// ---------------------------------------------------------------------------

describe('useTodayPlan', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('GETs /sessions/today with the language query param and returns parsed data', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(TODAY_OK_PAYLOAD));

    const { result } = renderHook(
      () => useTodayPlan({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/sessions/today?language=ES');
    expect(result.current.data?.language).toBe('ES');
    expect(result.current.data?.items).toHaveLength(5);
    expect(result.current.data?.totalEstimatedMinutes).toBe(12);
  });

  it('does not fire when enabled is false', () => {
    renderHook(
      () =>
        useTodayPlan({
          fetchFn,
          language: Language.ES,
          enabled: false,
        }),
      { wrapper: buildWrapper(queryClient) },
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses a language-scoped query key so switching languages refetches', async () => {
    fetchFn
      .mockResolvedValueOnce(
        jsonResponse({ ...TODAY_OK_PAYLOAD, language: 'ES' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...TODAY_OK_PAYLOAD, language: 'DE' }),
      );

    const { result, rerender } = renderHook(
      ({ language }: { language: Language.ES | Language.DE }) =>
        useTodayPlan({ fetchFn, language }),
      {
        wrapper: buildWrapper(queryClient),
        initialProps: { language: Language.ES },
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.language).toBe('ES');

    rerender({ language: Language.DE });
    await waitFor(() => expect(result.current.data?.language).toBe('DE'));

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/sessions/today?language=ES');
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/sessions/today?language=DE');
  });

  it('surfaces a Zod parse error when the server returns a malformed payload', async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({
        language: 'ES',
        generatedAt: 'not-a-date',
        totalEstimatedMinutes: 0,
        items: [],
        summary: null,
        code: null,
      }),
    );

    const { result } = renderHook(
      () => useTodayPlan({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
