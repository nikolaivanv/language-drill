import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { MeResponseSchema, type MeResponse } from '../schemas/me';

export type UseMeParams = {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useMe({ fetchFn, enabled = true }: UseMeParams) {
  return useQuery<MeResponse, Error>({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await fetchFn('/me');
      const json: unknown = await response.json();
      return MeResponseSchema.parse(json);
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
