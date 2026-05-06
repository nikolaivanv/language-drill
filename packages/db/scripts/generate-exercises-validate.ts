/**
 * Pure routing helper for the generator CLI's validator pass (Phase 3).
 *
 * Maps a `ValidationResult` (from `@language-drill/ai`) to a
 * `(reviewStatus, flaggedReasons)` pair using the frozen Phase 3 thresholds
 * from plan §3.1. Single source of truth for the routing rule — Tasks 14-16
 * (the CLI's `validateAndInsertWithRetry` body) consume this; Phase 4's
 * Lambda will too.
 *
 * Pure function — no I/O, no Claude calls. Lives in `packages/db/scripts/`
 * (not `packages/ai/`) because the threshold values are operational policy
 * (tuned against observed approval rates) rather than model behavior, and
 * `'manual-approved'` is a write-side concept owned by the CLIs.
 */

import type { ValidationResult } from "@language-drill/ai";

// ---------------------------------------------------------------------------
// Frozen thresholds — tunable at the policy layer, not in test or production
// runtime. A future Phase 5 might replace these with per-(language, level)
// values; today they're global.
// ---------------------------------------------------------------------------

export const VALIDATION_THRESHOLDS = Object.freeze({
  /** qualityScore at or above this → auto-approved (when other checks pass). */
  approveQualityFloor: 0.7,
  /** qualityScore below this → rejected (regardless of other fields). */
  flagQualityFloor: 0.5,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewStatus =
  | "auto-approved"
  | "flagged"
  | "rejected"
  | "manual-approved";

export type RoutingDecision = {
  reviewStatus: ReviewStatus;
  flaggedReasons: string[];
};

// ---------------------------------------------------------------------------
// routeValidationResult
// ---------------------------------------------------------------------------

/**
 * Route a `ValidationResult` to the `(reviewStatus, flaggedReasons)` pair the
 * writer applies to a draft.
 *
 * Reasons-ordering rules (matching the JSDoc on the public design):
 *
 *   REJECTED branch (qualityScore < 0.5 OR culturalIssues non-empty):
 *     1. 'low quality score (<0.5)'  (only when qualityScore < 0.5)
 *     2. ...result.culturalIssues    (in original order)
 *
 *   AUTO-APPROVED branch (all conjuncts hold): flaggedReasons is always [].
 *
 *   FLAGGED branch (otherwise):
 *     1. 'low quality score (<0.7)'      (only when 0.5 <= qualityScore < 0.7)
 *     2. 'ambiguous'                     (only when result.ambiguous)
 *     3. 'level mismatch'                (only when !result.levelMatch)
 *     4. 'grammar point mismatch'        (only when !result.grammarPointMatch)
 *     5. ...result.flaggedReasons        (in original order)
 *
 * 'manual-approved' is NEVER returned here — it is set only by the review
 * CLI's UPDATE path (Task 22's `tryApprove`).
 */
export function routeValidationResult(
  result: ValidationResult,
): RoutingDecision {
  // -- Rejected branch: hard veto on low score OR cultural issues. --
  // Intentional from plan §3.1: a high-quality draft (qualityScore = 0.9)
  // with even one culturalIssues entry routes to 'rejected', NOT 'flagged'.
  // The reviewer never sees rejected items, so cultural concerns must be
  // filtered here, not deferred to manual review.
  if (
    result.qualityScore < VALIDATION_THRESHOLDS.flagQualityFloor ||
    result.culturalIssues.length > 0
  ) {
    const reasons: string[] = [];
    if (result.qualityScore < VALIDATION_THRESHOLDS.flagQualityFloor) {
      reasons.push("low quality score (<0.5)");
    }
    for (const issue of result.culturalIssues) {
      reasons.push(issue);
    }
    return { reviewStatus: "rejected", flaggedReasons: reasons };
  }

  // -- Auto-approve branch: every condition must hold. --
  const approves =
    result.qualityScore >= VALIDATION_THRESHOLDS.approveQualityFloor &&
    !result.ambiguous &&
    result.levelMatch &&
    result.grammarPointMatch &&
    result.culturalIssues.length === 0;

  if (approves) {
    return { reviewStatus: "auto-approved", flaggedReasons: [] };
  }

  // -- Flagged branch: collect every failed condition in deterministic order. --
  const reasons: string[] = [];
  if (result.qualityScore < VALIDATION_THRESHOLDS.approveQualityFloor) {
    reasons.push("low quality score (<0.7)");
  }
  if (result.ambiguous) {
    reasons.push("ambiguous");
  }
  if (!result.levelMatch) {
    reasons.push("level mismatch");
  }
  if (!result.grammarPointMatch) {
    reasons.push("grammar point mismatch");
  }
  for (const reason of result.flaggedReasons) {
    reasons.push(reason);
  }
  return { reviewStatus: "flagged", flaggedReasons: reasons };
}
