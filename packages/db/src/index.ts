// Public surface of @language-drill/db.
//
// External consumers (other workspace packages) import everything they need
// through this barrel — never via deep relative paths into ./schema, ./lib, or
// ./curriculum. Internal consumers (scripts inside packages/db itself) may
// still use relative paths.
export * from './client';
export * from './schema';

// Explicit re-export of the theory schema module so consumers can import
// theory tables and their inferred row/insert types via the package barrel
// without reaching into ./schema/theory. The `export * from './schema'`
// wildcard above also covers these, but the explicit form documents the
// public surface for downstream callers (Phase 2 CLI, Phase 5 panel).
export {
  theoryTopics,
  theoryGenerationJobs,
  type TheoryTopic,
  type NewTheoryTopic,
  type TheoryGenerationJob,
  type NewTheoryGenerationJob,
} from './schema/theory';

// Curriculum (grammar-point taxonomy consumed by the generator and the seed
// script). Internal Phase-1 callers used relative imports; Phase 2 widens the
// surface so packages/ai and packages/db/scripts can import via the barrel.
export {
  ALL_CURRICULA,
  esCurriculum,
  deCurriculum,
  trCurriculum,
  getGrammarPoint,
  assertCurriculumInvariants,
} from './curriculum';
export type { CurriculumCefrLevel, GrammarPoint } from './curriculum';

// Helpers that Phase 1 deliberately left internal-only. Phase 2 promotes them
// because they cross the package boundary: deterministicUuid is the hash
// behind exerciseDraftId in packages/ai/src/generate.ts, and assertValidCellKey
// is the defense-in-depth check the CLI runs before each generation_jobs INSERT.
export { deterministicUuid } from './lib/deterministic-uuid';
export {
  assertValidCellKey,
  buildCellKey,
  buildCellKeyFromRow,
} from './lib/cell-key';
export {
  THEORY_CELL_KEY_REGEX,
  assertValidTheoryCellKey,
  buildTheoryCellKey,
} from './lib/theory-cell-key';

// Phase 4 — env helpers consumed by both the CLI scripts and the generation
// Lambda (`infra/lambda/src/generation/`). The Lambda's bundling tree includes
// only `packages/db/src/` (per the esbuild aliases in the Lambda construct),
// so this re-export is what makes `import { requireEnv } from '@language-drill/db'`
// work from inside the Lambda.
export { requireEnv } from './lib/env';
export { chunk } from './lib/chunk';

// Phase 5 — pool target sizing. Consumed by the admin pool-status endpoint
// (`infra/lambda/src/routes/admin.ts`) which derives a cell's refill target
// from its observed 7-day depletion rate.
export { targetCellSize } from './lib/target-cell-size';

// Phase 4 — orchestration core + curriculum-cell enumeration. The CLI script
// and the generation Lambda both import `runOneCell` from here.
export * from './generation';
export * from './theory-generation';
