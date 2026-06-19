import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  InsightsErrorsResponseSchema,
  type InsightsErrorsResponse,
} from '../schemas/insights';

const INSIGHTS_STALE_TIME_MS = 5 * 60 * 1000;

export interface UseInsightsErrorsParams {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
}

export function useInsightsErrors({
  fetchFn,
  language,
  enabled = true,
}: UseInsightsErrorsParams): UseQueryResult<InsightsErrorsResponse, Error> {
  return useQuery<InsightsErrorsResponse, Error>({
    queryKey: ['insightsErrors', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/insights/errors?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return InsightsErrorsResponseSchema.parse(json);
    },
    enabled,
    staleTime: INSIGHTS_STALE_TIME_MS,
  });
}
