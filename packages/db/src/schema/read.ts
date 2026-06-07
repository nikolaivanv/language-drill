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

import { index, integer, jsonb, pgTable, real, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import type {
  CefrLevel,
  DeepCard,
  LearningLanguage,
  ReadingCategory,
  ReadingTextLength,
  ReviewItemType,
  ReviewOutcome,
  SpanAnnotations,
  VocabReviewStatus,
  WordFlag,
} from '@language-drill/shared';
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
    // Deep cards resolved on-demand for this entry, keyed by "start:end"
    // character offsets. Nullable: null/absent ⇒ no deep cards persisted yet
    // (Req 11.1). Written incrementally via a jsonb merge, never re-saving the
    // whole entry.
    spanAnnotations: jsonb('span_annotations').$type<SpanAnnotations>(),
    // Generation provenance (null for pasted entries). Persisted so library
    // cards are rich and "adjust" works after reopening a generated text.
    kind: text('kind').$type<'generated' | 'pasted'>().notNull().default('pasted'),
    category: text('category').$type<ReadingCategory>(),
    cefr: text('cefr').$type<CefrLevel>(),
    length: text('length').$type<ReadingTextLength>(),
    prompt: text('prompt'),
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
    // The full deep-card snapshot captured at save time (word|phrase only).
    // Nullable: the lexical columns above stay authoritative for queries; the
    // snapshot powers the Part-2 review unit (Req 8.1).
    card: jsonb('card').$type<DeepCard>(),
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

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — FSRS scheduler state
// ---------------------------------------------------------------------------
// One row per logical review card `(user, language, lemma)`. The existing
// per-surface `userVocabulary` rows are pooled into a card's occurrences at
// query time; this table holds only the spaced-repetition state, keeping
// `userVocabulary`'s surface-form key untouched (non-destructive Part 2).
//
// `fsrsCardJson` is the round-trip source of truth for the `ts-fsrs` Card; the
// scheduler module (infra/lambda/src/lib/review) owns its shape, so it is typed
// generically here to keep `@language-drill/db` free of a `ts-fsrs` dependency.
// `stability`, `difficulty`, `reps`, `lapses`, `state`, and `dueAt` are
// denormalized from that Card for indexed queries and direct UI reads.
// ---------------------------------------------------------------------------

export const vocabularyReviewState = pgTable(
  'vocabulary_review_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    lemma: text('lemma').notNull(),
    fsrsCardJson: jsonb('fsrs_card_json').$type<Record<string, unknown>>().notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: text('state').$type<VocabReviewStatus>().notNull().default('new'),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userLangLemmaUq: unique('vocabulary_review_state_user_lang_lemma_uq').on(
      t.userId,
      t.language,
      t.lemma,
    ),
    // Queue build: due cards per language ordered by due date.
    userLangDueAtIdx: index('vocabulary_review_state_user_lang_due_at_idx').on(
      t.userId,
      t.language,
      t.dueAt,
    ),
    // Bank filters / leech surfacing by lifecycle state.
    userLangStateIdx: index('vocabulary_review_state_user_lang_state_idx').on(
      t.userId,
      t.language,
      t.state,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — review sessions
// ---------------------------------------------------------------------------
// One row per started review session, mirroring `practiceSessions`. Groups the
// `vocabulary_review_log` rows for the end-of-session summary. `filter` records
// the queue filter used (e.g. `{ readEntryId }`, `{ grammarPoint }`, or null
// for the default per-language queue).
// ---------------------------------------------------------------------------

export const vocabularyReviewSessions = pgTable(
  'vocabulary_review_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    filter: jsonb('filter'),
    itemCount: smallint('item_count').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    userIdStartedAtIdx: index('vocabulary_review_sessions_user_id_started_at_idx').on(
      t.userId,
      t.startedAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — graded-item evidence log
// ---------------------------------------------------------------------------
// One row per graded review item. This is the evidence feed the progress radar
// UNIONs in (the existing `userExerciseHistory.exerciseId` FK forbids writing
// review rows there). Also backs the word-detail review history. `grammarPoints`
// holds the tested occurrence's free-text labels for the "what moved" deltas.
// ---------------------------------------------------------------------------

export const vocabularyReviewLog = pgTable(
  'vocabulary_review_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    reviewStateId: uuid('review_state_id')
      .references(() => vocabularyReviewState.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id').references(() => vocabularyReviewSessions.id, {
      onDelete: 'set null',
    }),
    lemma: text('lemma').notNull(),
    itemType: text('item_type').$type<ReviewItemType>().notNull(),
    surface: text('surface'),
    outcome: text('outcome').$type<ReviewOutcome>().notNull(),
    rating: smallint('rating').notNull(),
    cefrBand: text('cefr_band').$type<CefrLevel>(),
    grammarPoints: jsonb('grammar_points').$type<string[]>().notNull().default([]),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Radar UNION + grammar-delta aggregation by recency.
    userLangReviewedAtIdx: index('vocabulary_review_log_user_lang_reviewed_at_idx').on(
      t.userId,
      t.language,
      t.reviewedAt,
    ),
    // Word-detail review history per card.
    reviewStateReviewedAtIdx: index('vocabulary_review_log_review_state_reviewed_at_idx').on(
      t.reviewStateId,
      t.reviewedAt,
    ),
  }),
);

/**
 * Shared, cross-user cache of generated reading texts. Keyed by a hash of
 * (language, cefr, length, normalizedPrompt). A cache hit serves an existing
 * text for free; only a miss triggers an LLM call and meters the user.
 */
export const generatedReadingTexts = pgTable(
  'generated_reading_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cacheKey: text('cache_key').notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    cefr: text('cefr').$type<CefrLevel>().notNull(),
    length: text('length').notNull(),
    prompt: text('prompt').notNull(),
    title: text('title').notNull().default(''),
    text: text('text').notNull(),
    difficultyScore: real('difficulty_score').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cacheKeyUq: unique('generated_reading_texts_cache_key_uq').on(t.cacheKey),
  }),
);
