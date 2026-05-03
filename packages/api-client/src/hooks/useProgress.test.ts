import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { useProgressRadar, useProgressHeatmap } from './useProgress';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Helpers — mirror usePreferences.test.ts's pattern
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
// Canonical valid response payloads
// ---------------------------------------------------------------------------

const RADAR_OK_PAYLOAD = {
  language: 'ES',
  axes: [
    {
      key: 'listening',
      label: 'listening',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'reading',
      label: 'reading',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'speaking',
      label: 'speaking',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'writing',
      label: 'writing',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
    {
      key: 'grammar',
      label: 'grammar',
      currentMastery: 0.6,
      previousMastery: 0.4,
      lastPracticedAt: '2026-04-30T12:00:00.000Z',
      evidenceCount: 5,
    },
    {
      key: 'vocabulary',
      label: 'vocabulary',
      currentMastery: 0,
      previousMastery: 0,
      lastPracticedAt: null,
      evidenceCount: 0,
    },
  ],
};

const HEATMAP_OK_PAYLOAD = {
  language: 'ES',
  days: 30,
  topics: [
    {
      topicId: 'subjunctive',
      name: 'subjunctive',
      mastery: 0.71,
      cells: new Array(30).fill(0),
    },
  ],
  shadeThresholds: { paper2: 1, accentSoft: 2, accent: 4 },
};

// ---------------------------------------------------------------------------
// useProgressRadar
// ---------------------------------------------------------------------------

describe('useProgressRadar', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('GETs /progress/radar with the language query param and returns parsed data', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(RADAR_OK_PAYLOAD));

    const { result } = renderHook(
      () => useProgressRadar({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/progress/radar?language=ES');
    expect(result.current.data?.language).toBe('ES');
    expect(result.current.data?.axes).toHaveLength(6);
    expect(result.current.data?.axes[4].key).toBe('grammar');
    expect(result.current.data?.axes[4].currentMastery).toBe(0.6);
  });

  it('does not fire when enabled is false', () => {
    renderHook(
      () =>
        useProgressRadar({
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
        jsonResponse({ ...RADAR_OK_PAYLOAD, language: 'ES' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...RADAR_OK_PAYLOAD, language: 'DE' }),
      );

    const { result, rerender } = renderHook(
      ({ language }: { language: Language.ES | Language.DE }) =>
        useProgressRadar({ fetchFn, language }),
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
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/progress/radar?language=ES');
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/progress/radar?language=DE');
  });

  it('surfaces a Zod parse error when the server returns a malformed payload', async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ language: 'ES', axes: [] }), // wrong axis count
    );

    const { result } = renderHook(
      () => useProgressRadar({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// useProgressHeatmap
// ---------------------------------------------------------------------------

describe('useProgressHeatmap', () => {
  let queryClient: QueryClient;
  let fetchFn: Mock<AuthenticatedFetch>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    fetchFn = vi.fn() as Mock<AuthenticatedFetch>;
  });

  it('GETs /progress/heatmap with the language query param and returns parsed data', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(HEATMAP_OK_PAYLOAD));

    const { result } = renderHook(
      () => useProgressHeatmap({ fetchFn, language: Language.ES }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/progress/heatmap?language=ES');
    expect(result.current.data?.days).toBe(30);
    expect(result.current.data?.topics).toHaveLength(1);
    expect(result.current.data?.shadeThresholds).toEqual({
      paper2: 1,
      accentSoft: 2,
      accent: 4,
    });
  });

  it('does not fire when enabled is false', () => {
    renderHook(
      () =>
        useProgressHeatmap({
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
        jsonResponse({ ...HEATMAP_OK_PAYLOAD, language: 'ES' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...HEATMAP_OK_PAYLOAD, language: 'TR' }),
      );

    const { result, rerender } = renderHook(
      ({ language }: { language: Language.ES | Language.TR }) =>
        useProgressHeatmap({ fetchFn, language }),
      {
        wrapper: buildWrapper(queryClient),
        initialProps: { language: Language.ES },
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ language: Language.TR });
    await waitFor(() => expect(result.current.data?.language).toBe('TR'));

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/progress/heatmap?language=ES');
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/progress/heatmap?language=TR');
  });
});
