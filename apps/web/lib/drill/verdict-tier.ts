import type { EvaluationError } from '@language-drill/shared';

export type VerdictTier = 'sage' | 'yellow' | 'terracotta';

export type VerdictResult = { tier: VerdictTier; label: string };

export function clozeVerdict(score: number): VerdictResult {
  if (score >= 0.95) {
    return { tier: 'sage', label: 'spot on' };
  } else if (score >= 0.7) {
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
  } else if (score >= 0.7) {
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
  } else if (score >= 0.7 && score < 1.0 && hasGrammarError) {
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
