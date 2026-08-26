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

/**
 * The variant-seeded exercise types, as a set. A FUNCTION, not a constant, for
 * the TDZ reason above — callers must not hoist the result to module scope.
 *
 * Exported so `assertCurriculumInvariants` can reject an `appliesTo` naming a
 * type that never seeds from the variant pool (where the scoping would read as
 * deliberate but do nothing) without restating the list and drifting from it.
 */
export function variantSeededTypeSet(): ReadonlySet<ExerciseType> {
  variantSeededTypes ??= new Set([
    ExerciseType.CLOZE,
    ExerciseType.TRANSLATION,
    ExerciseType.SENTENCE_CONSTRUCTION,
  ]);
  return variantSeededTypes;
}

function isVariantSeededType(exerciseType: ExerciseType): boolean {
  return variantSeededTypeSet().has(exerciseType);
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
  return variantsForType(grammarPoint, exerciseType).find((v) => v.id === seedWord);
}

/**
 * The point's construction variants that may be requested on `exerciseType` —
 * the ONLY sanctioned way to read `constructionVariants`.
 *
 * A variant with no `appliesTo` applies everywhere (the overwhelming majority);
 * one with `appliesTo` applies only to the listed types. See the field's doc on
 * `ConstructionVariant` for why a variant can be clean in translation and
 * unrealizable in cloze.
 *
 * Reading `grammarPoint.constructionVariants` directly anywhere else
 * re-introduces the drift this module exists to prevent: the seeder would stop
 * requesting an excluded variant while the target arithmetic, the validator
 * directive, and the collapse audit all still expected it — the cell would then
 * sit permanently under a target it cannot reach, and the audit would report a
 * deliberate exclusion as an unrealized declaration.
 *
 * Returns a plain array (possibly empty) so every caller can treat the
 * no-variants and all-excluded cases identically.
 */
