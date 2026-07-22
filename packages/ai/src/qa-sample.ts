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
