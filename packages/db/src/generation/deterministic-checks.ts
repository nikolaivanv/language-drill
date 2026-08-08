/**
 * Deterministic post-LLM gate for the validator routing decision.
 *
 * `routeValidationResult` maps the LLM `ValidationResult` to a `(reviewStatus,
 * flaggedReasons)` pair. `applyDeterministicChecks` runs immediately after it
 * and can only **downgrade** that decision based on pure, non-LLM checkers in
 * `@language-drill/ai`. It never upgrades.
 *
 * Two checkers run:
 *
 * - `checkTurkishCloze` (Turkish cloze only): a provable vowel-harmony error →
 *   `rejected`; a suspected malformed surface form → `flagged`.
 * - `checkClozeOverlap` (any-language cloze): the `correctAnswer` restates the
 *   stem word beside the blank, so substituting it duplicates that word →
 *   `rejected` when the answer is multi-word (provable), `flagged` when it is
 *   a single word (adjacent repetition can be a real construction). Added
 *   2026-08-08 after 38 such rows were found live in the prod pool, approved at
 *   0.85-0.9 by the LLM validator.
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
  GenerationReasonCode,
  isClozeContent,
  Language,
} from '@language-drill/shared';
import { checkClozeOverlap, checkTurkishCloze } from '@language-drill/ai';

import type { ReviewStatus, RoutingDecision } from './routing';

/**
 * Downgrade `auto-approved` to `flagged`; keep an already-`flagged`/`rejected`
 * status. Never upgrades — the deterministic gate is one-directional.
 */
function downgradeToFlagged(status: ReviewStatus): ReviewStatus {
  return status === 'auto-approved' ? 'flagged' : status;
}

/**
 * Combine the LLM routing decision with the deterministic checkers.
 *
 * Pass-through (returns `decision` semantically unchanged) when the draft is
 * not a cloze or every applicable checker returns `ok` / `not-applicable`.
 *
 * Answer/stem overlap is evaluated first and applies to every language: a
 * `certain` overlap is a provable structural defect (the exercise is
 * unanswerable as printed), so it rejects outright regardless of the LLM
 * `qualityScore`, and no later check can matter.
 *
 * Then, for Turkish:
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
  if (!isClozeContent(content)) {
    return decision;
  }

  const overlap = checkClozeOverlap(content);
  if (overlap.kind === 'answer-stem-overlap') {
    // The broken substitution goes in `detail`; the code stays bounded.
    const detail = `answer "${content.correctAnswer}" restates "${overlap.token}" ${overlap.side} the blank → "${overlap.substituted}"`;
    if (overlap.confidence === 'certain') {
      return {
        reviewStatus: 'rejected',
        flaggedReasons: [
          { code: GenerationReasonCode.AnswerStemOverlap, detail },
          ...decision.flaggedReasons,
        ],
      };
    }
    decision = {
      reviewStatus: downgradeToFlagged(decision.reviewStatus),
      flaggedReasons: [
        ...decision.flaggedReasons,
        { code: GenerationReasonCode.SuspectedAnswerStemOverlap, detail },
      ],
    };
  }

  if (language !== Language.TR) {
    return decision;
  }

  const verdict = checkTurkishCloze(content);

  switch (verdict.kind) {
    case 'ok':
    case 'not-applicable':
      return decision;

    case 'wrong-harmony':
      // Interpolated allomorph values go in `detail`, never in the code key,
      // so the rejection-reason map keys on the bounded `vowel-harmony-allomorph`
      // code rather than a distinct string per token.
      return {
        reviewStatus: 'rejected',
        flaggedReasons: [
          {
            code: GenerationReasonCode.VowelHarmonyAllomorph,
            detail: `expected ${verdict.expected}, got ${verdict.actual}`,
          },
          ...decision.flaggedReasons,
        ],
      };

    case 'non-word-stem': {
      // Reconstructed surface form goes in `detail`, not the code key.
      const reason = {
        code: GenerationReasonCode.MalformedSurfaceForm,
        detail: verdict.reconstructed,
      };
      return {
        // Downgrade only; never upgrade an already-flagged/rejected decision.
        reviewStatus: downgradeToFlagged(decision.reviewStatus),
        flaggedReasons: [...decision.flaggedReasons, reason],
      };
    }
  }
}
