/**
 * Pure helpers shared by the `revalidate:cloze` CLI and the UI-triggered
 * revalidation endpoint:
 *
 *   - `reconstructDraftAndSpec` rebuilds the (draft, spec) tuple that
 *     `validateDraft` expects from a stored exercise row.
 *   - `decideDemotion` applies the demote-only review-status policy from a
 *     fresh `ValidationResult`.
 *
 * Both are exercise-type-agnostic: `reconstructDraftAndSpec` takes the target
 * `ExerciseType` so the same code can re-score cloze, translation, etc.
 */

import {
  type ExerciseDraft,
  type GenerationSpec,
  type ValidationResult,
} from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type ExerciseContent,
  type GenerationReason,
} from '@language-drill/shared';

import { getGrammarPoint } from '../curriculum';
import { applyDeterministicChecks } from './deterministic-checks';
import { routeValidationResult, type ReviewStatus } from './routing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));

// ---------------------------------------------------------------------------
// Row → draft / spec reconstruction
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  contentJson: unknown;
  grammarPointKey: string | null;
  topicDomain: string | null;
  modelId: string | null;
  reviewStatus: string;
};

export type SkipReason =
  | 'unknown-grammar-point'
  | 'malformed-content-json'
  | 'mismatched-language'
  | 'mismatched-cefr'
  | 'missing-grammar-point-key';

export type Reconstructed = {
  ok: true;
  draft: ExerciseDraft;
  spec: GenerationSpec;
};

export type ReconstructFailure = {
  ok: false;
  reason: SkipReason;
  detail: string;
};

/**
 * Pure helper: take a DB row and produce the (draft, spec) tuple that
 * `validateDraft` expects, for the given target `exerciseType`. Returns a
 * structured failure for rows the validator cannot meaningfully score (e.g.
 * seed rows with no grammar-point key) — the caller logs and moves on.
 *
 * `draft.metadata.{inputTokens, outputTokens, ...}` are zeros because we are
 * not re-running generation; only the validator reads these fields and it
 * ignores them. `inBatchDuplicate=false` for the same reason.
 */
export function reconstructDraftAndSpec(
  row: CandidateRow,
  exerciseType: ExerciseType,
): Reconstructed | ReconstructFailure {
  if (!row.grammarPointKey) {
    return {
      ok: false,
      reason: 'missing-grammar-point-key',
      detail: `row ${row.id} has no grammar_point_key (likely a seed row)`,
    };
  }
  const grammarPoint = getGrammarPoint(row.grammarPointKey);
  if (!grammarPoint) {
    return {
      ok: false,
      reason: 'unknown-grammar-point',
      detail: `row ${row.id} references unknown grammar_point_key '${row.grammarPointKey}'`,
    };
  }

  if (!row.language || !LANGUAGE_VALUES.has(row.language as Language)) {
    return {
      ok: false,
      reason: 'mismatched-language',
      detail: `row ${row.id} has invalid language '${String(row.language)}'`,
    };
  }
  if (!row.difficulty || !CEFR_VALUES.has(row.difficulty as CefrLevel)) {
    return {
      ok: false,
      reason: 'mismatched-cefr',
      detail: `row ${row.id} has invalid difficulty '${String(row.difficulty)}'`,
    };
  }

  // `contentJson` has the discriminated-union shape; the `type` discriminant
  // check handles both well-formed content and any historic shape drift for
  // the requested exercise type in one pass.
  const content = row.contentJson as { type?: unknown } | null;
  if (!content || typeof content !== 'object' || content.type !== exerciseType) {
    return {
      ok: false,
      reason: 'malformed-content-json',
      detail: `row ${row.id} content_json is not a ${exerciseType} exercise`,
    };
  }
  const exerciseContent = content as ExerciseContent;

  if (row.language === Language.EN) {
    return {
      ok: false,
      reason: 'mismatched-language',
      detail: `row ${row.id} language is EN — exercises target a learner language`,
    };
  }
  const language = row.language as Exclude<Language, Language.EN>;
  const cefrLevel = row.difficulty as CefrLevel;

  const draft: ExerciseDraft = {
    id: row.id,
    contentJson: exerciseContent,
    metadata: {
      grammarPointKey: row.grammarPointKey,
      topicDomain: row.topicDomain,
      modelId: row.modelId ?? 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
  const spec: GenerationSpec = {
    language,
    cefrLevel,
    exerciseType,
    grammarPoint,
    topicDomain: row.topicDomain,
    // `count` and `batchSeed` are unused by the validator (they only shape
    // the generator's prompt). Keep them present for type-completeness.
    count: 1,
    batchSeed: ZERO_UUID,
  };
  return { ok: true, draft, spec };
}

// ---------------------------------------------------------------------------
// Demotion policy
// ---------------------------------------------------------------------------

export type DemotionAction =
  | { kind: 'no-change'; from: ReviewStatus; to: ReviewStatus }
  | { kind: 'demote'; from: ReviewStatus; to: ReviewStatus; reasons: GenerationReason[] }
  | { kind: 'skip'; from: ReviewStatus; reason: 'manual-approved' | 'rejected' };

export function decideDemotion(
  currentStatus: ReviewStatus,
  result: ValidationResult,
  content?: ExerciseContent,
  language?: Language,
): DemotionAction {
  if (currentStatus === 'manual-approved') {
    return { kind: 'skip', from: currentStatus, reason: 'manual-approved' };
  }
  if (currentStatus === 'rejected') {
    return { kind: 'skip', from: currentStatus, reason: 'rejected' };
  }

  // Same deterministic gate the live generation path uses (R3.1
  // single-source-of-truth). Optional content/language keep the bare
  // 2-arg callers (older tests) working — they get pure LLM routing.
  const routed =
    content && language
      ? applyDeterministicChecks(routeValidationResult(result), content, language)
      : routeValidationResult(result);

  // Demote-only ranking: rejected < flagged < auto-approved.
  const rank: Record<ReviewStatus, number> = {
    rejected: 0,
    flagged: 1,
    'auto-approved': 2,
    'manual-approved': 3,
  };
  const newStatus = routed.reviewStatus;
  if (rank[newStatus] < rank[currentStatus]) {
    return {
      kind: 'demote',
      from: currentStatus,
      to: newStatus,
      reasons: routed.flaggedReasons,
    };
  }
  return { kind: 'no-change', from: currentStatus, to: currentStatus };
}
