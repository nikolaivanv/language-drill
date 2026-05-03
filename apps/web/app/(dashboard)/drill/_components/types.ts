import type { EvaluationResult } from '@language-drill/shared';

export type SubmissionMeta = {
  usedMc?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  hintCount?: number;
};

export type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'evaluated'; result: EvaluationResult; meta: SubmissionMeta }
  | { kind: 'error'; error: Error };
