import { useQuery } from '@tanstack/react-query';
import {
  ExerciseSetResponseSchema,
  type ExerciseSetResponse,
  PublicPointsResponseSchema,
  type PublicPointsResponse,
} from '../schemas/exercise';
import type { ApiFetch } from '../fetchClient';

export type PublicLanguage = 'ES' | 'DE' | 'TR';
export type PublicLevel = 'A1' | 'A2' | 'B1' | 'B2';

/**
 * Levels the public conjugation pool actually has approved content for, per
 * language. Prod measurement at branch-time found ZERO approved conjugation
 * rows for ES/DE at B2 — offering it in a picker one click from the default
 * would land a first-time, no-context visitor on an empty state. Single
 * source of truth for both the page's level picker and its empty-state copy;
 * update this when the pool gains B2 coverage for ES/DE.
 */
export const PUBLIC_LEVELS_BY_LANGUAGE: Record<PublicLanguage, PublicLevel[]> = {
  ES: ['A1', 'A2', 'B1'],
  DE: ['A1', 'A2', 'B1'],
  TR: ['A1', 'A2', 'B1', 'B2'],
};

export type UsePublicConjugationSetParams = {
  lang: PublicLanguage;
  level: PublicLevel;
  count?: number;
  /**
   * Narrow the sitting to one grammar point. The server validates this against
   * the curriculum and 400s an unknown key, so only pass values that came from
   * `usePublicConjugationPoints` for the same language and level.
   */
  grammarPoint?: string;
  fetchFn: ApiFetch;
  enabled?: boolean;
};

/**
 * The anonymous conjugation sitting. No token, no writes: the set is fetched
 * once and graded client-side, so there is no submit mutation to pair with it.
 */
export function usePublicConjugationSet({
  lang,
  level,
  count,
  grammarPoint,
  fetchFn,
  enabled = true,
}: UsePublicConjugationSetParams) {
  return useQuery<ExerciseSetResponse, Error>({
    queryKey: ['public-conjugation-set', lang, level, count, grammarPoint],
    queryFn: async () => {
      const params = new URLSearchParams({ lang, level });
      if (count !== undefined) params.set('count', String(count));
      if (grammarPoint) params.set('grammarPoint', grammarPoint);
      const response = await fetchFn(`/public/conjugation/set?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseSetResponseSchema.parse(json);
    },
    enabled,
    // The sitting must not change under the visitor. A fresh set ("try again")
    // is an explicit refetch().
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}


// ---------------------------------------------------------------------------
// usePublicConjugationPoints
// ---------------------------------------------------------------------------

export type UsePublicConjugationPointsParams = {
  lang: PublicLanguage;
  level: PublicLevel;
  fetchFn: ApiFetch;
  enabled?: boolean;
};

/**
 * The grammar points that actually have content for a language + level.
 *
 * Only offering points that exist is the same rule that hides B2 for ES and DE
 * in the level nav: a picker that lands a first-time visitor on an empty state
 * is worse than a shorter picker.
 *
 * Unlike the set, this is stable data, so it is allowed to be cached across
 * mounts rather than pinned for the sitting.
 */
export function usePublicConjugationPoints({
  lang,
  level,
  fetchFn,
  enabled = true,
}: UsePublicConjugationPointsParams) {
  return useQuery<PublicPointsResponse, Error>({
    queryKey: ['public-conjugation-points', lang, level],
    queryFn: async () => {
      const params = new URLSearchParams({ lang, level });
      const response = await fetchFn(`/public/conjugation/points?${params.toString()}`);
      const json: unknown = await response.json();
      return PublicPointsResponseSchema.parse(json);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