export function variantsForType(
  grammarPoint: GrammarPoint,
  exerciseType: ExerciseType,
): readonly ConstructionVariant[] {
  const declared = grammarPoint.constructionVariants;
  if (!declared || declared.length === 0) return [];
  return declared.filter(
    (v) => v.appliesTo === undefined || v.appliesTo.includes(exerciseType),
  );
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

/**
 * Drafts a variant must have been asked for, with zero approvals, before the
 * seeder stops asking. Higher than the coverage-axis `GIVE_UP_MIN_ATTEMPTS`
 * of 2: a coverage bucket is targeted once or twice a batch, whereas a variant
 * routinely takes 10+ ordinals, so 2 misses is noise and would let one bad
 * batch retire a good construction for the whole lapse window.
 *
 * Five is enough to be sure while still catching every case measured on the
 * 2026-08-26 prod run — `falls-open-condition` 0/7, `derived-noun-verbal-
 * paraphrase` 0/8, `present-tense-scheduled-future` 0/14.
 */
export const VARIANT_GIVE_UP_MIN_ATTEMPTS = 5;

/**
 * Days after which generation give-up expires on its own and the subject gets
 * one fresh attempt — both the cell-level `skip-low-yield` /
 * `skip-saturated-dedup` suppression and per-variant seeding give-up.
 *
 * Give-up otherwise clears only when the grammar point changes, which cannot
 * see the other things that fix a stuck cell: a generation or validation prompt
 * change, a model swap, a widened seed pool, an `acceptableAnswers` policy fix.
 * The lapse is the safety valve so nothing depends on a human noticing.
 *
 * Lives in shared (not `@language-drill/lambda`, where `decideEnqueue` reads
 * it) because `packages/db`'s variant seeder applies the same window and `db`
 * cannot depend on `lambda` — the same reason `MIN_PER_VARIANT` lives here.
 */
export const SUPPRESSION_LAPSE_DAYS = 30;

/**
 * Per-variant generation outcome for one batch: `{ variantId: { requested,
 * approved } }`. `requested` counts ordinals SEEDED with that variant;
 * `approved` counts how many of those produced an approved row. Mirrors
 * `CoverageOutcome`, persisted on `generation_jobs.variant_outcome`.
 */
export type VariantOutcome = Record<
  string,
  { requested: number; approved: number }
>;

/**
 * Attempts required before a NONZERO approval rate is judged, and the rate a
 * variant must clear.
 *
 * Higher bar than the zero rule because a nonzero rate is a noisier signal
 * than a flat zero — a variant at 2/12 may be badly framed or may just have
 * had a bad fortnight. 12 attempts at under 20% is roughly "two full nights of
 * a variant's share, almost all rejected".
 *
 * These only bite because outcomes ACCUMULATE (`mergeVariantOutcomes`).
 * Measured on the 2026-08-26 prod run, a ratio rule over a single batch caught
 * 1 variant-batch out of 386: a variant seldom draws 10+ ordinals in one night
 * once a pool starts filling. Over accumulated evidence the same rule reaches
 * the real cases (perception-verb-infinitive 1/17, digindan-dolayi-formal
 * 1/12, explicativa-comma-relative 1/14).
 */
export const VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS = 12;
export const VARIANT_GIVE_UP_MIN_RATE = 0.2;

/**
 * Fold this batch's per-variant tally into the evidence carried forward.
 *
 * Give-up needs evidence across batches, not one batch (see
 * `VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS`). The caller supplies `carried` only
 * while the point is unchanged and the evidence is inside the lapse window, so
 * accumulation resets exactly when give-up itself resets — edit a variant's
 * directive and its history is discarded along with its suppression, which is
 * what stops a fixed variant from being judged on its broken past.
 *
 * Pure; neither argument is mutated.
 */
export function mergeVariantOutcomes(
  carried: VariantOutcome | null | undefined,
  batch: VariantOutcome | null | undefined,
): VariantOutcome | null {
  if (!carried && !batch) return null;
  const out: VariantOutcome = {};
  for (const source of [carried, batch]) {
    if (!source) continue;
    for (const [id, o] of Object.entries(source)) {
      const bucket = (out[id] ??= { requested: 0, approved: 0 });
      bucket.requested += o.requested;
      bucket.approved += o.approved;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Variant ids to stop seeding, read off the previous batch's outcome.
 *
 * WHY. `pickVariantSeeds` ranks by deficit, so it always targets the
 * least-covered variant — and a variant is least-covered precisely BECAUSE the
 * validator keeps rejecting it. That is adverse selection: every night the
 * seeder doubles down on whatever is hardest to approve, and a cell can never
 * finish. Measured on prod when the 2026-08-25 `appliesTo` scoping removed the
 * worst variant of four cells: the drafts simply moved to the next-worst, which
 * then failed too (`falls-open-condition` 0/7, `perception-verb-infinitive`
 * 1/11). Give-up is the general form of that fix; `appliesTo` handles one
 * variant at a time.
 *
 * Strict `approved === 0`, matching the coverage-axis rule: a variant that can
 * produce at all, however poorly, still teaches its construction, and a
 * ratio-based rule would retire the headline pattern of a point over a bad
 * week.
 */
export function variantsGivenUp(
  outcome: VariantOutcome | null | undefined,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (!outcome) return out;
  for (const [id, o] of Object.entries(outcome)) {
    // Two rules, deliberately asymmetric. Zero approvals is a clean signal and
    // needs little evidence; a poor-but-nonzero rate is noisy and needs more,
    // because a variant that CAN produce still teaches its construction and
    // retiring it wrongly costs the point a pattern it is supposed to drill.
    if (o.requested >= VARIANT_GIVE_UP_MIN_ATTEMPTS && o.approved === 0) {
      out.add(id);
      continue;
    }
    if (
      o.requested >= VARIANT_GIVE_UP_MIN_RATED_ATTEMPTS &&
      o.approved / o.requested < VARIANT_GIVE_UP_MIN_RATE
    ) {
      out.add(id);
    }
  }
  return out;
}

export type PickVariantSeedsOptions = {
  /** The point's declared variants, in curriculum order (ties break on it). */
  variants: readonly ConstructionVariant[];
  /** Live approved count per variant id. Unknown keys (legacy frequency-word
   *  seeds) are ignored — they belong to no variant. */
  coverage: ReadonlyMap<string, number>;
  /** Number of draft ordinals to assign. */
  count: number;
  /**
   * Variant ids the previous batch proved unproductive (`variantsGivenUp`).
   * Excluded from ranking entirely — NOT merely down-weighted, because deficit
   * ranking would otherwise keep handing them every slot. Ignored wholesale if
   * it would leave nothing to seed from; see `pickVariantSeeds`.
   */
  givenUp?: ReadonlySet<string>;
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
  const { coverage, count, givenUp } = opts;
  if (count <= 0 || opts.variants.length === 0) return [];

  // Give-up narrows the pool, but never empties it: an unseeded slot falls back
  // to free generation, which is the frame collapse this picker exists to
  // remove. If every variant has been given up the cell has a bigger problem
  // than seeding — `skip-low-yield` is the mechanism that should catch it — so
  // seed from the full list and let the cell-level suppression do its job.
  const eligible =
    givenUp && givenUp.size > 0
      ? opts.variants.filter((v) => !givenUp.has(v.id))
      : opts.variants;
  const variants = eligible.length > 0 ? eligible : opts.variants;

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
