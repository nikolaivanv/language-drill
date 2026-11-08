import {
  ExerciseType,
  isClozeContent,
  isSentenceConstructionContent,
  isTranslationContent,
  matchedClozeForm,
  type EvaluationResult,
  type ExerciseContent,
} from '@language-drill/shared';
import {
  POLLY_NEURAL_MAX_CHARS,
  READING_VOICE_BY_LANGUAGE,
  normalizePassageText,
  type ReadingAudioLanguage,
} from '@language-drill/db';

/**
 * Below this task-achievement score an answer counts as a task miss: the
 * learner's own text is not voiced, and an unchanged `correctedAnswer` is
 * treated as an echo (no audio).
 */
export const SPOKEN_TASK_ACHIEVEMENT_FLOOR = 0.7;

export interface SpokenTextInput {
  /** `exercises.language` — the learning language. */
  exerciseLanguage: string;
  content: ExerciseContent;
  userAnswer: string;
  evaluation: EvaluationResult;
}

export interface SpokenText {
  text: string;
  language: ReadingAudioLanguage;
}

const BLANK = /_{3,}/g;

function hasVoice(language: string): language is ReadingAudioLanguage {
  return Object.prototype.hasOwnProperty.call(READING_VOICE_BY_LANGUAGE, language);
}

/**
 * The learner-facing correct text for an LLM-graded answer.
 * `undefined` = nothing usable (absent / empty); `null` = the model reported a
 * problem but echoed the answer unchanged — never voice that.
 */
function pickCorrected(evaluation: EvaluationResult, userAnswer: string): string | null | undefined {
  const clean = evaluation.errors.length === 0 && evaluation.taskAchievement >= SPOKEN_TASK_ACHIEVEMENT_FLOOR;
  if (clean) return userAnswer;
  const corrected = evaluation.correctedAnswer?.trim();
  if (!corrected) return undefined;
  if (normalizePassageText(corrected) === normalizePassageText(userAnswer)) return null;
  return corrected;
}

/**
 * The sentence to voice on a cloze / translation / sentence-construction
 * result card, derived only from the stored submission — never client text.
 * Returns null whenever the right sentence can't be determined with
 * confidence: no audio beats voicing an error
 * (docs/superpowers/specs/2026-11-08-hear-corrected-sentence-design.md).
 */
export function spokenTextFor(input: SpokenTextInput): SpokenText | null {
  const { content, userAnswer, evaluation } = input;

  let language: string;
  let raw: string | null;

  if (isClozeContent(content)) {
    language = input.exerciseLanguage;
    const blanks = content.sentence.match(BLANK) ?? [];
    if (blanks.length !== 1) return null;
    let fill: string | null;
    if (evaluation.evaluationSource === 'deterministic') {
      fill = matchedClozeForm(content, userAnswer) ?? content.correctAnswer;
    } else {
      const picked = pickCorrected(evaluation, userAnswer);
      fill = picked === undefined ? content.correctAnswer : picked;
    }
    if (fill === null) return null;
    const value = fill.trim();
    raw = content.sentence.replace(BLANK, () => value);
  } else if (isTranslationContent(content) || isSentenceConstructionContent(content)) {
    language =
      content.type === ExerciseType.TRANSLATION ? content.targetLanguage : input.exerciseLanguage;
    raw = pickCorrected(evaluation, userAnswer) ?? null;
  } else {
    return null;
  }

  if (!hasVoice(language) || raw === null) return null;
  const text = normalizePassageText(raw);
  if (text.length === 0 || text.length > POLLY_NEURAL_MAX_CHARS) return null;
  return { text, language };
}
