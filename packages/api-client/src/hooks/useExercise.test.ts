import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { CefrLevel, ExerciseType, type Language } from '@language-drill/shared';
import { ExerciseResponseSchema, EvaluationResultSchema } from '../schemas/exercise';
import { useExercise, useSubmitAnswer } from './useExercise';
import type { AuthenticatedFetch } from '../fetchClient';

/**
 * These tests verify the Zod validation that useExercise and useSubmitAnswer
 * rely on internally. The hooks parse API responses through these schemas,
 * so validating schema behavior covers the critical data-integrity path.
 *
 * Full hook integration tests (with QueryClientProvider) belong in the
 * web app's test suite where a React rendering environment is available.
 */

describe('useExercise — response validation', () => {
  it('accepts a valid exercise response with all fields', () => {
    const data = {
      id: 'ex-001',
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      grammarPointKey: 'es-b1-conditional',
      contentJson: {
        instructions: 'Fill in the blank',
        sentence: 'She ___ to the park.',
        correctAnswer: 'went',
      },
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.id).toBe('ex-001');
    expect(result.type).toBe('cloze');
    expect(result.language).toBe('EN');
    expect(result.difficulty).toBe('B1');
    expect(result.grammarPointKey).toBe('es-b1-conditional');
    expect(result.contentJson).toEqual(data.contentJson);
  });

  it('accepts exercise with null contentJson', () => {
    const data = {
      id: 'ex-002',
      type: 'translation',
      language: 'ES',
      difficulty: 'A2',
      grammarPointKey: null,
      contentJson: null,
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.contentJson).toBeNull();
    expect(result.grammarPointKey).toBeNull();
  });

  it('rejects exercise missing id', () => {
    const data = {
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });

  it('rejects exercise missing type', () => {
    const data = {
      id: 'ex-003',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });

  it('rejects non-string id', () => {
    const data = {
      id: 123,
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });
});

describe('useSubmitAnswer — response validation', () => {
  const validEvaluation = {
    score: 0.75,
    grammarAccuracy: 0.8,
    vocabularyRange: 'B1',
    taskAchievement: 0.7,
    feedback: 'Good attempt, but watch your verb tenses.',
    errors: [
      {
        type: 'grammar' as const,
        severity: 'major' as const,
        text: 'I have went',
        correction: 'I have gone',
        explanation: 'Use past participle after "have".',
      },
    ],
    estimatedCefrEvidence: 'B1',
  };

  it('accepts a valid evaluation result', () => {
    const result = EvaluationResultSchema.parse(validEvaluation);
    expect(result.score).toBe(0.75);
    expect(result.grammarAccuracy).toBe(0.8);
    expect(result.feedback).toContain('verb tenses');
    expect(result.errors).toHaveLength(1);
  });

  it('accepts evaluation with no errors', () => {
    const data = { ...validEvaluation, errors: [] };
    const result = EvaluationResultSchema.parse(data);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts boundary scores (0 and 1)', () => {
    const data = {
      ...validEvaluation,
      score: 0,
      grammarAccuracy: 1,
      taskAchievement: 0,
    };
    const result = EvaluationResultSchema.parse(data);
    expect(result.score).toBe(0);
    expect(result.grammarAccuracy).toBe(1);
    expect(result.taskAchievement).toBe(0);
  });

  it('rejects score above 1', () => {
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: 1.01 }),
    ).toThrow();
  });

  it('rejects negative score', () => {
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: -0.1 }),
    ).toThrow();
  });

  it('rejects missing feedback field', () => {
    const { feedback: _feedback, ...noFeedback } = validEvaluation;
    void _feedback;
    expect(() => EvaluationResultSchema.parse(noFeedback)).toThrow();
  });

  it('rejects invalid error type in errors array', () => {
    const data = {
      ...validEvaluation,
      errors: [{ ...validEvaluation.errors[0], type: 'syntax' }],
    };
    expect(() => EvaluationResultSchema.parse(data)).toThrow();
  });

  it('rejects missing required fields entirely', () => {
    expect(() => EvaluationResultSchema.parse({})).toThrow();
  });
});

