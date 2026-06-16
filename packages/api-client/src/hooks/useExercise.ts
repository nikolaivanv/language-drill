import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  ExerciseResponseSchema,
  type ExerciseResponse,
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
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useExercise({
  language,
  difficulty,
  type,
  fetchFn,
  enabled = true,
}: UseExerciseParams) {
  return useQuery<ExerciseResponse, Error>({
    queryKey: ['exercise', language, difficulty, type],
    queryFn: async () => {
      const params = new URLSearchParams({ language, difficulty });
      if (type) params.set('type', type);
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
// useSubmitAnswer
// ---------------------------------------------------------------------------

export type SubmitAnswerParams = {
  exerciseId: string;
  answer: string;
  sessionId?: string;
};

export type UseSubmitAnswerOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitAnswer({ fetchFn }: UseSubmitAnswerOptions) {
  const queryClient = useQueryClient();

  return useMutation<SubmitResultResponse, Error, SubmitAnswerParams>({
    mutationFn: async ({ exerciseId, answer, sessionId }) => {
      const body: { answer: string; sessionId?: string } = { answer };
      if (sessionId !== undefined) body.sessionId = sessionId;
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return parseSubmitResult(json);
    },
    onSuccess: () => {
      // Invalidate exercise queries so next fetch gets a fresh exercise.
      // No-op for session-driven flows (page reads from manifest, not the cache);
      // kept for backward compatibility with single-exercise callers (mobile).
      queryClient.invalidateQueries({ queryKey: ['exercise'] });
    },
  });
}
