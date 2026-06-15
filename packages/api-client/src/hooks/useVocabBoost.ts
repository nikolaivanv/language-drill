import { useQuery } from '@tanstack/react-query';
import { VocabBoostSchema, type VocabBoostResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseVocabBoostOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  enabled: boolean;
};

// Cached per exercise with staleTime: Infinity so toggling the panel never
// re-bills; a "regenerate" action calls refetch() to re-bill explicitly.
export function useVocabBoost({ exerciseId, fetchFn, enabled }: UseVocabBoostOptions) {
  return useQuery<VocabBoostResponse, Error>({
    queryKey: ['writing-helper', 'vocab', exerciseId],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/vocab-boost`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return VocabBoostSchema.parse(json);
    },
  });
}
