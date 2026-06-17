import { CORRECT_THRESHOLD, type EvaluationError } from '@language-drill/shared';

export type VerdictTier = 'sage' | 'yellow' | 'terracotta';

export type VerdictResult = { tier: VerdictTier; label: string };

export function clozeVerdict(score: number): VerdictResult {
  if (score >= 0.95) {
    return { tier: 'sage', label: 'spot on' };
  } else if (score >= CORRECT_THRESHOLD) {
    return { tier: 'yellow', label: 'close' };
  } else if (score >= 0.4) {
    return { tier: 'yellow', label: 'off — see why' };
  } else {
    return { tier: 'terracotta', label: 'wrong' };
  }
}

export function translationVerdict(score: number): VerdictResult {
  if (score >= 0.95) {
    return { tier: 'sage', label: 'spot on' };
  } else if (score >= CORRECT_THRESHOLD) {
    return { tier: 'yellow', label: 'meaning is right · small issues' };
  } else if (score >= 0.4) {
    return { tier: 'yellow', label: 'gist is there · grammar drifted' };
  } else {
    return { tier: 'terracotta', label: 'not quite' };
  }
}

export function vocabVerdict(
  score: number,
  errors: EvaluationError[],
): VerdictResult {
  const hasGrammarError = errors.some((e) => e.type === 'grammar');
  const hasSpellingError = errors.some((e) => e.type === 'spelling');

  if (score === 1.0) {
    return { tier: 'sage', label: 'exact' };
  } else if (score >= CORRECT_THRESHOLD && score < 1.0 && hasGrammarError) {
    return { tier: 'yellow', label: 'right word · wrong inflection' };
  } else if (
    score >= 0.6 &&
    score < 1.0 &&
    hasSpellingError &&
    !hasGrammarError
  ) {
    return { tier: 'yellow', label: 'spelling slipped' };
  } else if (score >= 0.6 && score < 1.0) {
    return { tier: 'yellow', label: 'close' };
  } else {
    return { tier: 'terracotta', label: 'wrong' };
  }
}

export function conjugationVerdict(score: number): VerdictResult {
  if (score === 1.0) {
    return { tier: 'sage', label: 'exact' };
  } else if (score >= CORRECT_THRESHOLD) {
    return { tier: 'yellow', label: 'close · check the form' };
  } else if (score >= 0.4) {
    return { tier: 'yellow', label: 'off — check the paradigm' };
  } else {
    return { tier: 'terracotta', label: 'wrong form' };
  }
}

export function dictationVerdict(score: number): VerdictResult {
  if (score >= 0.95) {
    return { tier: 'sage', label: 'oído fino' };
  } else if (score >= CORRECT_THRESHOLD) {
    return { tier: 'yellow', label: 'close · a few you missed' };
  } else if (score >= 0.4) {
    return { tier: 'yellow', label: 'the gist · boundaries slipped' };
  } else {
    return { tier: 'terracotta', label: "hard clip · let's slow down" };
  }
}
