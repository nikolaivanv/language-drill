/**
 * Frozen routing thresholds for the theory-page validator (Phase 3).
 *
 * Single source of truth for the 0.5 / 0.7 quality-score boundaries that
 * drive `routeTheoryValidationResult` (packages/db/src/theory-generation/
 * routing.ts) AND the validator's system prompt
 * (./theory-validation-prompts.ts). The router re-exports this object so
 * downstream consumers in `packages/db` can pick whichever package they
 * already import from.
 *
 * This module lives in `packages/ai` (not `packages/db`) so the validator's
 * prompt builder can import the constants without violating the forbidden
 * `packages/ai → packages/db` direction. The exercise-side equivalent
 * (`packages/db/src/generation/routing.ts:23-28`) duplicates the literals
 * in `validation-prompts.ts`; Phase 3 introduces this shared-constant
 * pattern for theory because requirement 2.5 mandates interpolation.
 *
 * Invariant (asserted in routing.test.ts):
 *   flagQualityFloor < approveQualityFloor
 *
 * Tuning these values is policy, not runtime — bump them in this file and
 * the prompt + router pick them up automatically.
 */

export const THEORY_VALIDATION_THRESHOLDS = Object.freeze({
  /** qualityScore at or above this → auto-approved (when other checks pass). */
  approveQualityFloor: 0.7,
  /** qualityScore below this → rejected (regardless of other fields). */
  flagQualityFloor: 0.5,
});

export type THEORY_VALIDATION_THRESHOLDS_TYPE =
  typeof THEORY_VALIDATION_THRESHOLDS;
