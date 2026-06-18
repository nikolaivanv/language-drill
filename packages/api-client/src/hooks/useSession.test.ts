import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import { useCreateSession, useCompleteSession, useResumeSession } from './useSession';
import type { CreateSessionRequest } from '../schemas/session';
import type { AuthenticatedFetch } from '../fetchClient';

/**
 * These tests exercise `useCreateSession` end-to-end through a real
 * `QueryClientProvider` so the request URL/method/body shape and the Zod
 * response parse are locked down at the hook boundary (Req 1.1, 7.4).
 *
 * The single mocked seam is `fetchFn: AuthenticatedFetch` — the hook calls
 * exactly one network function, so we capture the request through it and
 * assert on the body / URL / method directly. We do not mock TanStack Query.
 *
 * Error-mode tests mirror `createAuthenticatedFetch` in `fetchClient.ts`,
 * which throws a plain `Error` with `.status` and `.body` attached on non-2xx
 * — that is the exact shape the hook will see in production.
 */

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
  // `retry: false` is essential — otherwise TanStack Query retries failed
  // mutations 3× by default, slowing every "rejects" assertion.
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

const SAMPLE_EXERCISE = {
  id: 'ex-001',
  type: 'cloze',
  language: 'ES',
  difficulty: 'B1',
  grammarPointKey: 'es-b1-preterite-vs-imperfect',
  contentJson: {
    instructions: 'Fill in the blank',
    sentence: 'Ella ___ al parque.',
    correctAnswer: 'fue',
  },
};

const SAMPLE_RESPONSE = {
  id: '11111111-2222-3333-4444-555555555555',
  exercises: [SAMPLE_EXERCISE],
};

const SAMPLE_REQUEST: CreateSessionRequest = {
  language: Language.ES,
  difficulty: CefrLevel.B1,
  exerciseCount: 5,
};

// ---------------------------------------------------------------------------
// useCreateSession — happy path
// ---------------------------------------------------------------------------

describe('useCreateSession — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /sessions with the JSON-stringified body', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/sessions');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init!.body as string)).toEqual({
      language: Language.ES,
      difficulty: CefrLevel.B1,
      exerciseCount: 5,
    });
  });

  it('forwards the full ordered manifest from the request', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    const customRequest: CreateSessionRequest = {
      language: Language.DE,
      difficulty: CefrLevel.C1,
      exerciseCount: 20,
    };

    await act(async () => {
      await result.current.mutateAsync(customRequest);
    });

    const body = JSON.parse(
      fetchFn.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body['language']).toBe(Language.DE);
    expect(body['difficulty']).toBe(CefrLevel.C1);
    expect(body['exerciseCount']).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// useCreateSession — response parsing
// ---------------------------------------------------------------------------

describe('useCreateSession — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed CreateSessionResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    expect(parsed!.id).toBe(SAMPLE_RESPONSE.id);
    expect(parsed!.exercises).toHaveLength(1);
    expect(parsed!.exercises[0]!.id).toBe('ex-001');
    expect(parsed!.exercises[0]!.type).toBe('cloze');
  });

  it('rejects when the response body fails Zod validation', async () => {
    // `id` is not a UUID — `CreateSessionResponseSchema` should reject it.
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        id: 'not-a-uuid',
        exercises: [],
      }),
    );

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow();
    // The network call still happened — the failure is in client-side parse.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useCreateSession — error propagation
// ---------------------------------------------------------------------------

describe('useCreateSession — error propagation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('rethrows the server-side message when fetchFn throws on 4xx', async () => {
    // Mirror the real `createAuthenticatedFetch` shape: a plain `Error` whose
    // `.message` is the parsed `error` field, with `.status` and `.body`
    // attached. The hook itself does not need to know about that shape — it
    // just needs to surface the rejection unchanged.
    const serverError = new Error('Insufficient exercise pool');
    (serverError as unknown as { status: number }).status = 422;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Insufficient exercise pool',
      code: 'INSUFFICIENT_POOL',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow(
      'Insufficient exercise pool',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects on a generic 5xx network failure', async () => {
    const networkError = new Error('Request failed: 500');
    (networkError as unknown as { status: number }).status = 500;

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(networkError);

    const { result } = renderHook(() => useCreateSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(result.current.mutateAsync(SAMPLE_REQUEST)).rejects.toThrow(
      'Request failed: 500',
    );
  });
});

// ---------------------------------------------------------------------------
// useCompleteSession — request shape
// ---------------------------------------------------------------------------

const SAMPLE_COMPLETE_RESPONSE = {
  id: '11111111-2222-3333-4444-555555555555',
  exerciseCount: 5,
  correctCount: 3,
  attemptedCount: 4,
  skippedCount: 1,
  durationSeconds: 240,
};

describe('useCompleteSession — request shape', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to /sessions/:sessionId/complete with the templated URL', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_COMPLETE_RESPONSE));

    const { result } = renderHook(() => useCompleteSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ sessionId: 'abc-uuid' });
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/sessions/abc-uuid/complete');

    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// useCompleteSession — response parsing
// ---------------------------------------------------------------------------

describe('useCompleteSession — response parsing', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('parses the response into a typed CompleteSessionResponse', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_COMPLETE_RESPONSE));

    const { result } = renderHook(() => useCompleteSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let parsed: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      parsed = await result.current.mutateAsync({
        sessionId: SAMPLE_COMPLETE_RESPONSE.id,
      });
    });

    expect(parsed!.id).toBe(SAMPLE_COMPLETE_RESPONSE.id);
    expect(parsed!.exerciseCount).toBe(5);
    expect(parsed!.correctCount).toBe(3);
    expect(parsed!.attemptedCount).toBe(4);
    expect(parsed!.skippedCount).toBe(1);
    expect(parsed!.durationSeconds).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// useCompleteSession — error propagation
// ---------------------------------------------------------------------------

describe('useCompleteSession — error propagation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('rejects with the server message when fetchFn throws on 4xx INVALID_SESSION', async () => {
    // Mirror the real `createAuthenticatedFetch` shape on a non-2xx: a plain
    // `Error` whose `.message` is the parsed `error` field, with `.status`
    // and `.body` attached. The hook must surface the rejection unchanged.
    const serverError = new Error('Session is not active');
    (serverError as unknown as { status: number }).status = 400;
    (serverError as unknown as { body: unknown }).body = {
      error: 'Session is not active',
      code: 'INVALID_SESSION',
    };

    const fetchFn = vi.fn<AuthenticatedFetch>().mockRejectedValue(serverError);

    const { result } = renderHook(() => useCompleteSession({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({ sessionId: 'abc-uuid' }),
    ).rejects.toThrow('Session is not active');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useResumeSession
// ---------------------------------------------------------------------------

describe('useResumeSession', () => {
  let queryClient: QueryClient;
  let wrapper: ReturnType<typeof buildWrapper>;

  beforeEach(() => {
    queryClient = buildQueryClient();
    wrapper = buildWrapper(queryClient);
  });

  it('useResumeSession GETs /sessions/:id and returns the parsed payload', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({
        id: '11111111-1111-1111-1111-111111111111',
        exercises: [{ id: 'e1', type: 'cloze', language: 'EN', difficulty: 'B1', grammarPointKey: null, contentJson: {} }],
        attemptedExerciseIds: [],
        completedAt: null,
      }),
    })) as unknown as AuthenticatedFetch;

    const { result } = renderHook(
      () => useResumeSession({ sessionId: '11111111-1111-1111-1111-111111111111', fetchFn }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/sessions/11111111-1111-1111-1111-111111111111');
    expect(result.current.data?.exercises[0].id).toBe('e1');
  });
});
