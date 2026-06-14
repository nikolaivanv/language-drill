import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FreeWritingEvaluationSchema,
  type FreeWritingEvaluationResponse,
} from '../schemas/exercise';
import type { AuthenticatedFetch } from '../fetchClient';

export type SubmitFreeWritingParams = {
  exerciseId: string;
  answer: string;
};

export type UseSubmitFreeWritingOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitFreeWriting({ fetchFn }: UseSubmitFreeWritingOptions) {
  const queryClient = useQueryClient();
  return useMutation<FreeWritingEvaluationResponse, Error, SubmitFreeWritingParams>({
    mutationFn: async ({ exerciseId, answer }) => {
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
      const json: unknown = await response.json();
      return FreeWritingEvaluationSchema.parse(json);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercise'] });
    },
  });
}
