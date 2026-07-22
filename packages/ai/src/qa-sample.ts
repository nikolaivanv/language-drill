import { ExerciseType } from "@language-drill/shared";
import type { ExerciseContent } from "@language-drill/shared";

/**
 * Render exactly what a learner sees for one exercise, as plain text — the
 * crafter's input. Deliberately OMITS every reference/answer field
 * (correctAnswer, acceptableAnswers, referenceTranslation, expectedWord,
 * modelAnswers, targetForm/acceptableForms, breakdown, exampleSentences,
 * referenceParaphrases) so the crafter solves blind, as a user would.
 */
export function renderLearnerView(content: ExerciseContent): string {
  const lines: string[] = [];
  switch (content.type) {
    case ExerciseType.CLOZE: {
      lines.push(content.instructions);
      if (content.context) lines.push(`Context: ${content.context}`);
      if (content.glossEn) lines.push(`Meaning: ${content.glossEn}`);
      lines.push(content.sentence);
      if (content.options?.length) lines.push(`Options: ${content.options.join(", ")}`);
      break;
    }
    case ExerciseType.TRANSLATION: {
      lines.push(content.instructions);
      lines.push(`(${content.sourceLanguage} → ${content.targetLanguage})`);
      lines.push(content.sourceText);
      break;
    }
    case ExerciseType.VOCAB_RECALL: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.exampleSentence) lines.push(`Example: ${content.exampleSentence}`);
      if (content.hints?.length) lines.push(`Hints: ${content.hints.join(", ")}`);
      break;
    }
    case ExerciseType.SENTENCE_CONSTRUCTION: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.keywords?.length) lines.push(`Keywords: ${content.keywords.join(", ")}`);
      if (content.targetStructure) lines.push(`Target structure: ${content.targetStructure}`);
      if (content.register) lines.push(`Register: ${content.register}`);
      break;
    }
    case ExerciseType.CONJUGATION: {
      lines.push(content.instructions);
      lines.push(`Verb: ${content.lemma} (${content.lemmaGloss})`);
      if (content.subject) lines.push(`Subject: ${content.subject.pronoun} (${content.subject.gloss})`);
      lines.push(`Form required: ${content.featureBundle}`);
      break;
    }
    case ExerciseType.CONTEXTUAL_PARAPHRASE: {
      lines.push(content.instructions);
      lines.push(content.sourceText);
      lines.push(content.constraintLabel);
      if (content.bannedTerms?.length) lines.push(`Do not use: ${content.bannedTerms.join(", ")}`);
      if (content.targetRegister) lines.push(`Target register: ${content.targetRegister}`);
      if (content.audience) lines.push(`Audience: ${content.audience}`);
      break;
    }
    default: {
      // Free-writing / dictation are out of scope; caller filters them out.
      const _exhaustive: never = content as never;
      throw new Error(`renderLearnerView: unsupported content type ${(content as ExerciseContent).type}`);
    }
  }
  return lines.join("\n");
}

/** Score at/above which the evaluator is treated as accepting the answer. */
export const PASS_THRESHOLD = 0.8;
/** Score at/below which the evaluator is treated as rejecting the answer. */
export const FAIL_THRESHOLD = 0.4;
/** Below this self-reported confidence, correct/alt flags are suppressed. */
export const MIN_CORRECT_CONFIDENCE = 0.7;

export type QaFlagReason =
  | "false_negative"
  | "false_positive"
  | "acceptable_answers_gap"
  | "low_confidence_solve";

export type ProbeScores = {
  correct: number;
  wrong: number;
  /** null when the exercise has a single canonical answer (no alt crafted). */
  alt: number | null;
};

type Band = "pass" | "fail" | "deadzone";
function band(score: number): Band {
  if (score >= PASS_THRESHOLD) return "pass";
  if (score <= FAIL_THRESHOLD) return "fail";
  return "deadzone";
}

/**
 * Map probe scores to defect reasons. Only *clear* band crossings flag; dead-zone
 * scores never flag. The confidence gate suppresses correct/alt-derived flags
 * (shaky ground truth) but never the false_positive signal (a wrong answer being
 * accepted is independent of how sure the solver was about the correct answer).
 * Emission order is stable: false_negative, false_positive, acceptable_answers_gap,
 * then low_confidence_solve.
 */
export function classifyVerdicts(
  scores: ProbeScores,
  correctConfidence: number,
): QaFlagReason[] {
  const flags: QaFlagReason[] = [];
  const lowConfidence = correctConfidence < MIN_CORRECT_CONFIDENCE;

  if (!lowConfidence && band(scores.correct) === "fail") flags.push("false_negative");
  if (band(scores.wrong) === "pass") flags.push("false_positive");
  if (!lowConfidence && scores.alt !== null && band(scores.alt) === "fail") {
    flags.push("acceptable_answers_gap");
  }
  if (lowConfidence) flags.push("low_confidence_solve");

  return flags;
}
