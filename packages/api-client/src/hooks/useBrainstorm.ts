import { useQuery } from '@tanstack/react-query';
import { BrainstormSchema, type BrainstormResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseBrainstormOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  enabled: boolean;
};

// Cached per exercise with staleTime: Infinity so toggling the panel never
// re-bills; a "regenerate" action calls refetch() to re-bill explicitly.
export function useBrainstorm({ exerciseId, fetchFn, enabled }: UseBrainstormOptions) {
  return useQuery<BrainstormResponse, Error>({
    queryKey: ['writing-helper', 'brainstorm', exerciseId],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/brainstorm`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return BrainstormSchema.parse(json);
    },
  });
}
