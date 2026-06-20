import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import { CurriculumMapResponseSchema, type CurriculumMapResponse } from '../schemas/curriculum';
import type { AuthenticatedFetch } from '../fetchClient';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseCurriculumMapParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useCurriculumMap({ fetchFn, language, enabled = true }: UseCurriculumMapParams): UseQueryResult<CurriculumMapResponse, Error> {
  return useQuery<CurriculumMapResponse, Error>({
    queryKey: ['curriculumMap', language],
    queryFn: async () => {
      const response = await fetchFn(`/progress/curriculum?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return CurriculumMapResponseSchema.parse(json);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}
