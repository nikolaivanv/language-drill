/**
 * Per-cell generation target arithmetic (R3). Pure: no I/O, no env.
 *
 * Replaces the flat `TARGET_PER_CELL = 50` the scheduler used to top up every
 * cell with a target derived from the cell's grammar point and
 * `(exerciseType, cefrLevel)`, so narrow A1/A2 cells stop grinding an
 * unreachable 50 into dedup waste.
 *
 * Resolution order:
 *   1. `grammarPoint.targetOverride` — per-point precision knob for a narrow
 *      point whose realistic distinct-exercise supply is well below the level
 *      default; wins outright (R3.2).
 *   2. `CELL_TARGET_DEFAULTS[exerciseType][cefrLevel]` — the level-appropriate
 *      default, raised if needed to cover the largest single-axis floor sum in
 *      the cell's `coverageSpec`, and separately raised to cover
 *      `constructionVariants.length * MIN_PER_VARIANT` when the point declares
 *      variants (floor-driven target: see `resolveCellTargetFor`).
 *   3. `TARGET_PER_CELL` — global fallback for any `(type, level)` the table
 *      leaves unset (e.g. B1/B2 cloze/translation, where 50 stays reachable),
 *      also subject to the floor raise above.
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
 * Design-tunable — the exact numbers are a design-phase decision (R3.1); the
 * invariants that matter are (a) narrow A1/A2 cloze/translation cells resolve
 * below the global 50, and (b) vocab_recall is capped low (10) at every level for
 * token efficiency (a single umbrella exhausts its distinct-word surface fast;
 * breadth comes from more cells).
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
  // A1/A2 have a smaller realistic distinct-exercise ceiling than the global
  // 50; B1/B2 are unset → they fall through to TARGET_PER_CELL.
  cloze: { A1: 20, A2: 30 },
  translation: { A1: 20, A2: 30 },
  sentence_construction: { A1: 20, A2: 30 },
  // A1/A2: narrow grammar-point verb-form space mirrors cloze/translation.
  // B1/B2: unset → fall through to TARGET_PER_CELL (50 remains reachable).
  conjugation: { A1: 20, A2: 30 },
  // Capped low across every level (2026-06-07): vocab cells are the worst
  // token-efficiency offenders — a single "everyday" umbrella exhausts its
  // realistic distinct-word surface fast (high dedup-give-up), so chasing the
  // old 60–75 burned tokens for near-zero net new approvals. 10 is enough to
  // give the today-plan's single vocab slot variety across sessions; breadth
  // now comes from splitting into more themed umbrellas, not a high per-cell
  // target.
  vocab_recall: { A1: 10, A2: 10, B1: 10, B2: 10 },
  // B1/B2: 15. A1/A2: 6/10 — the distinct-clip surface is small at low levels
  // (short clips), so a high target just grinds the dedup index; the per-ordinal
  // domain rotation (dictation-generation-prompts.ts) makes these reachable.
  dictation: { A1: 6, A2: 10, B1: 15, B2: 15 },
  // Free-writing prompts are batch-generated (Phase 2). Capped LOW (5) at every
  // level: a single (language, level, topic) cell has a tiny distinct-title space
  // — the dedup surface is the title — so even with the prior-title avoid-list and
  // angle rotation, narrow topics hit heavy dedup-give-up above ~5 (the 2026-06-16
  // run stalled at 3 on es-b1-fw-my-town / es-b2-fw-remote-work chasing 8). 5 is
  // reachable per topic; breadth comes from more curated topic umbrellas. A1/A2
  // are set for TR free-writing (2026-06-17).
  free_writing: { A1: 5, A2: 5, B1: 5, B2: 5 },
  // Contextual paraphrase is a B1+ production drill (register/formality
  // rewrites; not authored below B1). Capped low (8) like free_writing: a
  // single grammar-point cell has a narrow distinct-source-sentence surface,
  // so a high target would just grind the dedup index.
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
 * Resolve the generation target for a cell. Pure. Order: an explicit
 * `targetOverride` wins outright — including over the `constructionVariants`
 * floor below. A `targetOverride` too small to let every declared variant
 * reach `MIN_PER_VARIANT` is a curriculum-authoring mistake, not something
 * this resolver can safely reject: `resolveCellTarget` (the
 * `infra/lambda/src/generation/cell-targets.ts` entry point that delegates
 * here) runs uncaught inside the nightly scheduler's per-cell loop
 * (`infra/lambda/src/generation/scheduler.ts`), so throwing here would abort
 * the entire run for every language over one misconfigured point. That
 * combination is instead caught at authoring time by
 * `assertCurriculumInvariants` (`packages/db/src/curriculum/index.ts`, the
 * `constructionVariants` block), which the curriculum test suite runs on
 * every commit. Absent an override, the `(type, level)` table value (or the
 * `TARGET_PER_CELL` fallback) is raised, if needed, to cover the largest
 * single-axis floor sum in the cell's `coverageSpec` and the
 * `constructionVariants` floor. One approved exercise realizes one value per
 * axis, so an axis whose floors sum to F needs ≥ F exercises; taking the MAX
 * over axes (never the product) guarantees headroom for the tightest axis
 * without multiplying axes together. Replaces the former person-rotation
 * 1.5× multiplier with exact floor arithmetic.
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
