import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  ExerciseResponseSchema,
  type ExerciseResponse,
  EvaluationResultSchema,
  type EvaluationResultResponse,
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
  });
}

// ---------------------------------------------------------------------------
// useSubmitAnswer
// ---------------------------------------------------------------------------

export type SubmitAnswerParams = {
  exerciseId: string;
  answer: string;
};

export type UseSubmitAnswerOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitAnswer({ fetchFn }: UseSubmitAnswerOptions) {
  const queryClient = useQueryClient();

  return useMutation<EvaluationResultResponse, Error, SubmitAnswerParams>({
    mutationFn: async ({ exerciseId, answer }) => {
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
      const json: unknown = await response.json();
      return EvaluationResultSchema.parse(json);
    },
    onSuccess: () => {
      // Invalidate exercise queries so next fetch gets a fresh exercise
      queryClient.invalidateQueries({ queryKey: ['exercise'] });
    },
  });
}
