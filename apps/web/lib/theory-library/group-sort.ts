// Pure grouping / sorting / search logic for the theory library index.
//
// No React, no fetching — just transforms over the enriched topic list so the
// page can group (by category / CEFR / flat), sort (curriculum / A→Z), and
// filter (search) entirely client-side over a single cached fetch. Kept pure
// so the trickiest correctness rules (curriculum nulls-last, category order,
// search→single-group) are unit-testable in isolation.
//
import { type TheoryCategoryId, THEORY_CATEGORIES } from '@language-drill/shared';

export type GroupBy = 'category' | 'level' | 'none';
export type SortBy = 'curriculum' | 'alpha';

/**
 * A topic row as the index consumes it — the wire fields plus the server-side
 * enrichment. Structurally identical to the hook's `TheoryTopicListItem`, so
 * hook output flows straight in without mapping.
 */
export type LibraryTopic = {
  id: string;
  title: string;
  cefr: string;
  category: TheoryCategoryId;
  order: number | null;
};

export type TopicGroup = {
  /** category id | CEFR level | 'all' | 'results' */
  id: string;
  label: string;
  topics: LibraryTopic[];
};

/**
 * Case-insensitive substring filter over a topic's title and CEFR label — the
 * only searchable fields present on list items in v1 (the stored topic model
 * carries no tags/keywords). A blank/whitespace-only query returns the input
 * unchanged.
 */
export function filterTopics(
  topics: LibraryTopic[],
  query: string,
): LibraryTopic[] {
  const q = query.trim().toLowerCase();
  if (q === '') return topics;
  return topics.filter((t) =>
    `${t.title} ${t.cefr}`.toLowerCase().includes(q),
  );
}

/**
 * Returns a new, sorted array (never mutates the input).
 *
 * - `'curriculum'` — by `order` ascending; topics with a `null` order (no
 *   resolvable curriculum position) sort last, and ties break by title.
 * - `'alpha'` — locale-aware title comparison.
 */
export function sortTopics(
  topics: LibraryTopic[],
  sortBy: SortBy,
): LibraryTopic[] {
  const copy = [...topics];
  if (sortBy === 'alpha') {
    return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy.sort((a, b) => {
    const ao = a.order;
    const bo = b.order;
    if (ao === null && bo === null) return a.title.localeCompare(b.title);
    if (ao === null) return 1; // nulls last
    if (bo === null) return -1;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

// Canonical CEFR display order for level grouping (Requirement 3.3).
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/**
 * Derive a topic's CEFR grouping bucket from its display `cefr` string. The
 * list item carries the content display string (which may be a range like
 * `B1–B2`), not the structured level, so we take the first recognizable CEFR
 * token (`B1–B2` → `B1`). Returns the raw trimmed string when no token is
 * found, so such a topic still surfaces under its own group rather than being
 * dropped.
 */
function cefrBucket(cefr: string): string {
  const upper = cefr.toUpperCase();
  for (const level of CEFR_LEVELS) {
    if (upper.includes(level)) return level;
  }
  return cefr.trim();
}

/**
 * Group topics for the index. Precedence (Requirements 3.x, 5.3):
 *
 * - When `query` is non-empty → grouping collapses to a single `results`
 *   group, filtered and sorted by the active `sortBy`.
 * - `'none'` → one `all` group.
 * - `'category'` → one group per `THEORY_CATEGORIES` entry, in taxonomy order
 *   (`other` last); empty groups dropped.
 * - `'level'` → one group per CEFR level in A1…C2 order; empty levels dropped;
 *   any topic whose cefr yields a non-canonical bucket is appended after, in
 *   alphabetical bucket order, so nothing is lost.
 *
 * Topics within every group are sorted by `sortBy`.
 */
export function groupTopics(
  topics: LibraryTopic[],
  groupBy: GroupBy,
  sortBy: SortBy,
  query: string,
): TopicGroup[] {
  const filtered = filterTopics(topics, query);

  if (query.trim() !== '') {
    if (filtered.length === 0) return [];
    return [{ id: 'results', label: 'results', topics: sortTopics(filtered, sortBy) }];
  }

  if (groupBy === 'none') {
    if (filtered.length === 0) return [];
    return [{ id: 'all', label: 'all topics', topics: sortTopics(filtered, sortBy) }];
  }

  if (groupBy === 'level') {
    const groups: TopicGroup[] = [];

    for (const level of CEFR_LEVELS) {
      const inLevel = filtered.filter((t) => cefrBucket(t.cefr) === level);
      if (inLevel.length > 0) {
        groups.push({ id: level, label: level, topics: sortTopics(inLevel, sortBy) });
      }
    }

    // Defensive: surface topics whose cefr produced a non-canonical bucket.
    const canonical = new Set<string>(CEFR_LEVELS);
    const leftoverBuckets = [
      ...new Set(
        filtered
          .map((t) => cefrBucket(t.cefr))
          .filter((b) => !canonical.has(b)),
      ),
    ].sort((a, b) => a.localeCompare(b));
    for (const bucket of leftoverBuckets) {
      const inBucket = filtered.filter((t) => cefrBucket(t.cefr) === bucket);
      groups.push({ id: bucket, label: bucket, topics: sortTopics(inBucket, sortBy) });
    }

    return groups;
  }

  // groupBy === 'category' — taxonomy order, 'other' last, empties dropped.
  const groups: TopicGroup[] = [];
  for (const category of THEORY_CATEGORIES) {
    const inCategory = filtered.filter((t) => t.category === category.id);
    if (inCategory.length > 0) {
      groups.push({
        id: category.id,
        label: category.label,
        topics: sortTopics(inCategory, sortBy),
      });
    }
  }
  return groups;
}

/**
 * Split `title` around the first case-insensitive occurrence of `query` for
 * search-result highlighting. Returns `null` when the query is blank or has no
 * match (caller renders the plain title). `match` preserves the title's
 * original casing.
 */
export function highlightMatch(
  title: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const q = query.trim();
  if (q === '') return null;
  const idx = title.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return null;
  return {
    before: title.slice(0, idx),
    match: title.slice(idx, idx + q.length),
    after: title.slice(idx + q.length),
  };
}
