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
/** A citation-form hint written straight after the blank: `bir ___ (destek)`. */
const HINT_AFTER_BLANK = /(_{3,})\s*\([^()]*\)/g;
/** The generator's trailing citation-form hint: `… gidiyorum. (okul)`. */
const TRAILING_HINT = /\s*\([^()]*\)\s*$/;
const TRAILING_PUNCT = /[.,!?;:…]+$/;
/** A cloze fill this many words longer than the key is treated as a restated sentence. */
const MAX_EXTRA_FILL_WORDS = 3;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * True when the model returned (part of) the sentence instead of just the
 * blank's fill — substituting it would make the learner hear words twice.
 */
function restatesSentence(fill: string, sentence: string, correctAnswer: string): boolean {
  if (wordCount(fill) > wordCount(correctAnswer) + MAX_EXTRA_FILL_WORDS) return true;
  const lowerFill = fill.toLocaleLowerCase();
  return sentence
    .split(BLANK)
    .map((side) => side.replace(/[.,!?;:…¡¿"]/g, ' ').trim().toLocaleLowerCase())
    .some((side) => side.length >= 4 && lowerFill.includes(side));
}

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
    // Drop the generator's citation-form hint ("(okul)", "(dar / se / las)") —
    // it is a prompt for the learner, not part of the sentence. Any other
    // parenthetical means we can't be sure what the sentence is.
    const sentence = content.sentence.replace(HINT_AFTER_BLANK, '$1').replace(TRAILING_HINT, '');
    if (/[()]/.test(sentence)) return null;
    const blanks = sentence.match(BLANK) ?? [];
    if (blanks.length !== 1) return null;
    let fill: string | null;
    if (evaluation.evaluationSource === 'deterministic') {
      fill = matchedClozeForm(content, userAnswer) ?? content.correctAnswer;
    } else {
      const picked = pickCorrected(evaluation, userAnswer);
      fill = picked === undefined ? content.correctAnswer : picked;
      if (fill !== null && restatesSentence(fill, sentence, content.correctAnswer)) {
        fill = content.correctAnswer;
      }
    }
    if (fill === null) return null;
    const value = fill.trim().replace(TRAILING_PUNCT, '');
    if (value.length === 0) return null;
    // `krank ___ .` → `krank geworden.`
    raw = sentence.replace(BLANK, () => value).replace(/\s+([.,!?;:…])/g, '$1');
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
