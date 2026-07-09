export type ProposedWord = {
  displayForm: string;
  lemma: string;
  gloss: string;
  exampleSentence: string;
};

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Structural gate before human review. Returns a trimmed word or null. */
export function validateProposedWord(w: unknown): ProposedWord | null {
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
  const lemma = r.lemma.trim();
  if (/\s/.test(lemma)) return null; // single lexical item only

  const example = r.exampleSentence.toLowerCase();
  const lemmaTok = lemma.toLowerCase();
  // displayForm's last token drops a leading article (e.g. "la manzana" -> "manzana")
  const displayTok = r.displayForm.trim().toLowerCase().split(/\s+/).pop() ?? '';
  if (!example.includes(lemmaTok) && !example.includes(displayTok)) return null;

  return {
    displayForm: r.displayForm.trim(),
    lemma,
    gloss: r.gloss.trim(),
    exampleSentence: r.exampleSentence.trim(),
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
