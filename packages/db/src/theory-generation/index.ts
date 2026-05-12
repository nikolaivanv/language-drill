/**
 * Public surface of `packages/db/src/theory-generation/`.
 *
 * Stable, additive package barrel for the Phase 2 theory-generation pipeline.
 * The single-cell orchestrator (`runOneTheoryCell`) + the theory-cell
 * enumerator are exposed here so both the Phase 2 CLI script
 * (`packages/db/scripts/generate-theory.ts`, Task 20) and the Phase 4 theory
 * generation Lambda (per design.md Component 4's "Reuses" note) can import via
 * `@language-drill/db` without deep relative imports.
 *
 * Mirrors the exercise-generation barrel at `./generation/index.ts` — the two
 * surfaces are intentionally symmetric so future cross-pipeline tooling (pool
 * dashboards, batch runners) can treat them uniformly.
 *
 * Internal helpers (the private `failClosed` inside `run-one-cell.ts`, the
 * curriculum lookups inside `cells.ts`, etc.) are NOT re-exported — they're
 * implementation details and may change without a barrel bump.
 */

export { enumerateTheoryCells, THEORY_ROUND_1_CEFR_LEVELS, type TheoryCell } from './cells';
export { runOneTheoryCell, type RunOneTheoryCellInput, type TheoryCellResult } from './run-one-cell';
