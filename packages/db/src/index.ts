// Public surface of @language-drill/db.
//
// External consumers (other workspace packages) import everything they need
// through this barrel — never via deep relative paths into ./schema, ./lib, or
// ./curriculum. Internal consumers (scripts inside packages/db itself) may
// still use relative paths.
export * from './client';
export * from './schema';

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
export { assertValidCellKey } from './lib/cell-key';
