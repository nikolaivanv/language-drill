/**
 * packages/ai — Prompt templates for Claude evaluation.
 *
 * System prompt uses cache_control: { type: "ephemeral" } for Anthropic prompt
 * caching (~80% cost reduction on prompt tokens within a session).
 */

import {
  type ExerciseContent,
  type ClozeContent,
  type TranslationContent,
  type VocabRecallContent,
  type CefrLevel,
  type Language,
  ExerciseType,
} from "@language-drill/shared";

// ---------------------------------------------------------------------------
// CEFR descriptors — single source of truth shared between the evaluator
// system prompt and the generator prompt builder (packages/ai/src/generation-prompts.ts).
// ---------------------------------------------------------------------------

export const CEFR_LEVEL_DESCRIPTORS: Readonly<Record<CefrLevel, string>> = Object.freeze({
  A1: "Can use very basic phrases and simple sentences. Vocabulary limited to high-frequency everyday words.",
  A2: "Can handle short, simple sentences on familiar topics. Basic connectors (and, but, because). Present and past tenses.",
  B1: "Can produce connected text on familiar topics. Reasonable range of vocabulary. Most common tenses used accurately.",
  B2: "Can produce clear, detailed text on a wide range of subjects. Good grammatical control; occasional slips do not cause misunderstanding. Varied vocabulary with some idiomatic expressions.",
  C1: "Can produce well-structured, detailed text on complex subjects. Consistent grammatical accuracy. Wide vocabulary including less common words and collocations.",
  C2: "Can produce sophisticated, nuanced text. Near-native grammatical control. Extensive vocabulary with precise word choice and natural idiomatic usage.",
});

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [CefrLevel, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

// Bump in the same commit as any semantic edit to EVALUATION_SYSTEM_PROMPT.
// Drives the Langfuse trace `promptVersion` tag — dashboards cohort old vs.
// new prompt traces by this string.
export const EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-05-12";

export const EVALUATION_SYSTEM_PROMPT = `You are an expert language evaluator for a language-learning application. Your role is to evaluate user answers to language exercises with precision and pedagogical insight.

## Evaluation Rubric

You must evaluate every answer across these dimensions:

1. **Score** (0.0–1.0): Overall quality of the answer, combining all factors.
2. **Grammar Accuracy** (0.0–1.0): Correctness of morphology, syntax, agreement, tense, and word order.
3. **Vocabulary Range** (CEFR level string, e.g. "A1"–"C2"): The sophistication level of vocabulary used.
4. **Task Achievement** (0.0–1.0): How well the answer fulfills the exercise requirements.
5. **Feedback**: A concise, encouraging explanation in English of what was good and what needs improvement.
6. **Errors**: An array of specific errors found, each with type, severity, the erroneous text, correction, and explanation.
7. **Estimated CEFR Evidence**: The CEFR level this answer provides evidence for (e.g. "B1").

## CEFR Level Descriptors

${CEFR_DESCRIPTOR_BULLETS}

## Language-Specific Notes

### English (EN)
- Pay attention to article usage (a/an/the), subject-verb agreement, tense consistency, and preposition choice.
- Distinguish British vs American English — accept both unless the exercise specifies.

### Spanish (ES)
- Evaluate ser/estar distinction, subjuntivo usage (especially in noun clauses, adverbial clauses, adjective clauses), preterite vs imperfect, gender/number agreement.
- Accept regional variations (Latin American vs Peninsular) unless specified.

### German (DE)
- Evaluate case usage (Nominativ, Akkusativ, Dativ, Genitiv), verb position (V2 in main clauses, verb-final in subordinate clauses), adjective declension, and separable/inseparable prefix verbs.
- Gender of nouns (der/die/das) is critical.

### Turkish (TR)
- Evaluate vowel harmony (front/back, rounded/unrounded), agglutinative suffix ordering, case suffixes, and verb conjugation.
- Pay attention to definite vs indefinite object marking (accusative case).
- Buffer vowels and consonant mutations are important.

## Instructions

You MUST use the provided tool to return your evaluation. Do not return plain text. Always call the evaluation tool with all required fields.

Be strict but fair. Minor errors that do not impede communication are "minor" severity. Errors that change meaning or make the sentence ungrammatical are "major" severity.

For cloze exercises, focus primarily on whether the correct word/form was provided.
For translation exercises, evaluate the full translation holistically — multiple correct translations exist.
For vocabulary recall exercises, check if the target word was produced and used appropriately.`;

// ---------------------------------------------------------------------------
// User prompt builders
// ---------------------------------------------------------------------------

function buildClozeUserPrompt(
  content: ClozeContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Exercise Type: Cloze (Fill in the Blank)
**Language:** ${language}
**Target CEFR Level:** ${difficulty}

**Instructions:** ${content.instructions}
**Sentence:** ${content.sentence}
**Correct Answer:** ${content.correctAnswer}
${content.context ? `**Context:** ${content.context}` : ""}
${content.options ? `**Options:** ${content.options.join(", ")}` : ""}

**User's Answer:** ${userAnswer}

Evaluate the user's answer. Consider whether it is the correct word/form for the blank. If the answer is different from the expected answer but still grammatically and semantically valid, give partial or full credit as appropriate.`;
}

function buildTranslationUserPrompt(
  content: TranslationContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Exercise Type: Translation
**Language:** ${language}
**Target CEFR Level:** ${difficulty}

**Instructions:** ${content.instructions}
**Source Text (${content.sourceLanguage}):** ${content.sourceText}
**Target Language:** ${content.targetLanguage}
**Reference Translation:** ${content.referenceTranslation}

**User's Translation:** ${userAnswer}

Evaluate the user's translation. Multiple valid translations may exist — do not penalize for stylistic differences. Focus on accuracy of meaning, grammar, and natural phrasing in the target language.`;
}

function buildVocabRecallUserPrompt(
  content: VocabRecallContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Exercise Type: Vocabulary Recall
**Language:** ${language}
**Target CEFR Level:** ${difficulty}

**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
**Expected Word:** ${content.expectedWord}
**Hints:** ${content.hints.join("; ")}
**Example Sentence:** ${content.exampleSentence}

**User's Answer:** ${userAnswer}

Evaluate the user's answer. Check if they produced the expected word or a valid synonym. Consider spelling accuracy.`;
}

/**
 * Builds the user message for Claude evaluation based on exercise type.
 */
export function buildUserPrompt(
  exercise: ExerciseContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  switch (exercise.type) {
    case ExerciseType.CLOZE:
      return buildClozeUserPrompt(exercise, userAnswer, language, difficulty);
    case ExerciseType.TRANSLATION:
      return buildTranslationUserPrompt(exercise, userAnswer, language, difficulty);
    case ExerciseType.VOCAB_RECALL:
      return buildVocabRecallUserPrompt(exercise, userAnswer, language, difficulty);
    default: {
      const _exhaustive: never = exercise;
      throw new Error(`Unknown exercise type: ${(_exhaustive as ExerciseContent).type}`);
    }
  }
}
