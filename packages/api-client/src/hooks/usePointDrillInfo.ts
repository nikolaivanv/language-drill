import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { PointDrillInfoResponseSchema, type PointDrillInfoResponse } from '../schemas/progress';
import type { AuthenticatedFetch } from '../fetchClient';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UsePointDrillInfoParams = {
  fetchFn: AuthenticatedFetch;
  grammarPointKey: string;
  enabled?: boolean;
};

/**
 * Targeted-drill facts for one grammar point (any CEFR level): per-type
 * approved-exercise counts + the caller's mastery snapshot. Backs the theory
 * detail page's "drill this point" block.
 */
export function usePointDrillInfo({
  fetchFn,
  grammarPointKey,
  enabled = true,
}: UsePointDrillInfoParams): UseQueryResult<PointDrillInfoResponse, Error> {
  return useQuery<PointDrillInfoResponse, Error>({
    queryKey: ['progress', 'point', grammarPointKey],
    queryFn: async () => {
      const response = await fetchFn(`/progress/points/${encodeURIComponent(grammarPointKey)}`);
      const json: unknown = await response.json();
      return PointDrillInfoResponseSchema.parse(json);
    },
    enabled: enabled && grammarPointKey.length > 0,
    staleTime: STALE_TIME_MS,
  });
}
