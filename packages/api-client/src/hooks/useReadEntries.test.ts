import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import { useReadEntries, useReadEntry } from './useReadEntries';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Helpers (parallel useDebrief.test.ts / useTodayPlan.test.ts)
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

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const ISO = '2026-05-04T08:00:00.000Z';

const SAMPLE_LIST = {
  entries: [
    {
      id: VALID_UUID,
      title: 'aldea',
      source: 'El País',
      preview: 'La aldea recibió al pintor.',
      flaggedCount: 5,
      savedCount: 1,
      pastedAt: ISO,
    },
  ],
};

const SAMPLE_FULL_ENTRY = {
  id: VALID_UUID,
  language: Language.ES,
  title: 'aldea',
  source: 'El País',
  text: 'La aldea recibió al pintor con cierta indiferencia.',
  flaggedWords: {
    aldea: {
      lemma: 'aldea',
      pos: 'noun',
      gloss: 'small village',
      example: 'Visitamos la aldea ayer.',
      freq: 4200,
      cefr: CefrLevel.B2,
    },
  },
  bank: ['aldea'],
  pastedAt: ISO,
};

// ---------------------------------------------------------------------------
// useReadEntries — request shape
// ---------------------------------------------------------------------------

describe('useReadEntries — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('GETs /read/entries with the language query param', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_LIST));

    const { result } = renderHook(
      () => useReadEntries({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/read/entries?language=ES');
    // No init arg → defaults to GET.
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('does NOT fetch when enabled=false', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_LIST));

    const { result } = renderHook(
      () =>
        useReadEntries({ fetchFn, language: Language.ES, enabled: false }),
      { wrapper: buildWrapper(queryClient) },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('uses a separate cache key per language (re-fetches on language change)', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_LIST));

    const { result, rerender } = renderHook(
      ({ lang }: { lang: typeof Language.ES | typeof Language.DE }) =>
        useReadEntries({ fetchFn, language: lang }),
      {
        wrapper: buildWrapper(queryClient),
        initialProps: { lang: Language.ES as typeof Language.ES | typeof Language.DE },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    rerender({ lang: Language.DE });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[0]).toBe('/read/entries?language=DE');
  });
});

// ---------------------------------------------------------------------------
// useReadEntries — response parsing + error
// ---------------------------------------------------------------------------

describe('useReadEntries — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed ReadEntriesResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_LIST));

    const { result } = renderHook(
      () => useReadEntries({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.entries).toHaveLength(1);
    expect(result.current.data?.entries[0]?.id).toBe(VALID_UUID);
    expect(result.current.data?.entries[0]?.flaggedCount).toBe(5);
    expect(result.current.data?.entries[0]?.savedCount).toBe(1);
  });

  it('parses an empty entries list', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ entries: [] }));

    const { result } = renderHook(
      () => useReadEntries({ fetchFn, language: Language.TR }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.entries).toEqual([]);
  });

  it('rejects when the response body fails Zod validation', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        entries: [{ ...SAMPLE_LIST.entries[0], id: 'not-a-uuid' }],
      }),
    );

    const { result } = renderHook(
      () => useReadEntries({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('exposes the server-side error when fetchFn throws', async () => {
    const serverError = new Error('Validation failed');
    (serverError as unknown as { status: number }).status = 400;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(
      () => useReadEntries({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Validation failed');
  });
});

// ---------------------------------------------------------------------------
// useReadEntry — request shape & enabled gating
// ---------------------------------------------------------------------------

describe('useReadEntry — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('GETs /read/entries/:id with the templated URL', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_FULL_ENTRY));

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`/read/entries/${VALID_UUID}`);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('does NOT fetch when id is null (active entry not yet known)', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_FULL_ENTRY));

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: null }),
      { wrapper: buildWrapper(queryClient) },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT fetch when enabled=false even if id is set', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_FULL_ENTRY));

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID, enabled: false }),
      { wrapper: buildWrapper(queryClient) },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useReadEntry — response parsing + caching
// ---------------------------------------------------------------------------

describe('useReadEntry — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed ReadEntryResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_FULL_ENTRY));

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe(VALID_UUID);
    expect(result.current.data?.language).toBe(Language.ES);
    expect(result.current.data?.flaggedWords?.aldea?.lemma).toBe('aldea');
    expect(result.current.data?.bank).toEqual(['aldea']);
  });

  it('rejects when the response body fails Zod validation', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({ ...SAMPLE_FULL_ENTRY, id: 'not-a-uuid' }),
    );

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('exposes the 404 ENTRY_NOT_FOUND error when fetchFn throws', async () => {
    const serverError = new Error('Entry not found');
    (serverError as unknown as { status: number }).status = 404;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Entry not found',
      code: 'ENTRY_NOT_FOUND',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Entry not found');
  });
});

describe('useReadEntry — caching', () => {
  it('does not refetch on remount within the same QueryClient (staleTime: Infinity)', async () => {
    // staleTime: Infinity safe because the entry payload changes only via
    // the bank-update mutation, which writes through this cache key.
    const queryClient = buildQueryClient();
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_FULL_ENTRY));

    const first = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(
      () => useReadEntry({ fetchFn, id: VALID_UUID }),
      { wrapper: buildWrapper(queryClient) },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    // No new fetch — second mount is served from cache.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
