// ---------------------------------------------------------------------------
// Read & Collect — Drizzle tables (Phase J)
// ---------------------------------------------------------------------------
// `readEntries` stores one row per pasted passage. `flaggedWords` and `bank`
// are denormalized in JSONB so the annotated view renders from a single SELECT.
// `userVocabulary` stores one row per `(user, language, word)` saved from a
// reading bank, ready for the future drill-weaving phase. The `(user_id,
// language, word)` unique constraint backs idempotent upserts when the same
// word is saved across multiple passages.
// ---------------------------------------------------------------------------

import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import type { CefrLevel, LearningLanguage, WordFlag } from '@language-drill/shared';
import { users } from './users';

export const readEntries = pgTable(
  'read_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id).notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    title: text('title').notNull().default(''),
    source: text('source').notNull().default(''),
    text: text('text').notNull(),
    flaggedWords: jsonb('flagged_words').$type<Record<string, WordFlag>>().notNull(),
    bank: jsonb('bank').$type<string[]>().notNull().default([]),
    pastedAt: timestamp('pasted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Drizzle index DSL: pass `desc(...)` from drizzle-orm as a column
    // expression inside `.on(...)` so the resulting CREATE INDEX has
    // `pasted_at DESC`.
    userLangPastedAtIdx: index('read_entries_user_lang_pasted_at_idx').on(
      t.userId,
      t.language,
      desc(t.pastedAt),
    ),
  }),
);

export const userVocabulary = pgTable(
  'user_vocabulary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    word: text('word').notNull(),
    lemma: text('lemma').notNull(),
    // 'reading' | 'exercise' — only 'reading' is populated in v1; left
    // un-`$type`d so v2 can widen this without a schema migration.
    source: text('source').notNull(),
    sourceReadEntryId: uuid('source_read_entry_id').references(() => readEntries.id, {
      onDelete: 'set null',
    }),
    pos: text('pos').notNull(),
    gloss: text('gloss').notNull(),
    exampleSentence: text('example_sentence').notNull(),
    frequencyRank: integer('frequency_rank'),
    cefrBand: text('cefr_band').$type<CefrLevel>(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userLangWordUq: unique('user_vocabulary_user_lang_word_uq').on(
      t.userId,
      t.language,
      t.word,
    ),
    userLangIdx: index('user_vocabulary_user_lang_idx').on(t.userId, t.language),
  }),
);
