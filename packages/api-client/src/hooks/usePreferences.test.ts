import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  useGetPreferences,
  useSavePreferences,
  type SavePreferencesArgs,
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

/** Successful PUT response shape echoed by the Lambda handler (task 7). */
const PUT_OK_RESPONSE = {
  profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
  preferences: {
    primaryLanguage: 'ES',
    goals: ['grammar'],
    dailyMinutes: 10,
    gentleNudges: true,
    notes: '',
  },
};

/** Convenience: pulls the captured JSON body of the first fetch call. */
function readPutBody(
  fetchFn: Mock<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>,
): Record<string, unknown> {
  const init = fetchFn.mock.calls[0]?.[1];
  expect(init).toBeDefined();
  expect(init?.method).toBe('PUT');
  expect(typeof init?.body).toBe('string');
  return JSON.parse(init!.body as string) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// useSavePreferences
// ---------------------------------------------------------------------------

describe('useSavePreferences — wire payload build', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('builds profiles[] with a single primary language at the chosen level', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(jsonResponse(PUT_OK_RESPONSE));

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: ['grammar'],
      notes: '',
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/languages');

    const body = readPutBody(fetchFn);
    expect(body['profiles']).toEqual([
      { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
    ]);
    expect(body['primaryLanguage']).toBe(Language.ES);
    expect(body['goals']).toEqual(['grammar']);
    expect(body['dailyMinutes']).toBe(10);
    expect(body['gentleNudges']).toBe(true);
    expect(body['notes']).toBe('');
  });

  it('fills non-primary selected languages with proficiencyLevel A1 (R3.8)', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(
        jsonResponse({
          profiles: [
            { language: 'ES', proficiencyLevel: 'A1' },
            { language: 'DE', proficiencyLevel: 'C1' },
            { language: 'TR', proficiencyLevel: 'A1' },
          ],
          preferences: {
            primaryLanguage: 'DE',
            goals: [],
            dailyMinutes: 20,
            gentleNudges: true,
            notes: '',
          },
        }),
      );

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const args: SavePreferencesArgs = {
      // Selection order is preserved on the wire so the UI stays consistent.
      languages: [Language.ES, Language.DE, Language.TR],
      primaryLanguage: Language.DE,
      primaryLevel: CefrLevel.C1,
      goals: [],
      notes: '',
      dailyMinutes: 20,
      gentleNudges: true,
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    const body = readPutBody(fetchFn);
    expect(body['profiles']).toEqual([
      { language: Language.ES, proficiencyLevel: CefrLevel.A1 },
      { language: Language.DE, proficiencyLevel: CefrLevel.C1 },
      { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
    ]);
    expect(body['primaryLanguage']).toBe(Language.DE);
  });
});

describe('useSavePreferences — notes normalisation (R4.6)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('converts CRLF to LF and trims surrounding whitespace before sending', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(jsonResponse(PUT_OK_RESPONSE));

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: [],
      notes: '  hello\r\nworld  ',
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    const body = readPutBody(fetchFn);
    expect(body['notes']).toBe('hello\nworld');
  });

  it('accepts notes that are exactly 500 chars after trim', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(jsonResponse(PUT_OK_RESPONSE));

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    // 502 raw -> 500 after trim: at the limit, must succeed.
    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: [],
      notes: ` ${'x'.repeat(500)} `,
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    const body = readPutBody(fetchFn);
    expect(body['notes']).toBe('x'.repeat(500));
    expect((body['notes'] as string).length).toBe(500);
  });

  it('rejects notes that are 501 chars after trim (validation runs post-trim)', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(jsonResponse(PUT_OK_RESPONSE));

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    // 503 raw -> 501 after trim: just over the limit.
    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: [],
      notes: ` ${'x'.repeat(501)} `,
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await expect(result.current.mutateAsync(args)).rejects.toThrow();

    // Critical: the network was never hit because Zod rejected the payload
    // before the PUT could fire.
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('useSavePreferences — error propagation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('rethrows the server-side message when fetchFn throws on 4xx', async () => {
    // `createAuthenticatedFetch` (fetchClient.ts) builds a plain `Error`
    // whose `.message` is the parsed `error` field from the JSON body, then
    // attaches `.status` and `.body`. We mirror that exactly so this test
    // tracks the real production behaviour rather than a fictional ApiError.
    const serverError = new Error('Invalid request body');
    (serverError as unknown as { status: number }).status = 400;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
    };

    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockRejectedValue(serverError);

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: [],
      notes: '',
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await expect(result.current.mutateAsync(args)).rejects.toThrow(
      'Invalid request body',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('useSavePreferences — cache invalidation (R9.4)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('invalidates both ["languageProfiles"] and ["preferences"] on 2xx success', async () => {
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(jsonResponse(PUT_OK_RESPONSE));

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSavePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const args: SavePreferencesArgs = {
      languages: [Language.ES],
      primaryLanguage: Language.ES,
      primaryLevel: CefrLevel.B2,
      goals: ['grammar'],
      notes: '',
      dailyMinutes: 10,
      gentleNudges: true,
    };

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    // Both keys must be invalidated, in either order. We assert both calls
    // exist by their queryKey filter rather than position.
    const calledKeys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown }).queryKey,
    );
    expect(calledKeys).toEqual(
      expect.arrayContaining([['languageProfiles'], ['preferences']]),
    );
    // Exactly two invalidations — guard against accidentally invalidating
    // unrelated caches.
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});

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
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
      .mockResolvedValue(
        jsonResponse({
          primaryLanguage: 'ES',
          goals: [],
          dailyMinutes: 10,
          gentleNudges: true,
          notes: '',
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
    };
    const fetchFn = vi
      .fn<Parameters<AuthenticatedFetch>, ReturnType<AuthenticatedFetch>>()
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
