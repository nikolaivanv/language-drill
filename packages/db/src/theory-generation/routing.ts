/**
 * Pure routing helper for the theory validator pass: maps a
 * `TheoryValidationResult` (from `@language-drill/ai`) to a
 * `(reviewStatus, flaggedReasons)` pair using the frozen Phase 3
 * thresholds from `theory-validation-thresholds.ts`.
 *
 * Structural mirror of `packages/db/src/generation/routing.ts` with three
 * intentional deltas (stricter than the exercise router by design — a
 * wrong theory page corrupts the canonical reference; a wrong exercise is
 * one bad item in a 50-item pool):
 *
 *   1. `factualErrors` (any non-empty) → REJECTED. No exercise-side analog.
 *   2. `sectionsIncomplete` and `examplesUseGrammarPoint` contribute to the
 *      flag accumulator instead of the exercise side's `ambiguous` +
 *      `grammarPointMatch`.
 *   3. The thresholds object (`THEORY_VALIDATION_THRESHOLDS`) lives in
 *      `packages/ai/src/theory-validation-thresholds.ts` so the validator
 *      prompt can import the values without violating the forbidden
 *      `packages/ai → packages/db` direction. This module re-exports it so
 *      downstream consumers in `packages/db` can pick whichever package
 *      they already import from.
 *
 * Pure function — no I/O, no Claude calls, fully unit-testable.
 */

import {
  THEORY_VALIDATION_THRESHOLDS,
  type TheoryValidationResult,
} from '@language-drill/ai';

import type { ReviewStatus } from '../generation/routing.js';

// ---------------------------------------------------------------------------
// Re-export — single source of truth for the thresholds.
// ---------------------------------------------------------------------------

export { THEORY_VALIDATION_THRESHOLDS } from '@language-drill/ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The three terminal review states `routeTheoryValidationResult` can
 * return. `'manual-approved'` is intentionally excluded — that value is
 * set ONLY by the review CLI's UPDATE path (`tryApproveTheory` in
 * `packages/db/scripts/review-flagged-theory.ts`, Task 17). Narrowing the
 * union here means any future refactor that returns `'manual-approved'`
 * from the router fails typecheck rather than silently corrupting the
 * audit trail.
 */
export type TheoryReviewStatus = Exclude<ReviewStatus, 'manual-approved'>;

export type TheoryRoutingDecision = {
  reviewStatus: TheoryReviewStatus;
  flaggedReasons: string[];
};

// ---------------------------------------------------------------------------
// routeTheoryValidationResult
// ---------------------------------------------------------------------------

/**
 * Route a `TheoryValidationResult` to the `(reviewStatus, flaggedReasons)`
 * pair the writer applies to a theory page.
 *
 * Decision-table order (first match wins for the reject branches):
 *
 *   REJECTED branches:
 *     1. factualErrors non-empty           → reasons = [...factualErrors]
 *     2. culturalIssues non-empty          → reasons = [...culturalIssues]
 *     3. qualityScore < flagQualityFloor   → reasons = ['low quality score (<0.5)', ...result.flaggedReasons]
 *
 *   AUTO-APPROVED branch (every conjunct must hold):
 *     qualityScore >= approveQualityFloor AND !levelMismatch
 *     AND sectionsIncomplete.length === 0 AND examplesUseGrammarPoint
 *
 *   FLAGGED branch (accumulating, fixed order):
 *     1. 'low quality score (<0.7)'             (only when 0.5 <= qualityScore < 0.7)
 *     2. 'level mismatch'                       (only when levelMismatch)
 *     3. 'incomplete section: <name>'           (one per entry of sectionsIncomplete)
 *     4. 'examples off-target'                  (only when !examplesUseGrammarPoint)
 *     5. ...result.flaggedReasons               (in original order)
 *
 * The flagged-branch is a single accumulating pass rather than the plan's
 * early-return sketch — every failing condition contributes one reason so
 * a reviewer sees the full diagnostic in the terminal.
 *
 * `'manual-approved'` is NEVER returned here.
 */
export function routeTheoryValidationResult(
  result: TheoryValidationResult,
): TheoryRoutingDecision {
  // -- Rejected branch 1: factualErrors are a hard veto. Stricter than the
  //    exercise router by design. A wrong rule in a theory page becomes
  //    the canonical reference learners internalize, so factually-wrong
  //    pages must be filtered here, not deferred to manual review.
  if (result.factualErrors.length > 0) {
    return {
      reviewStatus: 'rejected',
      flaggedReasons: [...result.factualErrors],
    };
  }

  // -- Rejected branch 2: culturalIssues are a hard veto regardless of
  //    qualityScore. Same rationale as the exercise router (cultural
  //    concerns must not be deferred to a reviewer who never sees them).
  if (result.culturalIssues.length > 0) {
    return {
      reviewStatus: 'rejected',
      flaggedReasons: [...result.culturalIssues],
    };
  }

  // -- Rejected branch 3: quality score below the floor. Includes the
  //    synthetic header so the audit-row reason field is self-describing.
  if (result.qualityScore < THEORY_VALIDATION_THRESHOLDS.flagQualityFloor) {
    return {
      reviewStatus: 'rejected',
      flaggedReasons: [
        'low quality score (<0.5)',
        ...result.flaggedReasons,
      ],
    };
  }

  // -- Auto-approve branch: every conjunct must hold.
  const approves =
    result.qualityScore >= THEORY_VALIDATION_THRESHOLDS.approveQualityFloor &&
    !result.levelMismatch &&
    result.sectionsIncomplete.length === 0 &&
    result.examplesUseGrammarPoint;

  if (approves) {
    return { reviewStatus: 'auto-approved', flaggedReasons: [] };
  }

  // -- Flagged branch: collect every failed condition in deterministic
  //    order. The reviewer sees all of them at once, so a page that's
  //    both off-level AND has incomplete sections surfaces both reasons.
  const reasons: string[] = [];
  if (result.qualityScore < THEORY_VALIDATION_THRESHOLDS.approveQualityFloor) {
    reasons.push('low quality score (<0.7)');
  }
  if (result.levelMismatch) {
    reasons.push('level mismatch');
  }
  for (const section of result.sectionsIncomplete) {
    reasons.push(`incomplete section: ${section}`);
  }
  if (!result.examplesUseGrammarPoint) {
    reasons.push('examples off-target');
  }
  for (const reason of result.flaggedReasons) {
    reasons.push(reason);
  }
  return { reviewStatus: 'flagged', flaggedReasons: reasons };
}
