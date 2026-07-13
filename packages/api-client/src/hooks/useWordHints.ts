import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { WordHintsResponseSchema, type WordHintsResponse } from '../schemas/exercise';

export type UseWordHintsOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useWordHints({ fetchFn }: UseWordHintsOptions) {
  return useMutation<WordHintsResponse, Error, { exerciseId: string }>({
    mutationFn: async ({ exerciseId }) => {
      const response = await fetchFn(`/exercises/${exerciseId}/word-hints`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return WordHintsResponseSchema.parse(json);
    },
  });
}
