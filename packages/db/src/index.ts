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
  grammarPointsAtOrBelow,
  curriculumOrderOf,
  assertCurriculumInvariants,
  CURRICULUM_VERSION_ES,
  CURRICULUM_VERSION_DE,
  CURRICULUM_VERSION_TR,
  CURRICULUM_VERSION_BY_LANGUAGE,
} from './curriculum';
export type { CurriculumCefrLevel, GrammarPoint } from './curriculum';

// Book-coverage ledger (dev-time metadata; see the 2026-07-15 design doc).
// Enforced by book-coverage.test.ts; exported only for the propose:book-coverage
// CLI in packages/ai/scripts — no Lambda path may import it.
export { validateBookCoverage } from './curriculum/book-coverage';
export type {
  BookCoverageLedger,
  CoverageDecision,
  TocEntry,
} from './curriculum/book-coverage';

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

// Phase 2 (dictation audio) — shared Polly synth helper + the dictation S3 key
// convention. The seed script imports it by relative path; exported here so the
// PR2 audio-synth Lambda (infra/lambda) can consume it via this barrel.
export { synthesizeToS3, dictationAudioKey } from './lib/polly-synth';
export type { SynthesizeToS3Args } from './lib/polly-synth';

// Read practice (audio shadowing) — voice map + content-addressed key +
// text normalization + duration estimate helpers.
export * from './lib/reading-audio';

// Phase 5 — pool target sizing. Consumed by the admin pool-status endpoint
// (`infra/lambda/src/routes/admin.ts`) which derives a cell's refill target
// from its observed 7-day depletion rate.
export { targetCellSize } from './lib/target-cell-size';

// Phase 4 — orchestration core + curriculum-cell enumeration. The CLI script
// and the generation Lambda both import `runOneCell` from here.
export * from './generation';
export * from './theory-generation';

// Phase 2 (curriculum map) — export compatibleTypes so the curriculum endpoint
// can tell the web which drill modes a grammar point supports.
export { compatibleTypes } from './generation/cells';

// Pool revalidation helpers — pure row→(draft, spec) reconstruction +
// demote-only review-status policy. Shared by the `revalidate:cloze` CLI and
// the UI-triggered revalidation endpoint (admin Lambda).
export {
  reconstructDraftAndSpec,
  decideDemotion,
  type CandidateRow,
  type SkipReason,
  type Reconstructed,
  type ReconstructFailure,
  type DemotionAction,
} from './generation/revalidation';

// Per-grammar-point mastery — the update rule (used by the submit handler) and
// the history-replay fold (used by the backfill CLI).
export { updateMastery, replayHistory } from './mastery/update';
export type {
  MasteryState,
  MasteryObservation,
  HistoryRow,
} from './mastery/update';

// Error observations — pure mapping from evaluation errors to insert rows,
// plus a backfill row-builder. Used by the Lambda write path and the
// backfill CLI (both import these pure functions from the barrel).
export * from './errors/observations';
