/**
 * Phase 4 — `GrammarPoint` and `CurriculumCefrLevel` moved to
 * `@language-drill/shared` to break the build cycle (`ai/src` was importing
 * `GrammarPoint` as a type from `db`, while `db/src` was importing runtime
 * helpers from `ai`). This file is a back-compat re-export so existing
 * imports like `import type { GrammarPoint } from '@language-drill/db'` keep
 * working unchanged via the package barrel.
 */
export type { CurriculumCefrLevel, GrammarPoint } from '@language-drill/shared';
