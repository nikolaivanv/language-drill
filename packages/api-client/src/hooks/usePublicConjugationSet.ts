import { useQuery } from '@tanstack/react-query';
import {
  ExerciseSetResponseSchema,
  type ExerciseSetResponse,
} from '../schemas/exercise';
import type { ApiFetch } from '../fetchClient';

export type PublicLanguage = 'ES' | 'DE' | 'TR';
export type PublicLevel = 'A1' | 'A2' | 'B1' | 'B2';

export type UsePublicConjugationSetParams = {
  lang: PublicLanguage;
  level: PublicLevel;
  count?: number;
  fetchFn: ApiFetch;
  enabled?: boolean;
};

/**
 * The anonymous conjugation sitting. No token, no writes: the set is fetched
 * once and graded client-side, so there is no submit mutation to pair with it.
 */
export function usePublicConjugationSet({
  lang,
  level,
  count,
  fetchFn,
  enabled = true,
}: UsePublicConjugationSetParams) {
  return useQuery<ExerciseSetResponse, Error>({
    queryKey: ['public-conjugation-set', lang, level, count],
    queryFn: async () => {
      const params = new URLSearchParams({ lang, level });
      if (count !== undefined) params.set('count', String(count));
      const response = await fetchFn(`/public/conjugation/set?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseSetResponseSchema.parse(json);
    },
    enabled,
    // The sitting must not change under the visitor. A fresh set ("try again")
    // is an explicit refetch().
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
