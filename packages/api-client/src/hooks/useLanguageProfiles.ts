import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LanguageProfile } from '@language-drill/shared';
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

// ---------------------------------------------------------------------------
// useSaveLanguageProfiles
// ---------------------------------------------------------------------------

export type UseSaveLanguageProfilesParams = {
  fetchFn: AuthenticatedFetch;
};

export function useSaveLanguageProfiles({ fetchFn }: UseSaveLanguageProfilesParams) {
  const queryClient = useQueryClient();

  return useMutation<LanguageProfilesResponse, Error, LanguageProfile[]>({
    mutationFn: async (profiles) => {
      const response = await fetchFn('/profiles/languages', {
        method: 'PUT',
        body: JSON.stringify({ profiles }),
      });
      const json: unknown = await response.json();
      return LanguageProfilesResponseSchema.parse(json);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['languageProfiles'], data);
    },
  });
}
