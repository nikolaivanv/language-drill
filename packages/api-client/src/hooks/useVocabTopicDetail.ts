import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  VocabTopicDetailSchema,
  type VocabTopicDetail,
} from '../schemas/vocab';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseVocabTopicDetailParams = {
  umbrellaKey: string;
  fetchFn?: AuthenticatedFetch;
};

export function useVocabTopicDetail({
  umbrellaKey,
  fetchFn,
}: UseVocabTopicDetailParams): UseQueryResult<VocabTopicDetail, Error> {
  return useQuery({
    queryKey: ['vocab', 'topic', umbrellaKey],
    queryFn: async () => {
      const response = await fetchFn!(`/vocab/topics/${encodeURIComponent(umbrellaKey)}`);
      const json: unknown = await response.json();
      return VocabTopicDetailSchema.parse(json);
    },
    enabled: fetchFn !== undefined && umbrellaKey.length > 0,
    staleTime: STALE_TIME_MS,
  });
}
