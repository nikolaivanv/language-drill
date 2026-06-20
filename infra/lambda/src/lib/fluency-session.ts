import { MIN_FLUENCY_POOL, FLUENCY_ELIGIBLE_TYPES, type ExerciseType } from '@language-drill/shared';

/** An eligible exercise row, shaped for the wire response. */
export type EligibleExercise = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: unknown;
};

export type FluencySessionResult =
  | { insufficient: true; available: number; items: [] }
  | { insufficient: false; available: number; items: EligibleExercise[] };

/**
 * Pure composition for POST /fluency/session.
 * - Below MIN_FLUENCY_POOL eligible items → insufficient (route returns 409).
 * - Otherwise shuffle (Fisher-Yates with injectable rng) and take up to `count`.
 * `rng` defaults to Math.random; tests inject a deterministic stub.
 */
export function composeFluencySession(
  pool: readonly EligibleExercise[],
  count: number,
  rng: () => number = Math.random,
): FluencySessionResult {
  const available = pool.length;
  if (available < MIN_FLUENCY_POOL) {
    return { insufficient: true, available, items: [] };
  }
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { insufficient: false, available, items: shuffled.slice(0, count) };
}

/**
 * Resolve which exercise types a fluency session should query.
 * - No requested types → all eligible types (the mixed-pool default).
 * - Requested types → the intersection with FLUENCY_ELIGIBLE_TYPES, preserving
 *   the eligible-list order. Non-eligible requests are dropped (the route's Zod
 *   schema already rejects unknown enum values; this is defense in depth).
 * Always returns a non-empty list: an all-dropped request falls back to all
 * eligible types so the SQL `IN (...)` can never be empty.
 */
export function resolveFluencyTypes(
  requested?: readonly ExerciseType[],
): ExerciseType[] {
  if (!requested || requested.length === 0) {
    return [...FLUENCY_ELIGIBLE_TYPES];
  }
  const requestedSet = new Set(requested);
  const filtered = FLUENCY_ELIGIBLE_TYPES.filter((t) => requestedSet.has(t));
  return filtered.length > 0 ? filtered : [...FLUENCY_ELIGIBLE_TYPES];
}
