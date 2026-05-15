import { useQuery } from '@tanstack/react-query';
import {
  type AuthenticatedFetch,
  TheoryListResponseSchema,
  type TheoryListItem,
} from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { listStaticTheoryTopics } from '../../content/theory';

export type UseTheoryTopicsParams = {
  language: LearningLanguage;
  /**
   * Optional. When omitted the hook degrades to static-only — no `useQuery`,
   * just `listStaticTheoryTopics(language)` sorted by title.
   */
  fetchFn?: AuthenticatedFetch;
};

export type UseTheoryTopicsResult = {
  topics: Array<{ id: string; title: string; cefr: string }>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

const STALE_TIME_MS = 5 * 60 * 1000;

function sortByTitle<T extends { title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title));
}

export function useTheoryTopics({
  language,
  fetchFn,
}: UseTheoryTopicsParams): UseTheoryTopicsResult {
  const staticTopics = listStaticTheoryTopics(language);

  const dbQuery = useQuery<TheoryListItem[], Error>({
    queryKey: ['theory', 'list', language],
    enabled: fetchFn !== undefined,
    staleTime: STALE_TIME_MS,
    queryFn: async () => {
      // fetchFn is non-undefined here because `enabled` gates this branch.
      const res = await fetchFn!(`/theory/${language}`);
      const json: unknown = await res.json();
      return TheoryListResponseSchema.parse(json).topics;
    },
  });

  if (fetchFn === undefined) {
    return {
      topics: sortByTitle(staticTopics),
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  const dbTopics = dbQuery.data ?? [];
  const seen = new Set(staticTopics.map((t) => t.id));
  const merged = sortByTitle([
    ...staticTopics,
    ...dbTopics.filter((t) => !seen.has(t.id)),
  ]);

  return {
    topics: merged,
    isLoading: dbQuery.isLoading,
    isError: dbQuery.isError,
    error: dbQuery.error,
  };
}
