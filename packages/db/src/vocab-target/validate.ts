import { parseVocabPos, type VocabPos } from '@language-drill/shared';

export type ProposedWord = {
  displayForm: string;
  lemma: string;
  gloss: string;
  exampleSentence: string;
  pos: VocabPos;
};

/** Longest fixed expression / prepositional verb accepted as one target. */
export const MAX_LEMMA_TOKENS = 4;

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** NFC, lower-case, then drop the combining dot a Turkish dotted İ leaves behind ("İ".toLowerCase() = "i" + U+0307). */
const lower = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\u0307/g, '');

const norm = (s: string): string => lower(s.trim().replace(/\s+/g, ' '));

/** A token minus its last two characters — survives inflection ("acordarse" → "acordar…", "freuen" → "freu…"). */
function exampleStem(token: string): string {
  return lower(token).slice(0, token.length - 2);
}

/**
 * Structural gate before human review. Returns a trimmed word or null.
 * `allowedPos` restricts the class (word-class groups, follow-up calls).
 */
export function validateProposedWord(
  w: unknown,
  allowedPos?: readonly VocabPos[],
): ProposedWord | null {
  if (typeof w !== 'object' || w === null) return null;
  const r = w as Record<string, unknown>;
  if (
    !nonEmptyString(r.displayForm) ||
    !nonEmptyString(r.lemma) ||
    !nonEmptyString(r.gloss) ||
    !nonEmptyString(r.exampleSentence)
  ) {
    return null;
  }
  const pos = parseVocabPos(r.pos);
  if (pos === null) return null;
  if (allowedPos && !allowedPos.includes(pos)) return null;

  const lemma = r.lemma.trim().replace(/\s+/g, ' ');
  const tokens = lemma.split(' ');
  if (tokens.length > 1 && pos !== 'phrase' && pos !== 'verb') return null;
  if (tokens.length > MAX_LEMMA_TOKENS) return null;

  // A non-noun's learner-facing form IS its citation form; the generator seeds
  // on `lemma`, so the two must agree ("acordarse de", not "acordarse").
  if (pos !== 'noun' && norm(r.displayForm) !== norm(lemma)) return null;

  const example = lower(r.exampleSentence);
  const lemmaTok = lower(lemma);
  // displayForm's last token drops a leading article (e.g. "la manzana" -> "manzana")
  const displayTok = lower(r.displayForm.trim()).split(/\s+/).pop() ?? '';
  // Short-token phrases ("por eso", "ab und zu") have no stem to match on, so
  // they must appear whole, as whole words. Both sides drop punctuation the
  // same way, so "¿qué tal?" matches "Hola, qué tal" and its "¿"/"?" never
  // count toward a token's length.
  const words = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const bareTokens = words(lemmaTok).split(' ').filter(Boolean);
  const hasStemmable = bareTokens.some((t) => t.length >= 4);
  const exampleWords = ` ${words(example)} `;
  const exampleHasWord =
    tokens.length > 1
      ? hasStemmable
        ? bareTokens.some((t) => t.length >= 4 && example.includes(exampleStem(t)))
        : exampleWords.includes(` ${bareTokens.join(' ')} `)
      : example.includes(lemmaTok) || (pos === 'noun' && example.includes(displayTok));
  if (!exampleHasWord) return null;

  return {
    displayForm: r.displayForm.trim().replace(/\s+/g, ' '),
    lemma,
    gloss: r.gloss.trim(),
    exampleSentence: r.exampleSentence.trim(),
    pos,
  };
}

export type VocabTier = 'core' | 'common' | 'extended';

/** Importance band from corpus frequency rank; null rank → extended. */
export function deriveTier(freqRank: number | null): VocabTier {
  if (freqRank === null) return 'extended';
  if (freqRank <= 1000) return 'core';
  if (freqRank <= 2500) return 'common';
  return 'extended';
}
