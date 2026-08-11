/**
 * Per-cell generation target arithmetic. Pure: no I/O, no env.
 *
 * Moved here from `infra/lambda/src/generation/cell-targets.ts` (2026-08-11) for
 * the same reason `MIN_PER_VARIANT` lives in shared: `packages/db` cannot depend
 * on `@language-drill/lambda`, and neither can `packages/ai`, whose
 * `audit:collapse` CLI needs a cell's target to tell "below target, self-heals"
 * from "at target, stuck". The lambda module now delegates here.
 */

import type { ExerciseType } from './index';
import type { CurriculumCefrLevel, GrammarPoint } from './curriculum-types';
import { MIN_PER_VARIANT } from './construction-variant-seed';

/** Global fallback for any `(type, level)` the table below leaves unset. */
export const TARGET_PER_CELL = 50;

/**
 * Default per-cell targets keyed by `(exerciseType, cefrLevel)`. `Partial` on the
 * level axis: an unset level falls through to `TARGET_PER_CELL`.
 *
 * Keyed by `` `${ExerciseType}` `` (a template-literal TYPE over the string enum)
 * rather than by the enum value itself. `shared/src/index.ts` re-exports this
 * module, so a module-scope RUNTIME reference to `ExerciseType` would be a real
 * init-order hazard — see the same warning at the top of `coverage.ts`. The
 * template-literal type is erased at compile time and still enforces
 * exhaustiveness, and `CELL_TARGET_DEFAULTS[someExerciseType]` still type-checks
 * because the enum's values are exactly these strings.
 */
export const CELL_TARGET_DEFAULTS: Record<
  `${ExerciseType}`,
  Partial<Record<CurriculumCefrLevel, number>>
> = {
  // A1/A2 have a smaller realistic distinct-exercise ceiling than the global 50;
  // B1/B2 are unset → they fall through to TARGET_PER_CELL.
  cloze: { A1: 20, A2: 30 },
  translation: { A1: 20, A2: 30 },
  sentence_construction: { A1: 20, A2: 30 },
  // A1/A2: narrow grammar-point verb-form space mirrors cloze/translation.
  conjugation: { A1: 20, A2: 30 },
  // Capped low across every level (2026-06-07): vocab cells are the worst
  // token-efficiency offenders — a single "everyday" umbrella exhausts its
  // realistic distinct-word surface fast (high dedup-give-up), so chasing the old
  // 60–75 burned tokens for near-zero net new approvals. Breadth now comes from
  // splitting into more themed umbrellas, not a high per-cell target.
  vocab_recall: { A1: 10, A2: 10, B1: 10, B2: 10 },
  // B1/B2: 15. A1/A2: 6/10 — the distinct-clip surface is small at low levels.
  dictation: { A1: 6, A2: 10, B1: 15, B2: 15 },
  // Capped LOW (5): the dedup surface is the title, and narrow topics hit heavy
  // dedup-give-up above ~5 (the 2026-06-16 run stalled at 3 chasing 8).
  free_writing: { A1: 5, A2: 5, B1: 5, B2: 5 },
  // B1+ only; capped low (8) — narrow distinct-source-sentence surface.
  contextual_paraphrase: { B1: 8, B2: 8 },
};

/** The structural slice of a generation cell the target arithmetic needs. The
 *  `Cell` type in `@language-drill/db` satisfies this structurally. */
export type CellTargetInput = {
  exerciseType: ExerciseType;
  cefrLevel: CurriculumCefrLevel;
  grammarPoint: GrammarPoint;
};

/**
 * Resolve the generation target for a cell. Order: an explicit `targetOverride`
 * wins outright — including over the `constructionVariants` floor. A
 * `targetOverride` too small to let every declared variant reach
 * `MIN_PER_VARIANT` is an authoring mistake caught by
 * `assertCurriculumInvariants`, NOT by a throw here: this runs uncaught inside
 * the nightly scheduler's per-cell loop, so throwing would abort the whole run
 * for every language over one misconfigured point.
 *
 * Absent an override, the `(type, level)` table value (or the `TARGET_PER_CELL`
 * fallback) is raised to cover the largest single-axis floor sum in the
 * `coverageSpec` and the `constructionVariants` floor. One approved exercise
 * realizes one value per axis, so an axis whose floors sum to F needs >= F
 * exercises; taking the MAX over axes (never the product) guarantees headroom
 * for the tightest axis without multiplying axes together.
 */
export function resolveCellTargetFor(cell: CellTargetInput): number {
  const variants = cell.grammarPoint.constructionVariants;
  const variantFloor = variants ? variants.length * MIN_PER_VARIANT : 0;

  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;

  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  const base = fromTable ?? TARGET_PER_CELL;
  const spec = cell.grammarPoint.coverageSpec;
  let maxAxisFloorSum = 0;
  if (spec) {
    for (const axis of spec.axes) {
      let sum = 0;
      for (const floor of Object.values(axis.floors)) sum += (floor as number) ?? 0;
      if (sum > maxAxisFloorSum) maxAxisFloorSum = sum;
    }
  }
  return Math.max(base, maxAxisFloorSum, variantFloor);
}
