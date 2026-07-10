import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  VocabTopicsResponseSchema,
  type VocabTopicsResponse,
} from '../schemas/vocab';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseVocabTopicsParams = {
  language: string;
  fetchFn?: AuthenticatedFetch;
};

export function useVocabTopics({
  language,
  fetchFn,
}: UseVocabTopicsParams): UseQueryResult<VocabTopicsResponse, Error> {
  return useQuery({
    queryKey: ['vocab', 'topics', language],
    queryFn: async () => {
      const response = await fetchFn!(`/vocab/topics?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return VocabTopicsResponseSchema.parse(json);
    },
    enabled: fetchFn !== undefined,
    staleTime: STALE_TIME_MS,
  });
}
