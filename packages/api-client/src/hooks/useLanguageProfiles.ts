import { useQuery } from '@tanstack/react-query';
import {
  LanguageProfilesResponseSchema,
  type LanguageProfilesResponse,
} from '../schemas/profile';
import type { AuthenticatedFetch } from '../fetchClient';

// ---------------------------------------------------------------------------
// useLanguageProfiles
// ---------------------------------------------------------------------------

export type UseLanguageProfilesParams = {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useLanguageProfiles({
  fetchFn,
  enabled = true,
}: UseLanguageProfilesParams) {
  return useQuery<LanguageProfilesResponse, Error>({
    queryKey: ['languageProfiles'],
    queryFn: async () => {
      const response = await fetchFn('/profiles/languages');
      const json: unknown = await response.json();
      return LanguageProfilesResponseSchema.parse(json);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
