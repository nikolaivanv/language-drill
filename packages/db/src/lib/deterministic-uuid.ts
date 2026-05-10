/**
 * Phase 4 — `deterministicUuid` moved to `@language-drill/shared` to break
 * the `ai → db` runtime edge (which created a build cycle once the Phase 4
 * `runOneCell` extraction made `db/src/` import from `ai`). This file is a
 * back-compat re-export so existing `import { deterministicUuid } from '@language-drill/db'`
 * call sites keep working unchanged.
 */
export { deterministicUuid } from '@language-drill/shared';
