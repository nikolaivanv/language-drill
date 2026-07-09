import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * Curated, reviewed vocabulary targets — the canonical "words we teach" list,
 * grouped by curriculum vocab umbrella. Mirrors the theory_topics review
 * pattern: rows are authored `status='flagged'` and promoted to `approved` by
 * human review. `freqRank` is copied from vocab_lemma at author time (null if
 * the lemma is unmatched); `tier` is the importance band derived from it.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */
export const vocabTarget = pgTable(
  'vocab_target',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: text('language').notNull(), // ES | DE | TR (TS-enforced LearningLanguage)
    umbrellaKey: text('umbrella_key').notNull(), // grammar-point key, e.g. es-a1-vocab-food-drink
    cefrLevel: text('cefr_level').notNull(), // A1 | A2 | ... (denormalized from the umbrella)
    lemma: text('lemma').notNull(), // dictionary form; join key to vocab_lemma
    displayForm: text('display_form').notNull(), // learner-facing form, may include article
    gloss: text('gloss').notNull(), // short EN meaning; hidden-by-default in UI
    exampleSentence: text('example_sentence').notNull(),
    freqRank: integer('freq_rank'), // from vocab_lemma.rank; null if unmatched
    tier: text('tier').notNull(), // core | common | extended (TS-enforced)
    status: text('status').notNull().default('flagged'), // flagged | approved
    source: text('source').notNull().default('llm'), // llm | edited
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqLemma: uniqueIndex('vocab_target_lang_umbrella_lemma_idx').on(
      t.language,
      t.umbrellaKey,
      t.lemma,
    ),
    browseIdx: index('vocab_target_browse_idx').on(
      t.language,
      t.umbrellaKey,
      t.status,
    ),
  }),
);

export type VocabTarget = InferSelectModel<typeof vocabTarget>;
export type NewVocabTarget = InferInsertModel<typeof vocabTarget>;
