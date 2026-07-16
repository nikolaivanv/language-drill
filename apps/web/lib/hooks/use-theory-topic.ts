import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  type AuthenticatedFetch,
  type RelatedTheoryTopics,
  parseRelatedTheoryTopics,
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
  /**
   * Server-derived related topics (prereq edges + theory category), already
   * filtered to topics with an approved page. Null when the payload predates
   * the enrichment or it failed to parse — never blocks the topic itself.
   */
  related: RelatedTheoryTopics | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /**
   * True while a *different* topic's data is being fetched but the previously
   * loaded topic is still on screen (via `keepPreviousData`). Lets the caller
   * dim the content during a switch without unmounting the surrounding chrome
   * (the left nav), so switching topics never "reloads the whole page".
   */
  isPlaceholder: boolean;
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
  const dbQuery = useQuery<{ topic: TheoryTopic; related: RelatedTheoryTopics | null }, Error>({
    queryKey: ['theory', 'topic', language, topicId],
    enabled: fetchFn !== undefined,
    staleTime: STALE_TIME_MS,
    // Keep the last topic's data on screen while the next one loads, so an
    // in-place topic switch (panel drawer / detail route) never blanks the
    // body out to a loading spinner and remounts the left nav underneath it.
    placeholderData: keepPreviousData,
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
      return {
        topic: renderTheoryTopicJson(parsed),
        related: parseRelatedTheoryTopics(json),
      };
    },
  });

  if (fetchFn === undefined) {
    return {
      topic: null,
      related: null,
      isLoading: false,
      isError: false,
      error: null,
      isPlaceholder: false,
    };
  }

  if (dbQuery.error && statusOf(dbQuery.error) === 404) {
    // 404 is "no row for this slug yet" — surface as the empty state, not an error.
    return {
      topic: null,
      related: null,
      isLoading: false,
      isError: false,
      error: null,
      isPlaceholder: false,
    };
  }

  return {
    topic: dbQuery.data?.topic ?? null,
    related: dbQuery.data?.related ?? null,
    isLoading: dbQuery.isLoading,
    isError: dbQuery.isError,
    error: dbQuery.error,
    isPlaceholder: dbQuery.isPlaceholderData,
  };
}
