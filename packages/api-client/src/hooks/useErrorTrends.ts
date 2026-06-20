import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '../fetchClient';
import { ErrorTrendsResponseSchema, type ErrorTrendsResponse } from '../schemas/error-trends';

const ERROR_TRENDS_STALE_TIME_MS = 5 * 60 * 1000;

export interface UseErrorTrendsParams {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
}

export function useErrorTrends({
  fetchFn,
  language,
  enabled = true,
}: UseErrorTrendsParams): UseQueryResult<ErrorTrendsResponse, Error> {
  return useQuery<ErrorTrendsResponse, Error>({
    queryKey: ['errorTrends', language],
    queryFn: async () => {
      const response = await fetchFn(`/insights/error-trends?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return ErrorTrendsResponseSchema.parse(json);
    },
    enabled,
    staleTime: ERROR_TRENDS_STALE_TIME_MS,
  });
}
