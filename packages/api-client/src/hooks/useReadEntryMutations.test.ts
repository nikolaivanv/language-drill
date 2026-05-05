import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  useSaveReadEntry,
  useUpdateReadBank,
} from './useReadEntryMutations';
import type {
  ReadEntryResponse,
  SaveReadEntryRequest,
  UpdateBankResponse,
} from '../schemas/read';
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

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const ISO = '2026-05-04T08:00:00.000Z';

const VALID_FLAG = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'small village',
  example: 'Visitamos la aldea ayer.',
  freq: 4200,
  cefr: CefrLevel.B2,
};

const SAVE_INPUT: SaveReadEntryRequest = {
  language: Language.ES,
  title: 'aldea',
  source: 'El País',
  text: 'La aldea recibió al pintor con cierta indiferencia.',
  flagged: { aldea: VALID_FLAG },
  bank: ['aldea'],
};

const SAVE_RESPONSE = {
  id: VALID_UUID,
  pastedAt: ISO,
};

// ---------------------------------------------------------------------------
// useSaveReadEntry — request shape
// ---------------------------------------------------------------------------

describe('useSaveReadEntry — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /read/entries with the JSON-stringified body', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAVE_RESPONSE));

    const { result } = renderHook(() => useSaveReadEntry({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(SAVE_INPUT);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/read/entries');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      language: Language.ES,
      title: 'aldea',
      source: 'El País',
      text: SAVE_INPUT.text,
      flagged: SAVE_INPUT.flagged,
      bank: ['aldea'],
    });
  });
});

// ---------------------------------------------------------------------------
// useSaveReadEntry — response parsing + cache writes
// ---------------------------------------------------------------------------

describe('useSaveReadEntry — response parsing and cache effects', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response and primes the single-entry cache with the ephemeral entry', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAVE_RESPONSE));

    const { result } = renderHook(() => useSaveReadEntry({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(SAVE_INPUT);
    });

    // The ephemeral entry was written through to ['readEntry', id] so the
    // page can switch to the annotated view without a round-trip.
    const cached = queryClient.getQueryData<ReadEntryResponse>([
      'readEntry',
      VALID_UUID,
    ]);
    expect(cached).toBeDefined();
    expect(cached?.id).toBe(VALID_UUID);
    expect(cached?.language).toBe(Language.ES);
    expect(cached?.flaggedWords.aldea?.lemma).toBe('aldea');
    expect(cached?.bank).toEqual(['aldea']);
    expect(cached?.pastedAt).toBe(ISO);
  });

  it('invalidates ["readEntries", language] on success so the list re-fetches', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAVE_RESPONSE));

    // Seed the cache with a stale list so we can observe invalidation.
    queryClient.setQueryData(['readEntries', Language.ES], { entries: [] });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSaveReadEntry({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(SAVE_INPUT);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['readEntries', Language.ES],
    });
  });

  it('rejects when the response body fails Zod validation', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ id: 'not-a-uuid', pastedAt: ISO }));

    const { result } = renderHook(() => useSaveReadEntry({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAVE_INPUT)).rejects.toThrow();
    // No cache write on parse failure.
    expect(
      queryClient.getQueryData(['readEntry', VALID_UUID]),
    ).toBeUndefined();
  });

  it('surfaces the server-side error on 4xx', async () => {
    const serverError = new Error('Validation failed');
    (serverError as unknown as { status: number }).status = 400;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useSaveReadEntry({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAVE_INPUT)).rejects.toThrow(
      'Validation failed',
    );
  });
});

// ---------------------------------------------------------------------------
// useUpdateReadBank — request shape + happy path
// ---------------------------------------------------------------------------

const SEEDED_ENTRY: ReadEntryResponse = {
  id: VALID_UUID,
  language: Language.ES,
  title: 'aldea',
  source: '',
  text: 'La aldea recibió al pintor.',
  flaggedWords: { aldea: VALID_FLAG, indiferencia: { ...VALID_FLAG, lemma: 'indiferencia', gloss: 'indifference' } },
  bank: ['aldea'],
  pastedAt: ISO,
};

