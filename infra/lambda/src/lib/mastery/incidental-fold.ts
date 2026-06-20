import type { EvaluationError } from '@language-drill/shared';

export type IncidentalObs = { grammarPointKey: string; score: number; at: Date };

const SEVERITY_SCORE: Record<EvaluationError['severity'], number> = {
  major: 0,
  minor: 0.4,
};

/**
 * Turn a submission's errors into negative mastery evidence for the points they
 * violated INCIDENTALLY — i.e. attributed to a point other than the exercise's
 * host point (errors on the host point are already reflected in the submission
 * score; folding them again would double-penalize). Multiple incidental errors
 * on the same point collapse to the worst (lowest) score. Empty when host is null.
 */
export function incidentalObservations(
  errors: readonly EvaluationError[] | undefined,
  hostGrammarPointKey: string | null,
  at: Date,
): IncidentalObs[] {
  if (!errors || hostGrammarPointKey === null) return [];
  const worst = new Map<string, number>();
  for (const e of errors) {
    const key = e.grammarPointKey;
    if (!key || key === hostGrammarPointKey) continue;
    const score = SEVERITY_SCORE[e.severity];
    const prev = worst.get(key);
    if (prev === undefined || score < prev) worst.set(key, score);
  }
  return [...worst].map(([grammarPointKey, score]) => ({ grammarPointKey, score, at }));
}
