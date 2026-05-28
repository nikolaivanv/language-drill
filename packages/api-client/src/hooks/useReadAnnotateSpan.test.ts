import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import { useReadAnnotateSpan } from './useReadAnnotateSpan';
import type {
  AnnotateSpanRequest,
  DeepCard,
  ReadEntryResponse,
} from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Helpers (mirrors useReadEntryMutations.test.ts)
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

const WORD_CARD: DeepCard = {
  type: 'word',
  surface: 'casa',
  lemma: 'casa',
  pos: 'noun',
  contextualSense: 'house (here: the family home)',
  definition: 'edificio para vivir',
  definitionLabel: 'Español',
  cefr: CefrLevel.A1,
  freq: 120,
};

// "La casa es bonita." — "casa" occupies [3,7).
const REQUEST: AnnotateSpanRequest = {
  language: Language.ES,
  text: 'La casa es bonita.',
  start: 3,
  end: 7,
  entryId: VALID_UUID,
};

const SEEDED_ENTRY: ReadEntryResponse = {
  id: VALID_UUID,
  language: Language.ES,
  title: 'casa',
  source: '',
  text: 'La casa es bonita.',
  flaggedWords: {},
  bank: [],
  pastedAt: ISO,
};

// ---------------------------------------------------------------------------
// Request shape + response parsing
// ---------------------------------------------------------------------------

describe('useReadAnnotateSpan — request + response', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /read/annotate-span with the JSON-stringified body and returns the card', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(WORD_CARD));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let card!: DeepCard;
    await act(async () => {
      card = await result.current.mutateAsync(REQUEST);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/read/annotate-span');
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual(REQUEST);

    expect(card).toEqual(WORD_CARD);
  });

  it('rejects when the response body fails Zod validation', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ type: 'word', surface: 'casa' }));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(REQUEST)).rejects.toThrow();
    expect(
      queryClient.getQueryData(['readEntry', VALID_UUID]),
    ).toBeUndefined();
  });

  it('surfaces a server error (e.g. 429) thrown by the fetch wrapper', async () => {
    const rateLimit = new Error('Daily span-annotation limit exceeded');
    (rateLimit as unknown as { status: number }).status = 429;
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(rateLimit);

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(REQUEST)).rejects.toThrow(
      'Daily span-annotation limit exceeded',
    );
  });
});

// ---------------------------------------------------------------------------
// Cache write-through into ['readEntry', entryId].spanAnnotations
// ---------------------------------------------------------------------------

describe('useReadAnnotateSpan — cache write-through', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('writes the resolved card into the entry cache keyed by "start:end"', async () => {
    queryClient.setQueryData(['readEntry', VALID_UUID], SEEDED_ENTRY);
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(WORD_CARD));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(REQUEST);
    });

    const cached = queryClient.getQueryData<ReadEntryResponse>([
      'readEntry',
      VALID_UUID,
    ]);
    expect(cached?.spanAnnotations).toEqual({ '3:7': WORD_CARD });
    // Other fields are preserved.
    expect(cached?.bank).toEqual([]);
    expect(cached?.text).toBe('La casa es bonita.');
  });

  it('merges into existing spanAnnotations without clobbering prior spans', async () => {
    const priorCard: DeepCard = { ...WORD_CARD, surface: 'bonita', lemma: 'bonito' };
    queryClient.setQueryData(['readEntry', VALID_UUID], {
      ...SEEDED_ENTRY,
      spanAnnotations: { '11:17': priorCard },
    });
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(WORD_CARD));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(REQUEST);
    });

    const cached = queryClient.getQueryData<ReadEntryResponse>([
      'readEntry',
      VALID_UUID,
    ]);
    expect(cached?.spanAnnotations).toEqual({
      '11:17': priorCard,
      '3:7': WORD_CARD,
    });
  });

  it('does NOT write to the cache when no entryId is present (unsaved passage, Req 11.2)', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(WORD_CARD));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const { entryId: _drop, ...noEntry } = REQUEST;
    await act(async () => {
      await result.current.mutateAsync(noEntry);
    });

    expect(
      queryClient.getQueryData(['readEntry', VALID_UUID]),
    ).toBeUndefined();
  });

  it('does not crash when the entry is not cached yet (no write, no throw)', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(WORD_CARD));

    const { result } = renderHook(() => useReadAnnotateSpan({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(REQUEST)).resolves.toEqual(
      WORD_CARD,
    );
    // No entry was seeded → nothing to write into.
    expect(
      queryClient.getQueryData(['readEntry', VALID_UUID]),
    ).toBeUndefined();
  });
});
