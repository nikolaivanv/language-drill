/**
 * Public surface of `packages/db/src/generation/`.
 *
 * Stable, additive package barrel for Phase 4. The shared `runOneCell`
 * orchestration core + the curriculum-cell enumerator are exposed here so
 * both the CLI script (`packages/db/scripts/generate-exercises.ts`) and the
 * generation Lambda (`infra/lambda/src/generation/handler.ts`, Task 12) can
 * import via `@language-drill/db` without deep relative imports.
 *
 * Phase 4b / Phase 5 / Phase 6 attach against this barrel:
 *   - Phase 4b's Anthropic Batches API path can add a sibling
 *     `runOneCellBatched` and re-export it here.
 *   - Phase 5's pool-status API consumes `enumerateCurriculumCells` for the
 *     dashboard's heatmap.
 *   - Phase 6's new exercise types extend `enumerateCurriculumCells`'s
 *     compatibility matrix; no barrel change required.
 *
 * Other internal helpers (the private `failClosed` in `run-one-cell.ts`,
 * etc.) are NOT re-exported — they're implementation details.
 *
 * `routeValidationResult` IS re-exported here: the generation-eval harness
 * (`packages/ai/scripts/eval-gen-run.ts`) routes validator verdicts to the
 * same `(reviewStatus, flaggedReasons)` the writer applies, so it needs the
 * canonical routing helper through the package barrel rather than the
 * scripts-dir `packages/db/scripts/generate-exercises-validate.ts` re-export
 * (Phase 3's published surface, kept for back-compat) which a cross-package
 * consumer cannot reach.
 */

export {
  ROUND_1_CEFR_LEVELS,
  enumerateCurriculumCells,
  type Cell,
  type Round1CefrLevel,
} from './cells';

export {
  runOneCell,
  type CellResult,
  type RunOneCellInput,
} from './run-one-cell';

export {
  validateAndInsertWithRetry,
  type DraftOutcome,
} from './validate-and-insert';

export {
  routeValidationResult,
  VALIDATION_THRESHOLDS,
  type ReviewStatus,
  type RoutingDecision,
} from './routing';

export { applicableCoverageTags } from './coverage-tags';
