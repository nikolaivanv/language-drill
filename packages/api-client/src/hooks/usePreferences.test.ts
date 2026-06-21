import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  useGetPreferences,
  useUpdateLanguages,
  useUpdatePreferences,
} from './usePreferences';
import type { AuthenticatedFetch } from '../fetchClient';

/**
 * These tests exercise the `usePreferences` hooks end-to-end through a real
 * `QueryClientProvider` so the wire-payload build (R3.8 / R7.1), the notes
 * normalisation (R4.6), and the cache invalidation (R9.4) are all locked
 * down at the hook boundary.
 *
 * The single mocked seam is `fetchFn: AuthenticatedFetch` — the hooks call
 * exactly one network function, so we capture every request through it and
 * assert on the body / URL / method directly. We do not mock TanStack Query.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a `Response`-shaped object good enough for the hook: it only ever
 * calls `.json()` on a 2xx response. We never return `!ok` from here — 4xx
 * paths are simulated by making the mocked `fetchFn` throw, mirroring what
 * `createAuthenticatedFetch` does in `fetchClient.ts` (it throws an `Error`
 * with `.status` and `.body` attached).
 */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function buildQueryClient(): QueryClient {
  // `retry: false` is essential — otherwise TanStack Query retries failed
  // mutations/queries 3× by default, slowing every "rejects" assertion.
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
// useGetPreferences
// ---------------------------------------------------------------------------

describe('useGetPreferences — enabled flag', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('does not call fetchFn when enabled: false', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(
        jsonResponse({
          primaryLanguage: 'ES',
          goals: [],
          dailyMinutes: 10,
          gentleNudges: true,
          notes: '',
          dailyGoal: 'medium',
        }),
      );

    const { result } = renderHook(
      () => useGetPreferences({ fetchFn, enabled: false }),
      { wrapper: buildWrapper(queryClient) },
    );

    // Give TanStack Query a tick to confirm the queryFn was suppressed.
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('calls fetchFn and resolves data when enabled (default true)', async () => {
    const responseBody = {
      primaryLanguage: 'DE',
      goals: ['grammar', 'speaking'],
      dailyMinutes: 20,
      gentleNudges: false,
      notes: 'taking notes',
      dailyGoal: 'long',
    };
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(responseBody));

    const { result } = renderHook(() => useGetPreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/preferences');
    expect(result.current.data).toEqual(responseBody);
  });
});

// ---------------------------------------------------------------------------
// useUpdateLanguages
// ---------------------------------------------------------------------------

describe('useUpdateLanguages', () => {
  it('PUTs the profiles array + primaryLanguage and invalidates caches', async () => {
    const queryClient = buildQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
        primaryLanguage: 'ES',
      }),
    );

    const { result } = renderHook(() => useUpdateLanguages({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
        primaryLanguage: Language.ES,
      });
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/languages');
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['languageProfiles'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['preferences'] });
  });
});

// ---------------------------------------------------------------------------
// useUpdatePreferences
// ---------------------------------------------------------------------------

describe('useUpdatePreferences', () => {
  it('PATCHes only the provided fields and invalidates preferences', async () => {
    const queryClient = buildQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        primaryLanguage: 'ES',
        goals: ['vocab'],
        dailyMinutes: 30,
        gentleNudges: true,
        notes: '',
        dailyGoal: 'quick',
      }),
    );

    const { result } = renderHook(() => useUpdatePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ dailyMinutes: 30, goals: ['vocab'] });
    });

    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/preferences');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      dailyMinutes: 30,
      goals: ['vocab'],
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['preferences'] });
  });
});
