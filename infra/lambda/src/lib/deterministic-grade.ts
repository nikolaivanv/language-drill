import {
  gradeFluencyAnswer,
  gradeVocabArticle,
  isVocabRecallContent,
  VOCAB_MISSING_ARTICLE_SCORE,
} from '@language-drill/shared';
import type {
  ClozeContent,
  EvaluationResult,
  VocabRecallContent,
} from '@language-drill/shared';

/**
 * Zero-Claude grading for cloze + vocab_recall submits. Returns the result to
 * persist, or null when the answer needs the LLM evaluator.
 *
 * Vocab outcomes, in order:
 *   - give-up ("show answer" after every hint) → 0, tagged `revealed`
 *   - article-bearing noun (`articleForm` set): right word + right article → 1,
 *     right word without its article → VOCAB_MISSING_ARTICLE_SCORE; a different
 *     article falls through to the evaluator (see below)
 *   - plain exact match against expectedWord/acceptableAnswers → 1
 * `difficulty` is echoed into the vocabulary/CEFR fields, which the
 * deterministic path cannot judge (same convention as the conjugation branch).
 */
export function deterministicFluencyResult(
  content: ClozeContent | VocabRecallContent,
  userAnswer: string,
  gaveUp: boolean,
  difficulty: string,
): EvaluationResult | null {
  const base = {
    vocabularyRange: difficulty,
    estimatedCefrEvidence: difficulty,
    evaluationSource: 'deterministic' as const,
  };

  if (isVocabRecallContent(content)) {
    const target = content.articleForm ?? content.expectedWord;

    if (gaveUp) {
      return {
        ...base,
        score: 0,
        grammarAccuracy: 0,
        taskAchievement: 0,
        feedback: `The word was ${target}.`,
        errors: [
          {
            type: 'vocabulary',
            severity: 'major',
            text: '',
            correction: target,
            explanation: 'Answer revealed after all hints.',
            code: 'revealed',
          },
        ],
      };
    }

    const grade = gradeVocabArticle(content, userAnswer);
    if (grade === 'exact') {
      return {
        ...base,
        score: 1,
        grammarAccuracy: 1,
        taskAchievement: 1,
        feedback: `Correct — ${userAnswer.trim()}`,
        errors: [],
      };
    }
    if (grade === 'missing-article') {
      return {
        ...base,
        score: VOCAB_MISSING_ARTICLE_SCORE,
        grammarAccuracy: VOCAB_MISSING_ARTICLE_SCORE,
        taskAchievement: 1,
        feedback: `Right word — include the article to show its gender: ${target}.`,
        errors: [
          {
            type: 'grammar',
            severity: 'minor',
            text: userAnswer.trim(),
            correction: target,
            explanation: 'Nouns are answered with their definite article.',
            code: 'missing-article',
          },
        ],
      };
    }
    // A different article is NOT graded here: common-gender nouns ("el/la
    // periodista", "el/la estudiante") are curated with one article but take
    // either, and only the evaluator can tell. The route tags its verdict with
    // `tagWrongArticle` so the UI still labels a real gender miss precisely.
    if (grade === 'wrong-article') return null;
    // gradeFluencyAnswer below applies the same article rule, so an
    // article-bearing noun cannot pass there without its article.
  }

  if (gradeFluencyAnswer(content, userAnswer)) {
    return {
      ...base,
      score: 1,
      grammarAccuracy: 1,
      taskAchievement: 1,
      feedback: `Correct — ${userAnswer.trim()}`,
      errors: [],
    };
  }
  return null;
}

/**
 * After the evaluator grades a vocab answer whose only visible difference is
 * the article (`gradeVocabArticle` → `wrong-article`), tag its grammar error so
 * the UI labels it "wrong gender" rather than the generic inflection label. A
 * full score (a common-gender noun) is left untouched.
 */
export function tagWrongArticle(
  content: VocabRecallContent,
  userAnswer: string,
  result: EvaluationResult,
): EvaluationResult {
  if (result.score >= 1 || gradeVocabArticle(content, userAnswer) !== 'wrong-article') {
    return result;
  }
  let tagged = false;
  const errors = result.errors.map((e) => {
    if (tagged || e.type !== 'grammar') return e;
    tagged = true;
    return { ...e, code: 'wrong-article' as const };
  });
  return tagged ? { ...result, errors } : result;
}
