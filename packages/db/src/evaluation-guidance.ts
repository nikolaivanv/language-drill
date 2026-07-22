import type { GrammarGuidance, AttributionKey } from "@language-drill/ai";
import { Language } from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { getGrammarPoint, grammarPointsAtOrBelow } from "./curriculum/index.js";

/**
 * Curriculum grounding + closed attribution-key set for the answer evaluator.
 * Extracted from `infra/lambda/src/routes/exercises.ts` so the submit route AND
 * the `qa:sample` CLI feed `evaluateAnswer` byte-identical grounding — any drift
 * would silently invalidate the QA signal.
 */
export function resolveEvaluationGuidance(exercise: {
  grammarPointKey: string | null;
  language: string | null;
  difficulty: string | null;
}): { grammarGuidance?: GrammarGuidance; attributionKeys?: AttributionKey[] } {
  const grammarPoint = exercise.grammarPointKey
    ? getGrammarPoint(exercise.grammarPointKey)
    : undefined;
  const grammarGuidance = grammarPoint
    ? {
        name: grammarPoint.name,
        description: grammarPoint.description,
        commonErrors: grammarPoint.commonErrors,
      }
    : undefined;
  const attributionKeys =
    exercise.language === Language.EN
      ? []
      : grammarPointsAtOrBelow(
          exercise.language as LearningLanguage,
          exercise.difficulty as string,
        ).map((p) => ({ key: p.key, name: p.name }));
  return { grammarGuidance, attributionKeys };
}
