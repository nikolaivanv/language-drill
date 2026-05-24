/**
 * Deterministic post-LLM gate for the validator routing decision.
 *
 * `routeValidationResult` maps the LLM `ValidationResult` to a `(reviewStatus,
 * flaggedReasons)` pair. `applyDeterministicChecks` runs immediately after it
 * and can only **downgrade** that decision based on the pure, non-LLM Turkish
 * checker (`checkTurkishCloze` in `@language-drill/ai`): a provable
 * vowel-harmony error → `rejected`; a suspected malformed surface form →
 * `flagged`. It never upgrades.
 *
 * This is the SINGLE place the verdict→routing precedence lives. Both the live
 * generation path (`validate-and-insert.ts`) and the revalidation CLI
 * (`scripts/revalidate-cloze-pool.ts` via `decideDemotion`) call it, so the two
 * cannot diverge.
 *
 * Pure function — no I/O, no Claude calls.
 */

import {
  type ExerciseContent,
  isClozeContent,
  Language,
} from '@language-drill/shared';
import { checkTurkishCloze } from '@language-drill/ai';

import type { ReviewStatus, RoutingDecision } from './routing';

/**
 * Combine the LLM routing decision with the deterministic Turkish checker.
 *
 * Pass-through (returns `decision` semantically unchanged) when the draft is
 * non-Turkish, not a cloze, or the checker returns `ok` / `not-applicable`.
 *
 * - `wrong-harmony` → `rejected`, deterministic reason **prepended** (it is the
 *   dominant cause), regardless of the LLM `qualityScore`.
 * - `non-word-stem` → deterministic reason **appended**; `auto-approved`
 *   downgrades to `flagged`; an already-`flagged`/`rejected` status is kept.
 */
export function applyDeterministicChecks(
  decision: RoutingDecision,
  content: ExerciseContent,
  language: Language,
): RoutingDecision {
  if (language !== Language.TR || !isClozeContent(content)) {
    return decision;
  }

  const verdict = checkTurkishCloze(content);

  switch (verdict.kind) {
    case 'ok':
    case 'not-applicable':
      return decision;

    case 'wrong-harmony':
      return {
        reviewStatus: 'rejected',
        flaggedReasons: [
          `wrong vowel-harmony allomorph (deterministic): expected ${verdict.expected}, got ${verdict.actual}`,
          ...decision.flaggedReasons,
        ],
      };

    case 'non-word-stem': {
      const reason = `suspected malformed surface form (deterministic): ${verdict.reconstructed}`;
      // Downgrade only; never upgrade an already-flagged/rejected decision.
      const reviewStatus: ReviewStatus =
        decision.reviewStatus === 'auto-approved'
          ? 'flagged'
          : decision.reviewStatus;
      return {
        reviewStatus,
        flaggedReasons: [...decision.flaggedReasons, reason],
      };
    }
  }
}
