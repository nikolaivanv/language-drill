import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  useSaveVocabularyCard,
  useDeleteVocabularyCard,
} from './useVocabularyMutations';
import type {
  DeepCard,
  SaveVocabularyCardRequest,
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
const ENTRY_UUID = '22222222-2222-2222-2222-222222222222';

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

const SAVE_INPUT: SaveVocabularyCardRequest = {
  language: Language.ES,
  card: WORD_CARD,
  sourceReadEntryId: ENTRY_UUID,
};

// ---------------------------------------------------------------------------
// useSaveVocabularyCard
// ---------------------------------------------------------------------------

describe('useSaveVocabularyCard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /read/vocabulary with the JSON body and returns { id }', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ id: VALID_UUID }));

    const { result } = renderHook(() => useSaveVocabularyCard({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let res!: { id: string };
    await act(async () => {
      res = await result.current.mutateAsync(SAVE_INPUT);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/read/vocabulary');
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual(SAVE_INPUT);

    expect(res).toEqual({ id: VALID_UUID });
  });

  it('rejects when the response fails Zod validation', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ id: 'not-a-uuid' }));

    const { result } = renderHook(() => useSaveVocabularyCard({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAVE_INPUT)).rejects.toThrow();
  });

  it('surfaces a server error (e.g. 400 sentence-card rejection)', async () => {
    const serverError = new Error('Sentence cards cannot be saved');
    (serverError as unknown as { status: number }).status = 400;
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useSaveVocabularyCard({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAVE_INPUT)).rejects.toThrow(
      'Sentence cards cannot be saved',
    );
  });
});

// ---------------------------------------------------------------------------
// useDeleteVocabularyCard
// ---------------------------------------------------------------------------

describe('useDeleteVocabularyCard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('DELETEs /read/vocabulary/:id and returns { id }', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ id: VALID_UUID }));

    const { result } = renderHook(() => useDeleteVocabularyCard({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let res!: { id: string };
    await act(async () => {
      res = await result.current.mutateAsync(VALID_UUID);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`/read/vocabulary/${VALID_UUID}`);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(res).toEqual({ id: VALID_UUID });
  });

  it('surfaces a server error (e.g. 404 not found)', async () => {
    const notFound = new Error('Vocabulary record not found');
    (notFound as unknown as { status: number }).status = 404;
    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(notFound);

    const { result } = renderHook(() => useDeleteVocabularyCard({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(VALID_UUID)).rejects.toThrow(
      'Vocabulary record not found',
    );
  });
});
