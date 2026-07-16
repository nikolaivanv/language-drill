import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReadAudio } from './useReadAudio';
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
// useReadAudio
// ---------------------------------------------------------------------------

describe('useReadAudio', () => {
  it('POSTs to /read/:entryId/audio and parses the response', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({
          audioUrl: 'https://signed/x.mp3',
          durationSec: 12,
          reason: 'ok',
        }),
      );

    const { result } = renderHook(() => useReadAudio({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    result.current.mutate({ entryId: 'e1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledWith('/read/e1/audio', { method: 'POST' });
    expect(result.current.data).toEqual({
      audioUrl: 'https://signed/x.mp3',
      durationSec: 12,
      reason: 'ok',
    });
  });

  it('rejects when the response body fails Zod validation', async () => {
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ bad: 'shape' }));

    const { result } = renderHook(() => useReadAudio({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({ entryId: 'e1' }),
    ).rejects.toThrow();
  });
});