describe('useUpdateReadBank — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
    queryClient.setQueryData(['readEntry', VALID_UUID], SEEDED_ENTRY);
  });

  it('PUTs to /read/entries/:id/bank with { bank } only', async () => {
    const updateResponse: UpdateBankResponse = {
      id: VALID_UUID,
      bank: ['aldea', 'indiferencia'],
    };
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(updateResponse));

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: ['aldea', 'indiferencia'],
      });
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      `/read/entries/${VALID_UUID}/bank`,
    );
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    // Only `bank` is sent; the `language` and `id` params are routing/cache
    // bookkeeping, not part of the wire body.
    expect(JSON.parse(init!.body as string)).toEqual({
      bank: ['aldea', 'indiferencia'],
    });
  });
});

// ---------------------------------------------------------------------------
// useUpdateReadBank — optimistic update
// ---------------------------------------------------------------------------

describe('useUpdateReadBank — optimistic update + rollback', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
    queryClient.setQueryData(['readEntry', VALID_UUID], SEEDED_ENTRY);
  });

  it('writes the optimistic bank to the cache before the request resolves', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchFn = vi.fn<AuthenticatedFetch>(() => fetchPromise);

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    // Fire the mutation but don't await it yet — fetch is pending.
    let mutationPromise!: Promise<UpdateBankResponse>;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: ['aldea', 'indiferencia'],
      });
    });

    // Wait until the optimistic onMutate has run.
    await waitFor(() => {
      const entry = queryClient.getQueryData<ReadEntryResponse>([
        'readEntry',
        VALID_UUID,
      ]);
      expect(entry?.bank).toEqual(['aldea', 'indiferencia']);
    });

    // Resolve the network call so React Query can settle.
    resolveFetch(
      jsonResponse({ id: VALID_UUID, bank: ['aldea', 'indiferencia'] }),
    );
    await act(async () => {
      await mutationPromise;
    });

    // After settle, the cache is still the optimistic shape (server agrees).
    const settled = queryClient.getQueryData<ReadEntryResponse>([
      'readEntry',
      VALID_UUID,
    ]);
    expect(settled?.bank).toEqual(['aldea', 'indiferencia']);
  });

  it('rolls back to the snapshot on error', async () => {
    const serverError = new Error('Bank update failed');
    (serverError as unknown as { status: number }).status = 500;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: ['aldea', 'indiferencia'],
      }),
    ).rejects.toThrow('Bank update failed');

    // Cache should match the original seeded entry — bank back to ['aldea'].
    const rolled = queryClient.getQueryData<ReadEntryResponse>([
      'readEntry',
      VALID_UUID,
    ]);
    expect(rolled?.bank).toEqual(['aldea']);
    expect(rolled?.id).toBe(VALID_UUID);
  });

  it('does not crash when the cache is empty (fresh page load before LOAD_ENTRY)', async () => {
    // Reset cache so there's no prior entry.
    queryClient.removeQueries({ queryKey: ['readEntry', VALID_UUID] });

    const updateResponse: UpdateBankResponse = {
      id: VALID_UUID,
      bank: [],
    };
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(updateResponse));

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: [],
      }),
    ).resolves.toEqual(updateResponse);

    // Cache stays empty (no prior snapshot to apply or roll back to).
    expect(
      queryClient.getQueryData(['readEntry', VALID_UUID]),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useUpdateReadBank — list invalidation on success
// ---------------------------------------------------------------------------

describe('useUpdateReadBank — list invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
    queryClient.setQueryData(['readEntry', VALID_UUID], SEEDED_ENTRY);
  });

  it('invalidates ["readEntries", language] on success to refresh saved counts', async () => {
    const updateResponse: UpdateBankResponse = {
      id: VALID_UUID,
      bank: ['aldea', 'indiferencia'],
    };
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(updateResponse));

    queryClient.setQueryData(['readEntries', Language.ES], { entries: [] });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: ['aldea', 'indiferencia'],
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['readEntries', Language.ES],
    });
  });

  it('does NOT invalidate the list when the request fails', async () => {
    const serverError = new Error('Bank update failed');
    (serverError as unknown as { status: number }).status = 500;
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateReadBank({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({
        id: VALID_UUID,
        language: Language.ES,
        bank: ['aldea'],
      }),
    ).rejects.toThrow();

    // The cancelQueries call inside onMutate may show up but invalidateQueries
    // should NOT have fired with the readEntries key on failure.
    const readEntriesInvalidations = invalidateSpy.mock.calls.filter(
      ([opts]) => Array.isArray((opts as { queryKey?: unknown[] })?.queryKey)
        && ((opts as { queryKey: unknown[] }).queryKey[0] === 'readEntries'),
    );
    expect(readEntriesInvalidations).toHaveLength(0);
  });
});
