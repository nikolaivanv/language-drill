import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import { useReadAnnotate } from './useReadAnnotate';
import type { AnnotateRequest } from '../schemas/read';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// Helpers (parallel `useSession.test.ts` patterns)
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

const SAMPLE_REQUEST: AnnotateRequest = {
  text: 'La aldea recibió al pintor con cierta indiferencia.',
  language: Language.ES,
};

const SAMPLE_RESPONSE = {
  flagged: {
    aldea: {
      lemma: 'aldea',
      pos: 'noun',
      gloss: 'small village',
      example: 'Visitamos la aldea ayer.',
      freq: 4200,
      cefr: CefrLevel.B2,
    },
  },
  calibration: { cefr: CefrLevel.B1, top: 3000 },
};

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe('useReadAnnotate — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /read/annotate with the JSON-stringified body', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/read/annotate');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init!.body as string)).toEqual({
      text: SAMPLE_REQUEST.text,
      language: Language.ES,
    });
  });

  it('forwards the language and text fields verbatim', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ flagged: {}, calibration: { cefr: CefrLevel.A1, top: 750 } }));

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const customRequest: AnnotateRequest = {
      text: 'Der Wirtschaftsaufschwung überraschte die Analysten.',
      language: Language.DE,
    };

    await act(async () => {
      await result.current.mutateAsync(customRequest);
    });

    const body = JSON.parse(
      fetchFn.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body['language']).toBe(Language.DE);
    expect(body['text']).toBe(customRequest.text);
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe('useReadAnnotate — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed AnnotateResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    expect(parsed!.flagged.aldea?.lemma).toBe('aldea');
    expect(parsed!.flagged.aldea?.cefr).toBe(CefrLevel.B2);
    expect(parsed!.calibration).toEqual({ cefr: CefrLevel.B1, top: 3000 });
  });

  it('parses an empty flagged map (in-level passage)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        flagged: {},
        calibration: { cefr: CefrLevel.C1, top: 8000 },
      }),
    );

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    expect(Object.keys(parsed!.flagged)).toHaveLength(0);
    expect(parsed!.calibration.cefr).toBe(CefrLevel.C1);
  });

  it('rejects when the response body fails Zod validation (missing calibration)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        flagged: {},
        // calibration field omitted entirely
      }),
    );

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow();
    // The network call still happened — the failure is in client-side parse.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects when a flagged entry has the wrong shape', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        flagged: { aldea: { lemma: 'aldea' } }, // missing required fields
        calibration: { cefr: CefrLevel.B1, top: 3000 },
      }),
    );

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Error propagation — surfaces via mutation.error
// ---------------------------------------------------------------------------

describe('useReadAnnotate — error propagation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('surfaces the server-side message when fetchFn throws on 429 rate-limit', async () => {
    const serverError = new Error('Daily evaluation limit exceeded');
    (serverError as unknown as { status: number }).status = 429;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Daily evaluation limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow(
      'Daily evaluation limit exceeded',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 502 AI_UNAVAILABLE error', async () => {
    const serverError = new Error('Evaluation temporarily unavailable');
    (serverError as unknown as { status: number }).status = 502;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Evaluation temporarily unavailable',
      code: 'AI_UNAVAILABLE',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow(
      'Evaluation temporarily unavailable',
    );
  });

  it('rejects on a generic 5xx network failure', async () => {
    const networkError = new Error('Request failed: 500');
    (networkError as unknown as { status: number }).status = 500;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(networkError);

    const { result } = renderHook(() => useReadAnnotate({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow(
      'Request failed: 500',
    );
  });
});
