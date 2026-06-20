import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Lemma-level vocabulary metadata, source of truth for generation seed
 * selection (see docs/superpowers/specs/2026-06-20-vocab-lemma-pos-table-design.md).
 * One row per (language, lemma). `rank` is the min corpus rank across the
 * lemma's surfaces (sense-blind). `posAll` holds every attested UD upos tag —
 * consumers ask set-membership questions ('VERB' = ANY(pos_all)); there is no
 * principled scalar "dominant" PoS, so none is stored. `source` records
 * provenance for the gap-fill quality audit.
 */
export const vocabLemma = pgTable(
  'vocab_lemma',
  {
    language: text('language').notNull(), // ES | DE | TR (TS-enforced LearningLanguage)
    lemma: text('lemma').notNull(),
    rank: integer('rank').notNull(),
    posAll: text('pos_all').array().notNull().default([]), // e.g. {VERB,NOUN}
    source: text('source').notNull(), // wiktextract | llm | unmatched (TS-enforced)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.language, t.lemma] }),
    langRankIdx: index('vocab_lemma_language_rank_idx').on(t.language, t.rank),
  }),
);

export type VocabLemma = InferSelectModel<typeof vocabLemma>;
export type NewVocabLemma = InferInsertModel<typeof vocabLemma>;
