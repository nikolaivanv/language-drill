// Word classes for curated vocab targets (2026-10-17 vocab expansion). The
// authoring pipeline tags every `vocab_target` row with one of these so the
// themed-topic mix can be enforced and measured; word-class groups declare
// which of them they accept via `GrammarPoint.vocabGroup`.

export const VOCAB_POS = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;
export type VocabPos = (typeof VOCAB_POS)[number];

/** Normalize a model- or DB-supplied class; null for anything outside the closed set. */
export function parseVocabPos(v: unknown): VocabPos | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return (VOCAB_POS as readonly string[]).includes(s) ? (s as VocabPos) : null;
}

export const VOCAB_GROUP_LABELS = ['verbs', 'describing', 'adverbs', 'connectors', 'expressions'] as const;
export type VocabGroupLabel = (typeof VOCAB_GROUP_LABELS)[number];

/**
 * Marks a vocab umbrella as a word-class group (e.g. "Everyday verbs") rather
 * than a themed topic. `pos` restricts every authored word to those classes;
 * `label` is the tag the Words tab shows.
 */
export type VocabGroup = Readonly<{ label: VocabGroupLabel; pos: readonly VocabPos[] }>;
