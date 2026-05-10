/**
 * Back-compat re-export. The canonical location for `requireEnv` is
 * `packages/db/src/lib/env.ts` (Phase 4) — moved there so the generation
 * Lambda can import it through the `@language-drill/db` package barrel
 * without depending on `packages/db/scripts/`. Existing Phase 3 callers
 * (`generate-exercises.ts`, `review-flagged.ts`) continue to import from
 * here unchanged.
 */
export { requireEnv } from '../src/lib/env';
