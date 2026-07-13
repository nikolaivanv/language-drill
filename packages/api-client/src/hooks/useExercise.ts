import { useQuery, useMutation } from '@tanstack/react-query';
import type { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  ExerciseResponseSchema,
  type ExerciseResponse,
  ExerciseSetResponseSchema,
  type ExerciseSetResponse,
  parseSubmitResult,
  type SubmitResultResponse,
} from '../schemas/exercise';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useExercise
// ---------------------------------------------------------------------------

export type UseExerciseParams = {
  language: Language;
  difficulty: CefrLevel;
  type?: ExerciseType;
  grammarPointKey?: string;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useExercise({
  language,
  difficulty,
  type,
  grammarPointKey,
  fetchFn,
  enabled = true,
}: UseExerciseParams) {
  return useQuery<ExerciseResponse, Error>({
    queryKey: ['exercise', language, difficulty, type, grammarPointKey],
    queryFn: async () => {
      const params = new URLSearchParams({ language, difficulty });
      if (type) params.set('type', type);
      if (grammarPointKey) params.set('grammarPoint', grammarPointKey);
      const response = await fetchFn(`/exercises?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseResponseSchema.parse(json);
    },
    enabled,
    // The backend returns a *random* exercise from the pool on every call, so an
    // automatic background refetch would swap the task out from under a user who
    // is mid-answer (most visibly in free writing, where composing takes
    // minutes). Hold the fetched exercise stable for the session; advancing to a
    // new exercise happens through explicit invalidation (see useSubmitAnswer).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

// ---------------------------------------------------------------------------
// useExerciseSet — a pre-composed, distinct-by-content set for one sitting
// ---------------------------------------------------------------------------

export type UseExerciseSetParams = {
  language: Language;
  difficulty: CefrLevel;
  type?: ExerciseType;
  grammarPointKey?: string;
  count?: number;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useExerciseSet({
  language,
  difficulty,
  type,
  grammarPointKey,
  count,
  fetchFn,
  enabled = true,
}: UseExerciseSetParams) {
  return useQuery<ExerciseSetResponse, Error>({
    queryKey: ['exercise-set', language, difficulty, type, grammarPointKey, count],
    queryFn: async () => {
      const params = new URLSearchParams({ language, difficulty });
      if (type) params.set('type', type);
      if (grammarPointKey) params.set('grammarPoint', grammarPointKey);
      if (count) params.set('count', String(count));
      const response = await fetchFn(`/exercises/set?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseSetResponseSchema.parse(json);
    },
    enabled,
    // The set is composed server-side per call (distinct, freshness-ordered), so
    // hold it stable for the sitting. A fresh set ("practice more") is an
    // explicit refetch(); a background refetch would swap the items mid-session.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

// ---------------------------------------------------------------------------
// useSubmitAnswer
// ---------------------------------------------------------------------------

export type SubmitAnswerParams = {
  exerciseId: string;
  answer: string;
  sessionId?: string;
  hintUsage?: { wordsRevealed: number; fullAnswerRevealed: boolean };
};

export type UseSubmitAnswerOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitAnswer({ fetchFn }: UseSubmitAnswerOptions) {
  return useMutation<SubmitResultResponse, Error, SubmitAnswerParams>({
    mutationFn: async ({ exerciseId, answer, sessionId, hintUsage }) => {
      const body: { answer: string; sessionId?: string; hintUsage?: SubmitAnswerParams['hintUsage'] } = { answer };
      if (sessionId !== undefined) body.sessionId = sessionId;
      if (hintUsage !== undefined) body.hintUsage = hintUsage;
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return parseSubmitResult(json);
    },
    // Deliberately NO query invalidation here. The single-exercise pages
    // (conjugation warm-up) render the fetched task live, so invalidating
    // ['exercise'] on submit would override `staleTime: Infinity` and refetch a
    // fresh random exercise the instant feedback appears — swapping the prompt
    // out from under the user's just-graded answer. Advancing to the next
    // exercise is an explicit caller action (`refetch()` on "next"), never a
    // submit side effect. Session-driven flows read from the manifest, not this
    // query, so they are unaffected either way.
  });
}
