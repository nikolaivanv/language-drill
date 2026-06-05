import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language, ReadingTextLength } from '@language-drill/shared';
import { useGenerateReadingText } from './useGenerateReadingText';
import type { AuthenticatedFetch } from '../fetchClient';

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
// useGenerateReadingText
// ---------------------------------------------------------------------------

describe('useGenerateReadingText', () => {
  it('POSTs to /read/generate and parses the response', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({
          title: 'Kedi',
          text: 'Kedi pazarda.',
          cefr: 'A2',
          difficultyScore: 0.1,
          fromCache: false,
          runsHard: false,
        }),
      );

    const { result } = renderHook(
      () => useGenerateReadingText({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    result.current.mutate({ language: Language.TR, cefr: CefrLevel.A2, length: ReadingTextLength.SHORT, topic: 'a cat' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledWith(
      '/read/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.data?.text).toBe('Kedi pazarda.');
  });

  it('rejects when the response body fails Zod validation', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ bad: 'shape' }));

    const { result } = renderHook(
      () => useGenerateReadingText({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    await expect(
      result.current.mutateAsync({ language: Language.TR, cefr: CefrLevel.A2, length: ReadingTextLength.SHORT, topic: 'cats' }),
    ).rejects.toThrow();
  });

  it('sends the request body as JSON-stringified input', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({
          title: 'Test',
          text: 'Test text.',
          cefr: CefrLevel.B1,
          difficultyScore: 0.5,
          fromCache: true,
          runsHard: false,
        }),
      );

    const { result } = renderHook(
      () => useGenerateReadingText({ fetchFn }),
      { wrapper: buildWrapper(queryClient) },
    );

    result.current.mutate({ language: Language.ES, cefr: CefrLevel.B1, length: ReadingTextLength.MEDIUM, topic: 'food' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      language: Language.ES,
      cefr: CefrLevel.B1,
      length: ReadingTextLength.MEDIUM,
      topic: 'food',
    });
  });
});
