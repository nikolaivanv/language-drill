/**
 * packages/shared — Deficit-ranked picker for construction-variant seeding
 * (construction variants, 2026-08-08 spec). Lives in shared, not db, because
 * `packages/ai`'s eval harness needs it too and may never import
 * `@language-drill/db`.
 *
 * Unlike `pickSeeds` / `pickTargetSeeds`, whose band entries are one-shot
 * identities excluded once used, a construction variant is a BUCKET that needs
 * many exercises. Plain exclusion would consume every variant in the first
 * batch and then stall the cell. This picker instead ranks variants by how far
 * their live approved count sits below their fair share of the pool, and
 * decrements that deficit as it assigns slots.
 *
 * Quotas are computed against `totalCovered + count` rather than an injected
 * cell target: it self-normalizes toward the declared shares as the pool grows,
 * and it keeps this module free of any dependency on `@language-drill/lambda`
 * (where `resolveCellTarget` lives).
 *
 * Pure function — no I/O. Deterministic: identical inputs, identical output.
 */

import type { ConstructionVariant } from './curriculum-types';

/**
 * Minimum approved exercises a single construction variant should reach before
 * the cell is considered done. Four is enough for a variant to appear in a
 * learner's rotation without letting a 6-variant point balloon its cell target.
 *
 * Lives in shared (not `@language-drill/lambda`, where the one runtime
 * consumer `resolveCellTarget` lives) because `packages/db`'s curriculum
 * invariants also need it at authoring time — a `targetOverride` too small to
 * cover `constructionVariants.length * MIN_PER_VARIANT` is rejected by
 * `assertCurriculumInvariants` (packages/db/src/curriculum/index.ts) rather
 * than by a runtime throw, since `db` cannot depend on `lambda`.
 */
export const MIN_PER_VARIANT = 4;

export type PickVariantSeedsOptions = {
  /** The point's declared variants, in curriculum order (ties break on it). */
  variants: readonly ConstructionVariant[];
  /** Live approved count per variant id. Unknown keys (legacy frequency-word
   *  seeds) are ignored — they belong to no variant. */
  coverage: ReadonlyMap<string, number>;
  /** Number of draft ordinals to assign. */
  count: number;
};

/**
 * One variant id per ordinal, most-starved first. NEVER returns null: an
 * unseeded slot would fall back to free generation, which is the frame collapse
 * this picker exists to remove.
 *
 * The non-null guarantee holds without a defensive fallback: the deficits sum
 * to `sum(max(0, quota_i - coverage_i)) >= sum(quota_i - coverage_i) ==
 * poolAfterBatch - totalCovered == count` before any picks are made, and each
 * pick decrements exactly one deficit by 1. After `k < count` picks the sum is
 * still `>= count - k >= 1`, so some deficit is always strictly positive when
 * the loop looks for `best` — there is always a variant left to seed.
 */
export function pickVariantSeeds(opts: PickVariantSeedsOptions): string[] {
  const { variants, coverage, count } = opts;
  if (count <= 0 || variants.length === 0) return [];

  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);
  // Only declared variants count toward the pool size — a legacy frequency-word
  // seedWord is not evidence that any variant is covered.
  const totalCovered = variants.reduce(
    (sum, v) => sum + (coverage.get(v.id) ?? 0),
    0,
  );
  const poolAfterBatch = totalCovered + count;

  // Remaining need per variant, floored at 0.
  const deficits = variants.map((v) => {
    const quota = (poolAfterBatch * (v.share ?? 1)) / totalShare;
    return Math.max(0, quota - (coverage.get(v.id) ?? 0));
  });

  const result: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let best = 0;
    for (let i = 1; i < variants.length; i++) {
      // Strict `>` keeps curriculum order as the tie-break, which makes the
      // whole picker deterministic without hashing.
      if (deficits[i] > deficits[best]) best = i;
    }
    result.push(variants[best].id);
    deficits[best] -= 1;
  }
  return result;
}
