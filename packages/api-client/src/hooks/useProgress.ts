import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  ProgressRadarResponseSchema,
  ProgressHeatmapResponseSchema,
  type ProgressRadarResponse,
  type ProgressHeatmapResponse,
} from '../schemas/progress';
import type { AuthenticatedFetch } from '../fetchClient';

const PROGRESS_STALE_TIME_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// useProgressRadar — GET /progress/radar?language=<…>
// ---------------------------------------------------------------------------

export type UseProgressRadarParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useProgressRadar({
  fetchFn,
  language,
  enabled = true,
}: UseProgressRadarParams): UseQueryResult<ProgressRadarResponse, Error> {
  return useQuery<ProgressRadarResponse, Error>({
    queryKey: ['progressRadar', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/progress/radar?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return ProgressRadarResponseSchema.parse(json);
    },
    enabled,
    staleTime: PROGRESS_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// useProgressHeatmap — GET /progress/heatmap?language=<…>
// ---------------------------------------------------------------------------

export type UseProgressHeatmapParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useProgressHeatmap({
  fetchFn,
  language,
  enabled = true,
}: UseProgressHeatmapParams): UseQueryResult<ProgressHeatmapResponse, Error> {
  return useQuery<ProgressHeatmapResponse, Error>({
    queryKey: ['progressHeatmap', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/progress/heatmap?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return ProgressHeatmapResponseSchema.parse(json);
    },
    enabled,
    staleTime: PROGRESS_STALE_TIME_MS,
  });
}
