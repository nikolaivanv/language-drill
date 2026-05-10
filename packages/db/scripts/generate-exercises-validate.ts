/**
 * Back-compat re-export. The canonical location for the routing helper is
 * `packages/db/src/generation/routing.ts` (Phase 4) — moved there so the
 * generation Lambda can import it through the `@language-drill/db` package
 * barrel without crossing the src → scripts boundary. Existing Phase 3 tests
 * (`packages/db/scripts/generate-exercises-validate.test.ts`) and call sites
 * (`generate-exercises.ts`) continue to import from here unchanged.
 */
export {
  VALIDATION_THRESHOLDS,
  routeValidationResult,
  type ReviewStatus,
  type RoutingDecision,
} from '../src/generation/routing';
