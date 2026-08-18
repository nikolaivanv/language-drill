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

import { ExerciseType } from './index';
import type { ConstructionVariant, GrammarPoint } from './curriculum-types';

/**
 * Exercise types whose cells seed from a point's `constructionVariants` pool
 * rather than the frequency band (see `seedKindFor` in
 * `packages/db/src/generation/seed-kind.ts`). A seed slot on any other type
 * holds something else entirely — a verb lemma, an elicitation value — so a
 * variant lookup there would be a category error, not a miss.
 *
 * Built lazily, NOT at module scope: `ExerciseType` is declared in `./index`,
 * which re-exports this file, so a module-scope `new Set([ExerciseType.CLOZE])`
 * reads the enum before the barrel has initialized it and throws
 * "Cannot read properties of undefined". Function bodies run long after both
 * modules are live — the same circular-import property `generation-prompts.ts`
 * relies on for `TOOL_NAME_BY_TYPE`.
 */
let variantSeededTypes: ReadonlySet<ExerciseType> | undefined;
function isVariantSeededType(exerciseType: ExerciseType): boolean {
  variantSeededTypes ??= new Set([
    ExerciseType.CLOZE,
    ExerciseType.TRANSLATION,
    ExerciseType.SENTENCE_CONSTRUCTION,
  ]);
  return variantSeededTypes.has(exerciseType);
}

/**
 * The single rule for "which sub-construction was this draft asked to realize".
 *
 * A construction-variant seed is the variant's `id`, not a content word, so a
 * draft's `seedWord` is only a variant when the point declares one with that
 * exact id. Everything else — a frequency lemma, a conjugation verb, an
 * elicitation value, a legacy pre-#631 seed — resolves to `undefined`, which
 * is what keeps callers rendering nothing outside the variant points.
 *
 * Shared deliberately. The generation prompt has resolved this inline since
 * #631; the validation prompt started resolving it in the 2026-08-18
 * information-asymmetry fix. Two copies of this rule drifting apart is the
 * same class of bug as #664's stale point name, so there is exactly one.
 */
export function resolveConstructionVariant(
  grammarPoint: GrammarPoint,
  exerciseType: ExerciseType,
  seedWord: string | null | undefined,
): ConstructionVariant | undefined {
  if (!seedWord) return undefined;
  if (!isVariantSeededType(exerciseType)) return undefined;
  return grammarPoint.constructionVariants?.find((v) => v.id === seedWord);
}

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
