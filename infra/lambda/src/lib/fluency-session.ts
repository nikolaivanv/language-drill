import { MIN_FLUENCY_POOL } from '@language-drill/shared';

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
