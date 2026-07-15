import { useQuery } from '@tanstack/react-query';
import {
  type AuthenticatedFetch,
  parseTheoryTopicJson,
} from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { renderTheoryTopicJson } from '../../components/theory/render-json';
import type { TheoryTopic } from '../../components/theory/types';

export type UseTheoryTopicParams = {
  language: LearningLanguage;
  topicId: string;
  /**
   * Optional. When omitted the hook has nothing to fetch and returns `null`
   * (no `useQuery`). Lets sync-only call paths consume the same hook without
   * manufacturing an `AuthenticatedFetch`.
   */
  fetchFn?: AuthenticatedFetch;
};

export type UseTheoryTopicResult = {
  topic: TheoryTopic | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

const STALE_TIME_MS = 5 * 60 * 1000;

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function useTheoryTopic({
  language,
  topicId,
  fetchFn,
}: UseTheoryTopicParams): UseTheoryTopicResult {
  const dbQuery = useQuery<TheoryTopic, Error>({
    queryKey: ['theory', 'topic', language, topicId],
    enabled: fetchFn !== undefined,
    staleTime: STALE_TIME_MS,
    retry: (failureCount, error) => {
      const status = statusOf(error);
      // 4xx (incl. 404) — terminal, don't retry. 5xx — retry once.
      if (status !== undefined && status < 500) return false;
      return failureCount < 1;
    },
    queryFn: async () => {
      // fetchFn is non-undefined here because `enabled` gates this branch.
      const res = await fetchFn!(`/theory/${language}/${encodeURIComponent(topicId)}`);
      const json: unknown = await res.json();
      const parsed = parseTheoryTopicJson(json);
      return renderTheoryTopicJson(parsed);
    },
  });

  if (fetchFn === undefined) {
    return { topic: null, isLoading: false, isError: false, error: null };
  }

  if (dbQuery.error && statusOf(dbQuery.error) === 404) {
    // 404 is "no row for this slug yet" — surface as the empty state, not an error.
    return { topic: null, isLoading: false, isError: false, error: null };
  }

  return {
    topic: dbQuery.data ?? null,
    isLoading: dbQuery.isLoading,
    isError: dbQuery.isError,
    error: dbQuery.error,
  };
}
