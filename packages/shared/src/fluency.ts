// NOTE: Imported from ./index despite index re-exporting this file (a same-package
// cycle): safe because ExerciseType is a TS enum (TDZ-immune). However,
// module-scope references to ExerciseType members (like FLUENCY_ELIGIBLE_TYPES)
// would create an init-order hazard, so we use the underlying string enum values
// directly for module-scope constants. All ExerciseType references inside function
// bodies are fine and use the import normally.
import {
  ExerciseType,
  type ExerciseContent,
  isClozeContent,
  isVocabRecallContent,
  isConjugationContent,
} from "./index";

// ---------------------------------------------------------------------------
// Fluency mode — locked constants (single source of truth)
// ---------------------------------------------------------------------------

/** An item is fluency-eligible once its most-recent accuracy score reaches this. */
export const FLUENCY_MASTERY_THRESHOLD = 0.8;

/** Minimum eligible items required before fluency mode is offered. */
export const MIN_FLUENCY_POOL = 4;

/** Reported think-times above this are stored clamped (backgrounded-tab guard). */
export const LATENCY_CEILING_MS = 60_000;

/** Default number of items per fluency session. */
export const DEFAULT_FLUENCY_SESSION_SIZE = 8;

/** Only locally-gradable types qualify (no Claude round-trip in fluency mode). */
// Use string literals here (not ExerciseType.CLOZE) to avoid module-scope
// init-order hazard from the same-package cycle with ./index. The string values
// are identical to the enum members ("cloze", "vocab_recall") per the enum def.
export const FLUENCY_ELIGIBLE_TYPES: readonly ExerciseType[] = [
  "cloze" as ExerciseType,
  "vocab_recall" as ExerciseType,
  "conjugation" as ExerciseType,
];

export function isFluencyEligibleType(type: ExerciseType): boolean {
  return FLUENCY_ELIGIBLE_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Deterministic grader
// ---------------------------------------------------------------------------
// NOTE: diacritics are NOT stripped — é/ü/ı are meaningful in ES/DE/TR and a
// wrong diacritic is a wrong answer. We only normalise case + surrounding/
// internal whitespace + Unicode form.
//
// Turkish İ/I: mobile keyboards auto-capitalize the first letter, and the
// capital depends on the keyboard — a TR keyboard gives i→İ / ı→I, a non-TR
// keyboard gives i→I. No single locale's lowercasing maps all of those back
// to the intended letter (e.g. "İ".toLocaleLowerCase("en") is "i̇" with a
// combining dot, and "I".toLocaleLowerCase("tr") is "ı"). So matching runs
// under BOTH folds: a candidate is correct if it equals an accepted form
// under the root fold or the Turkish fold. For non-Turkish text the two
// folds are identical, so no language threading is needed, and the folds
// never disagree on a true i-vs-ı distinction (no false accepts).
const CASE_FOLD_LOCALES = ["en", "tr"] as const;

// Trailing sentence punctuation is dropped: mobile keyboards auto-insert a
// period (iOS double-space), and a full stop after a bare form carries no
// signal about the form itself. Apostrophes are NOT stripped — they are
// orthographically meaningful (e.g. Turkish proper-noun suffixation).
export function normalizeFluencyAnswer(raw: string, locale?: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:…]+$/, "")
    .toLocaleLowerCase(locale);
}

function matchesAccepted(accepted: string, candidate: string): boolean {
  return CASE_FOLD_LOCALES.some(
    (locale) =>
      normalizeFluencyAnswer(accepted, locale) === normalizeFluencyAnswer(candidate, locale),
  );
}

/**
 * Grade a fluency answer deterministically. Returns true on an exact
 * (normalised) match against the content's accepted forms.
 * Throws for non-eligible content types — the route guards type before calling.
 */
export function gradeFluencyAnswer(content: ExerciseContent, answer: string): boolean {
  if (isClozeContent(content)) {
    const accepted = [content.correctAnswer, ...(content.acceptableAnswers ?? [])];
    return accepted.some((a) => matchesAccepted(a, answer));
  }

  if (isVocabRecallContent(content)) {
    const accepted = [content.expectedWord, ...(content.acceptableAnswers ?? [])];
    return accepted.some((a) => matchesAccepted(a, answer));
  }

  if (isConjugationContent(content)) {
    const accepted = [content.targetForm, ...(content.acceptableForms ?? [])];
    return accepted.some((a) => matchesAccepted(a, answer));
  }

  throw new Error(`gradeFluencyAnswer: unsupported content type "${content.type}"`);
}
