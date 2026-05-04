import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  TodayPlanResponseSchema,
  type TodayPlanResponse,
} from '../schemas/today';
import type { AuthenticatedFetch } from '../fetchClient';

// The today-plan response moves on session completion, so we cache for one
// minute — short enough that finishing a session and returning to the
// dashboard reflects fresh `done` items, long enough that tab focus / window
// resize don't refire the request unnecessarily.
const TODAY_PLAN_STALE_TIME_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// useTodayPlan — GET /sessions/today?language=<…>
// ---------------------------------------------------------------------------

export type UseTodayPlanParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useTodayPlan({
  fetchFn,
  language,
  enabled = true,
}: UseTodayPlanParams): UseQueryResult<TodayPlanResponse, Error> {
  return useQuery<TodayPlanResponse, Error>({
    queryKey: ['todayPlan', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/sessions/today?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return TodayPlanResponseSchema.parse(json);
    },
    enabled,
    staleTime: TODAY_PLAN_STALE_TIME_MS,
  });
}
