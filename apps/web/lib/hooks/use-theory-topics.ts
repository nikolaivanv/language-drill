import { useQuery } from '@tanstack/react-query';
import {
  type AuthenticatedFetch,
  TheoryListResponseSchema,
  type TheoryListItem,
} from '@language-drill/api-client';
import {
  type LearningLanguage,
  type TheoryCategoryId,
  FALLBACK_CATEGORY_ID,
} from '@language-drill/shared';
import { listStaticTheoryTopics } from '../../content/theory';

export type UseTheoryTopicsParams = {
  language: LearningLanguage;
  /**
   * Optional. When omitted the hook degrades to static-only — no `useQuery`,
   * just `listStaticTheoryTopics(language)` sorted by title.
   */
  fetchFn?: AuthenticatedFetch;
};

/**
 * A topic row as the library consumes it: the wire fields plus the server-side
 * enrichment (`category`, `order`). `TheoryToc`/`TheoryEmpty` read only
 * `id`/`title`, so widening this is non-breaking for those call sites.
 */
export type TheoryTopicListItem = {
  id: string;
  title: string;
  cefr: string;
  category: TheoryCategoryId;
  order: number | null;
};

export type UseTheoryTopicsResult = {
  topics: TheoryTopicListItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

const STALE_TIME_MS = 5 * 60 * 1000;

function sortByTitle<T extends { title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title));
}

// DB items carry `category` as a plain string (the schema doesn't re-derive
// the union); the server only ever emits a valid `TheoryCategoryId`, so narrow
// it here. Static (editorial-override) topics have no curriculum key, so they
// default to the fallback category and a null curriculum position.
function toListItem(
  item: TheoryListItem | { id: string; title: string; cefr: string },
): TheoryTopicListItem {
  const enriched = item as Partial<TheoryListItem>;
  return {
    id: item.id,
    title: item.title,
    cefr: item.cefr,
    category: (enriched.category as TheoryCategoryId | undefined) ?? FALLBACK_CATEGORY_ID,
    order: enriched.order ?? null,
  };
}

export function useTheoryTopics({
  language,
  fetchFn,
}: UseTheoryTopicsParams): UseTheoryTopicsResult {
  const staticTopics = listStaticTheoryTopics(language).map(toListItem);

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

  const dbTopics = (dbQuery.data ?? []).map(toListItem);
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