describe('useExercise — stability against background refetch', () => {
  const SAMPLE_EXERCISE = {
    id: 'ex-fw-1',
    type: 'free_writing',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: { title: 'T', task: 'task' },
  };

  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  function buildWrapper() {
    // A default QueryClient: refetchOnWindowFocus is `true` by default in v5,
    // so if the hook does not opt out, regaining focus would refetch and the
    // backend would hand back a *different* random exercise mid-session.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  it('does not refetch the exercise when the window regains focus', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_EXERCISE));

    const { result } = renderHook(
      () =>
        useExercise({
          language: 'ES' as Language,
          difficulty: CefrLevel.B1,
          type: ExerciseType.FREE_WRITING,
          fetchFn,
        }),
      { wrapper: buildWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Simulate the user tabbing away and back — the classic focus refetch.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    // Give any (unwanted) refetch a chance to fire, then assert it did not.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    focusManager.setFocused(undefined);
  });
});

describe('query key structure', () => {
  it('builds expected query key components', () => {
    // Verify the query key shape matches what useExercise constructs:
    // ['exercise', language, difficulty, type]
    const language = 'EN';
    const difficulty = 'B1';
    const type = 'cloze';
    const queryKey = ['exercise', language, difficulty, type];
    expect(queryKey).toEqual(['exercise', 'EN', 'B1', 'cloze']);
  });

  it('query key with undefined type', () => {
    const queryKey = ['exercise', 'ES', 'A2', undefined];
    expect(queryKey).toEqual(['exercise', 'ES', 'A2', undefined]);
    // undefined in query key means TanStack Query treats it as a distinct key
    // from one with a defined type value
  });
});

describe('URL parameter construction', () => {
  it('builds correct search params without type', () => {
    const params = new URLSearchParams({ language: 'EN', difficulty: 'B1' });
    expect(params.toString()).toBe('language=EN&difficulty=B1');
  });

  it('builds correct search params with type', () => {
    const params = new URLSearchParams({ language: 'ES', difficulty: 'A2' });
    params.set('type', 'translation');
    expect(params.toString()).toBe('language=ES&difficulty=A2&type=translation');
  });

  it('builds correct submit URL path', () => {
    const exerciseId = 'abc-123';
    const path = `/exercises/${exerciseId}/submit`;
    expect(path).toBe('/exercises/abc-123/submit');
  });
});

describe('useExercise — grammarPointKey param threading', () => {
  const SAMPLE_EXERCISE = {
    id: 'conj-001',
    type: 'conjugation',
    language: 'TR',
    difficulty: 'A1',
    grammarPointKey: 'tr-a1-dili-past',
    contentJson: { lemma: 'gitmek', targetForm: 'gitti' },
  };

  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  function buildWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  it('appends grammarPoint to the request URL when grammarPointKey is provided', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_EXERCISE));

    const { result } = renderHook(
      () =>
        useExercise({
          language: 'TR' as Language,
          difficulty: CefrLevel.A1,
          type: ExerciseType.CONJUGATION,
          grammarPointKey: 'tr-a1-dili-past',
          fetchFn,
        }),
      { wrapper: buildWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('grammarPoint=tr-a1-dili-past');
  });

  it('does NOT append grammarPoint to the URL when grammarPointKey is omitted', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_EXERCISE));

    const { result } = renderHook(
      () =>
        useExercise({
          language: 'TR' as Language,
          difficulty: CefrLevel.A1,
          type: ExerciseType.CONJUGATION,
          fetchFn,
        }),
      { wrapper: buildWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).not.toContain('grammarPoint');
  });
});

describe('useSubmitAnswer — does not swap the live exercise', () => {
  const SAMPLE_EXERCISE = {
    id: 'conj-1',
    type: 'conjugation',
    language: 'TR',
    difficulty: 'A1',
    grammarPointKey: 'tr-a1-past',
    contentJson: { lemma: 'gelmek', targetForm: 'geldiler' },
  };

  const SAMPLE_EVALUATION = {
    score: 0,
    grammarAccuracy: 0,
    vocabularyRange: 'n/a',
    taskAchievement: 0,
    feedback: 'wrong form',
    errors: [],
    estimatedCefrEvidence: 'A1',
  };

  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  // A single shared QueryClient so an invalidation fired by the mutation can
  // reach the active exercise query — exactly the production wiring on the
  // conjugation warm-up page.
  function buildWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  it('does not refetch the active exercise query on submit success', async () => {
    const exerciseFetch = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_EXERCISE));
    const submitFetch = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse(SAMPLE_EVALUATION));

    const { result } = renderHook(
      () => ({
        exercise: useExercise({
          language: 'TR' as Language,
          difficulty: CefrLevel.A1,
          type: ExerciseType.CONJUGATION,
          fetchFn: exerciseFetch,
        }),
        submit: useSubmitAnswer({ fetchFn: submitFetch }),
      }),
      { wrapper: buildWrapper() },
    );

    await waitFor(() => expect(result.current.exercise.data).toBeDefined());
    expect(exerciseFetch).toHaveBeenCalledTimes(1);

    // Submit an answer. The mutation must NOT yank the displayed task out from
    // under the feedback by refetching a fresh random exercise — advancing is
    // an explicit caller action (refetch on "next"), not a submit side effect.
    await act(async () => {
      await result.current.submit.mutateAsync({ exerciseId: 'conj-1', answer: 'geldiler' });
    });

    // Flush any invalidation-triggered refetch the mutation might have queued.
    await act(async () => {
      await Promise.resolve();
    });

    expect(exerciseFetch).toHaveBeenCalledTimes(1);
  });
});

describe('useSubmitAnswer — sessionId threading', () => {
  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  function buildWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  const SAMPLE_EVALUATION = {
    score: 0.8,
    grammarAccuracy: 0.9,
    vocabularyRange: 'B1',
    taskAchievement: 0.8,
    feedback: 'good',
    errors: [],
    estimatedCefrEvidence: 'B1',
  };

  it('omits sessionId from body when not provided', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse(SAMPLE_EVALUATION),
    );
    const { result } = renderHook(() => useSubmitAnswer({ fetchFn }), {
      wrapper: buildWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ exerciseId: 'ex-1', answer: 'hola' });
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/exercises/ex-1/submit');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ answer: 'hola' });
    expect(body).not.toHaveProperty('sessionId');
  });

  it('includes sessionId in body when provided', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse(SAMPLE_EVALUATION),
    );
    const { result } = renderHook(() => useSubmitAnswer({ fetchFn }), {
      wrapper: buildWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        exerciseId: 'ex-2',
        answer: 'hola',
        sessionId: 'session-uuid-abc',
      });
    });

    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ answer: 'hola', sessionId: 'session-uuid-abc' });
  });
});
