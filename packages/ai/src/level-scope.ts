/**
 * packages/ai — Curriculum-grounded CEFR "level scope" block.
 *
 * Both the generation and validation system prompts judged level-appropriateness
 * from only the single target grammar point + generic one-line CEFR descriptors,
 * so `levelMatch` drifted to the model's own sense of the level and produced
 * spurious rejections. This block lists the grammar points a learner at or below
 * the target level has actually studied (from the curriculum), giving both
 * prompts a shared ground truth.
 *
 * Gated to the four grammar-anchored exercise types — cloze, translation,
 * sentence_construction, conjugation. For every other type (e.g. vocab_recall,
 * which shares the generation template) it returns "", so the `{{levelScopeSection}}`
 * placeholder collapses and the cached prompt prefix is unchanged. Pure +
 * deterministic (curriculum is static), preserving prompt-cache parity.
 */

import {
  type CefrLevel,
  ExerciseType,
  type LearningLanguage,
} from "@language-drill/shared";
import { grammarPointsAtOrBelow } from "@language-drill/db";

const LEVEL_SCOPE_TYPES: ReadonlySet<ExerciseType> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.CONJUGATION,
]);

// Mirrors CurriculumCefrLevel (the four in-round levels). Update if the curriculum expands.
const LEVEL_ORDER = ["A1", "A2", "B1", "B2"] as const;

export function renderLevelScopeSection(
  exerciseType: ExerciseType,
  language: LearningLanguage,
  cefrLevel: CefrLevel,
): string {
  if (!LEVEL_SCOPE_TYPES.has(exerciseType)) return "";
  const points = grammarPointsAtOrBelow(language, cefrLevel);
  if (points.length === 0) return "";

  const byLevel = new Map<string, string[]>();
  for (const p of points) {
    const names = byLevel.get(p.cefrLevel) ?? [];
    names.push(p.name);
    byLevel.set(p.cefrLevel, names);
  }
  const lines = LEVEL_ORDER.filter((lvl) => byLevel.has(lvl))
    .map((lvl) => `- ${lvl}: ${byLevel.get(lvl)!.join("; ")}`)
    .join("\n");

  return `## Grammar in this learner's scope (CEFR ≤ ${cefrLevel}, ${language})

Treat any grammar or vocabulary within or below this scope as level-appropriate. Do not require — or penalize the absence of — constructions above CEFR ${cefrLevel}. Obligatory morphology inherent to the language — vowel harmony and agglutination in Turkish, case and gender inflection in German, verb conjugation in Spanish — is part of ${language} at every level, not "above level."

${lines}

`;
}
