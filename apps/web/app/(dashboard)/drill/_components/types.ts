import type { DictationResult, EvaluationResult } from '@language-drill/shared';

export type SubmissionMeta = {
  usedMc?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  hintCount?: number;
  hintUsage?: { wordsRevealed: number; fullAnswerRevealed: boolean };
  /** Vocab recall: the learner asked to see the answer after every hint. */
  gaveUp?: boolean;
};

/**
 * A submit response: a plain EvaluationResult (cloze/translation/vocab/sentence)
 * or a richer DictationResult. DictationResult is a structural superset of
 * EvaluationResult, so consumers reading base fields (score/feedback/errors)
 * work for both arms; the dictation component narrows via `isDictationResult`.
 */
export type SubmissionResult =
  | (EvaluationResult & {
      /** Sentence the result card can voice (null → no audio). Hear the corrected sentence, 2026-11-08. */
      spokenText?: string | null;
    })
  | DictationResult;

/** The voiceable sentence of an evaluated submission, or null. */
export function spokenTextOf(result: SubmissionResult): string | null {
  return 'spokenText' in result && typeof result.spokenText === 'string' && result.spokenText.length > 0
    ? result.spokenText
    : null;
}

export type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'evaluated'; result: SubmissionResult; meta: SubmissionMeta; submissionId?: string }
  | { kind: 'error'; error: Error };
