import { useQuery, useMutation, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  FluencySessionResponseSchema,
  type FluencySessionRequest,
  type FluencySessionResponse,
  FluencyAttemptResponseSchema,
  type FluencyAttemptRequest,
  type FluencyAttemptResponse,
  FluencyStatsResponseSchema,
  type FluencyStatsResponse,
} from '../schemas/fluency';
import type { AuthenticatedFetch } from '../fetchClient';

const FLUENCY_STATS_STALE_TIME_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// useFluencySession — POST /fluency/session
// ---------------------------------------------------------------------------

export type UseFluencySessionOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useFluencySession({ fetchFn }: UseFluencySessionOptions) {
  return useMutation<FluencySessionResponse, Error, FluencySessionRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/fluency/session', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return FluencySessionResponseSchema.parse(json);
    },
  });
}

// ---------------------------------------------------------------------------
// useSubmitFluencyAttempt — POST /fluency/attempts
// ---------------------------------------------------------------------------

export type UseSubmitFluencyAttemptOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitFluencyAttempt({ fetchFn }: UseSubmitFluencyAttemptOptions) {
  return useMutation<FluencyAttemptResponse, Error, FluencyAttemptRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/fluency/attempts', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return FluencyAttemptResponseSchema.parse(json);
    },
  });
}

// ---------------------------------------------------------------------------
// useFluencyStats — GET /fluency/stats?language=<…>
// ---------------------------------------------------------------------------

export type UseFluencyStatsParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useFluencyStats({
  fetchFn,
  language,
  enabled = true,
}: UseFluencyStatsParams): UseQueryResult<FluencyStatsResponse, Error> {
  return useQuery<FluencyStatsResponse, Error>({
    queryKey: ['fluencyStats', language],
    queryFn: async () => {
      const response = await fetchFn(`/fluency/stats?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return FluencyStatsResponseSchema.parse(json);
    },
    enabled,
    staleTime: FLUENCY_STATS_STALE_TIME_MS,
  });
}
