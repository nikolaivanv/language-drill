import type { DictationResult, EvaluationResult } from '@language-drill/shared';

export type SubmissionMeta = {
  usedMc?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  hintCount?: number;
};

/**
 * A submit response: a plain EvaluationResult (cloze/translation/vocab/sentence)
 * or a richer DictationResult. DictationResult is a structural superset of
 * EvaluationResult, so consumers reading base fields (score/feedback/errors)
 * work for both arms; the dictation component narrows via `isDictationResult`.
 */
export type SubmissionResult = EvaluationResult | DictationResult;

export type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'evaluated'; result: SubmissionResult; meta: SubmissionMeta }
  | { kind: 'error'; error: Error };
