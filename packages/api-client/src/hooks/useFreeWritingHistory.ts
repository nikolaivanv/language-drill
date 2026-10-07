import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Language } from '@language-drill/shared';
import {
  FreeWritingHistoryPageSchema,
  type FreeWritingHistoryPage,
  FreeWritingAttemptSchema,
  type FreeWritingAttempt,
} from '../schemas/free-writing-history';
import type { AuthenticatedFetch } from '../fetchClient';

/** Query-key root for every free-writing history query (invalidated on submit). */
export const FREE_WRITING_HISTORY_QUERY_KEY = 'freeWritingHistory';

export type UseFreeWritingHistoryParams = {
  language?: Language;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

// Paged newest-first list of the caller's graded free-writing attempts.
export function useFreeWritingHistory({
  language,
  fetchFn,
  enabled = true,
}: UseFreeWritingHistoryParams) {
  return useInfiniteQuery<FreeWritingHistoryPage, Error>({
    queryKey: [FREE_WRITING_HISTORY_QUERY_KEY, 'list', language],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (language) params.set('language', language);
      if (typeof pageParam === 'string') params.set('cursor', pageParam);
      const qs = params.toString();
      const response = await fetchFn(`/free-writing/history${qs ? `?${qs}` : ''}`);
      const json: unknown = await response.json();
      return FreeWritingHistoryPageSchema.parse(json);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export type UseFreeWritingAttemptParams = {
  submissionId: string;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

// One stored attempt. Immutable once graded, so it never needs refetching.
export function useFreeWritingAttempt({
  submissionId,
  fetchFn,
  enabled = true,
}: UseFreeWritingAttemptParams) {
  return useQuery<FreeWritingAttempt, Error>({
    queryKey: [FREE_WRITING_HISTORY_QUERY_KEY, 'attempt', submissionId],
    queryFn: async () => {
      const response = await fetchFn(`/free-writing/history/${encodeURIComponent(submissionId)}`);
      const json: unknown = await response.json();
      return FreeWritingAttemptSchema.parse(json);
    },
    enabled,
    staleTime: Infinity,
    // A 404 (not the caller's, or no such attempt) will not change on retry.
    retry: (failureCount, error) =>
      (error as { status?: number }).status !== 404 && failureCount < 3,
  });
}
