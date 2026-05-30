// ---------------------------------------------------------------------------
// Vocabulary Review — local grading (no LLM)
// ---------------------------------------------------------------------------
// Decides `correct | partial | incorrect` for the three locally-graded item
// types (cloze, meaning→production, recognition). Pure + free + instant
// (Req 8.1). `partial` is a near-miss that maps to FSRS `Hard` in the
// scheduler: an accent/diacritic-only mismatch, or a meaning answer reached
// only with hints (Req 8.2, 6.3). Hint-tainting for meaning is folded into the
// outcome here so the session summary's clean/partial/missed counts are
// correct; `ratingFromOutcome` then maps partial→Hard.
// ---------------------------------------------------------------------------

import type { LearningLanguage, ReviewOutcome } from '@language-drill/shared';

// BCP-47 locale per learning language, for correct case-folding (notably
// Turkish dotted/dotless i: İ↔i, I↔ı under `tr`).
const LOCALE: Record<LearningLanguage, string> = {
  ES: 'es',
  DE: 'de',
  TR: 'tr',
};

/**
 * Strict normalization: trim, collapse internal whitespace, locale-aware
 * lowercase. Accents are preserved (the strict comparison is accent-sensitive).
 */
export function normalize(input: string, language: LearningLanguage): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase(LOCALE[language]);
}

/** Strip combining diacritics for the accent-insensitive (partial) compare. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Base match of a single answer against a single expected string:
 *   exact normalized → 'correct'
 *   matches only once accents are stripped → 'partial'
 *   otherwise → 'incorrect'
 */
function matchOne(
  answer: string,
  expected: string,
  language: LearningLanguage,
): ReviewOutcome {
  const a = normalize(answer, language);
  const e = normalize(expected, language);
  if (a.length === 0) return 'incorrect';
  if (a === e) return 'correct';
  if (stripDiacritics(a) === stripDiacritics(e)) return 'partial';
  return 'incorrect';
}

/** Best (most generous) outcome across several accepted strings. */
function bestMatch(
  answer: string,
  expected: readonly string[],
  language: LearningLanguage,
): ReviewOutcome {
  let best: ReviewOutcome = 'incorrect';
  for (const e of expected) {
    const r = matchOne(answer, e, language);
    if (r === 'correct') return 'correct';
    if (r === 'partial') best = 'partial';
  }
  return best;
}

/**
 * Cloze-in-context: the learner types the inflected surface form that fills the
 * blanked saved sentence. Accent-only mismatch is a `partial` (Req 5.2).
 */
export function gradeCloze(
  answer: string,
  expectedSurface: string,
  language: LearningLanguage,
): ReviewOutcome {
  return matchOne(answer, expectedSurface, language);
}

/**
 * Meaning→production: the learner produces the target word from its meaning.
 * Matched against the lemma + its accepted inflected forms. A correct answer
 * reached with one or more hints is downgraded to `partial` (Req 6.2, 6.3).
 */
export function gradeMeaning(
  answer: string,
  acceptedForms: readonly string[],
  language: LearningLanguage,
  hintsUsed = 0,
): ReviewOutcome {
  const base = bestMatch(answer, acceptedForms, language);
  if (base === 'correct' && hintsUsed > 0) return 'partial';
  return base;
}

/**
 * Recognition warm-up (word→meaning): an exact choice match. Cheap, binary —
 * no partial (Req 7.3).
 */
export function gradeRecognition(
  selectedKey: string,
  correctKey: string,
): ReviewOutcome {
  return selectedKey === correctKey ? 'correct' : 'incorrect';
}
