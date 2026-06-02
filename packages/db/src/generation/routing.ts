/**
 * Pure routing helper for the validator pass: maps a `ValidationResult` (from
 * `@language-drill/ai`) to a `(reviewStatus, flaggedReasons)` pair using the
 * frozen Phase 3 thresholds from plan §3.1.
 *
 * Phase 3 introduced this in `packages/db/scripts/generate-exercises-validate.ts`
 * — operational policy lives next to the operator-facing CLI. Phase 4 lifts it
 * here so the generation Lambda's `runOneCell` (`packages/db/src/generation/`)
 * can import it without crossing the src → scripts boundary. The script-side
 * file becomes a one-line re-export for back-compat with Phase 3 tests.
 *
 * Pure function — no I/O, no Claude calls.
 */

import type { ValidationResult } from '@language-drill/ai';
import {
  type GenerationReason,
  GenerationReasonCode,
} from '@language-drill/shared';

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
  | 'auto-approved'
  | 'flagged'
  | 'rejected'
  | 'manual-approved';

export type RoutingDecision = {
  reviewStatus: ReviewStatus;
  /**
   * Reasons carried as `{ code, detail? }` (canonical code + free-form prose).
   * Field name retained from the original `string[]` shape to minimize churn
   * across the writer (`exercises.flagged_reasons`), the rejected-ordinal fold
   * (`rejection_reason_counts`), and the revalidation CLI.
   */
  flaggedReasons: GenerationReason[];
};

// ---------------------------------------------------------------------------
// routeValidationResult
// ---------------------------------------------------------------------------

/**
 * Route a `ValidationResult` to the `(reviewStatus, flaggedReasons)` pair the
 * writer applies to a draft.
 *
 * Each reason is a `{ code, detail? }` (`GenerationReason`); free-form validator
 * prose / cultural-issue text is carried in `detail`, never in `code`.
 *
 * Reasons-ordering rules (matching the JSDoc on the public design):
 *
 *   REJECTED branch (qualityScore < 0.5 OR culturalIssues non-empty OR contextSpoilsAnswer):
 *     1. { code: LowQualityReject }                  (only when qualityScore < 0.5)
 *     2. { code: ContextSpoilsAnswer }               (only when result.contextSpoilsAnswer)
 *     3. ...{ code: CulturalIssue, detail: <issue> } (one per result.culturalIssues, original order)
 *
 *   AUTO-APPROVED branch (all conjuncts hold): flaggedReasons is always [].
 *
 *   FLAGGED branch (otherwise):
 *     1. { code: LowQualityFlag }                    (only when 0.5 <= qualityScore < 0.7)
 *     2. { code: Ambiguous }                         (only when result.ambiguous)
 *     3. { code: LevelMismatch }                     (only when !result.levelMatch)
 *     4. { code: GrammarPointMismatch }              (only when !result.grammarPointMatch)
 *     5. ...{ code: ValidatorNote, detail: <reason> }(one per result.flaggedReasons, original order)
 *
 * 'manual-approved' is NEVER returned here — it is set only by the review
 * CLI's UPDATE path (`tryApprove`).
 */
export function routeValidationResult(
  result: ValidationResult,
): RoutingDecision {
  // -- Rejected branch: hard veto on low score OR cultural issues OR a context
  // that gives away the answer. `contextSpoilsAnswer` joins `culturalIssues`
  // as a content-level veto: the draft can never become useful (the spoiler
  // text is baked into the exercise body), so manual review would waste a
  // reviewer's time. Same reason we don't flag — we reject.
  if (
    result.qualityScore < VALIDATION_THRESHOLDS.flagQualityFloor ||
    result.contextSpoilsAnswer ||
    result.culturalIssues.length > 0
  ) {
    const reasons: GenerationReason[] = [];
    if (result.qualityScore < VALIDATION_THRESHOLDS.flagQualityFloor) {
      reasons.push({ code: GenerationReasonCode.LowQualityReject });
    }
    if (result.contextSpoilsAnswer) {
      reasons.push({ code: GenerationReasonCode.ContextSpoilsAnswer });
    }
    for (const issue of result.culturalIssues) {
      reasons.push({ code: GenerationReasonCode.CulturalIssue, detail: issue });
    }
    return { reviewStatus: 'rejected', flaggedReasons: reasons };
  }

  // -- Auto-approve branch: every condition must hold. --
  const approves =
    result.qualityScore >= VALIDATION_THRESHOLDS.approveQualityFloor &&
    !result.ambiguous &&
    !result.contextSpoilsAnswer &&
    result.levelMatch &&
    result.grammarPointMatch &&
    result.culturalIssues.length === 0;

  if (approves) {
    return { reviewStatus: 'auto-approved', flaggedReasons: [] };
  }

  // -- Flagged branch: collect every failed condition in deterministic order. --
  const reasons: GenerationReason[] = [];
  if (result.qualityScore < VALIDATION_THRESHOLDS.approveQualityFloor) {
    reasons.push({ code: GenerationReasonCode.LowQualityFlag });
  }
  if (result.ambiguous) {
    reasons.push({ code: GenerationReasonCode.Ambiguous });
  }
  if (!result.levelMatch) {
    reasons.push({ code: GenerationReasonCode.LevelMismatch });
  }
  if (!result.grammarPointMatch) {
    reasons.push({ code: GenerationReasonCode.GrammarPointMismatch });
  }
  for (const reason of result.flaggedReasons) {
    reasons.push({ code: GenerationReasonCode.ValidatorNote, detail: reason });
  }
  return { reviewStatus: 'flagged', flaggedReasons: reasons };
}
