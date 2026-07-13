import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCurriculum } from './useCurriculum';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
const payload = {
  items: [
    {
      key: 'tr-a1-present-tense', kind: 'grammar', name: 'Present tense', description: 'desc',
      cefrLevel: 'A1', language: 'TR', examplesPositive: ['a', 'b'], examplesNegative: ['*c'],
      commonErrors: ['e'], prerequisiteKeys: [], targetOverride: null,
      clozeUnsuitable: false, sentenceConstructionSuitable: true, conjugationSuitable: false,
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2 } }] },
      freeWritingRegister: null, exerciseTypes: ['cloze', 'translation'],
    },
    {
      key: 'es-b1-paraphrase', kind: 'paraphrase', name: 'Paraphrase (B1)', description: 'desc',
      cefrLevel: 'B1', language: 'ES', examplesPositive: ['a'], examplesNegative: ['*c'],
      commonErrors: ['e'], prerequisiteKeys: [], targetOverride: null,
      clozeUnsuitable: false, sentenceConstructionSuitable: false, conjugationSuitable: false,
      coverageSpec: null, freeWritingRegister: null, exerciseTypes: [],
    },
  ],
  total: 2,
  curriculumVersionByLanguage: { ES: 'es@1', DE: 'de@1', TR: 'tr@1' },
};

describe('useCurriculum', () => {
  it('fetches /admin/curriculum and parses the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const { result } = renderHook(() => useCurriculum({ fetchFn }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith('/admin/curriculum');
  });

  it('passes filter params as a query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    renderHook(() => useCurriculum({ fetchFn, params: { language: 'ES', kind: 'grammar' } }), { wrapper: wrapper() });
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn).toHaveBeenCalledWith('/admin/curriculum?language=ES&kind=grammar');
  });
});
