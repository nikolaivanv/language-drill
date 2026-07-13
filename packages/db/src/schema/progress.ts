import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { WordHintUnit } from '@language-drill/shared';

import { exercises } from './exercises';
import { practiceSessions } from './sessions';
import { users } from './users';

export const userExerciseHistory = pgTable(
  'user_exercise_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    sessionId: uuid('session_id').references(() => practiceSessions.id, { onDelete: 'set null' }),
    score: real('score'), // 0.0–1.0
    responseJson: jsonb('response_json'), // user's answer + Claude evaluation output
    evaluatedAt: timestamp('evaluated_at'),
    // Hint-penalty multiplier applied to this row's mastery observation (null → 1.0).
    evidenceWeight: real('evidence_weight'),
  },
  (table) => ({
    // Index for progress queries: filter by user, order by most recent
    userIdEvaluatedAtIdx: index('user_exercise_history_user_id_evaluated_at_idx').on(
      table.userId,
      table.evaluatedAt,
    ),
    // Index for session completion: count correct rows by sessionId
    sessionIdIdx: index('user_exercise_history_session_id_idx').on(table.sessionId),
    // Covering index for pool-status depletion query: join exercises → filter 7d → group by cell
    exerciseIdEvaluatedAtIdx: index('user_exercise_history_exercise_id_idx').on(
      table.exerciseId,
      table.evaluatedAt,
    ),
  }),
);

export const spacedRepetitionCards = pgTable(
  'spaced_repetition_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type'), // grammar_point | vocabulary_item
    itemId: text('item_id'),
    dueAt: timestamp('due_at'),
    interval: integer('interval').default(1), // days
    easeFactor: real('ease_factor').default(2.5),
    repetitions: integer('repetitions').default(0),
  },
  (table) => ({
    // Index for SM-2 scheduling: filter by user, order by next due date
    userIdDueAtIdx: index('spaced_repetition_cards_user_id_due_at_idx').on(
      table.userId,
      table.dueAt,
    ),
  }),
);

export const fluencyAttempts = pgTable(
  'fluency_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // onDelete cascade matches the right-to-erasure convention on the other
    // user-owned tables (the user.deleted webhook sweeps dependent rows).
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id').notNull().references(() => exercises.id),
    language: text('language'), // denormalized for cheap stats queries
    grammarPointKey: text('grammar_point_key'), // denormalized; nullable
    correct: boolean('correct').notNull(),
    latencyMs: integer('latency_ms').notNull(), // client-reported, server-clamped
    attemptedAt: timestamp('attempted_at').notNull().defaultNow(),
  },
  (table) => ({
    // Stats query: filter by user + language, order/bucket by recency.
    userIdLanguageAttemptedAtIdx: index(
      'fluency_attempts_user_id_language_attempted_at_idx',
    ).on(table.userId, table.language, table.attemptedAt),
  }),
);

export const userGrammarMastery = pgTable(
  'user_grammar_mastery',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    grammarPointKey: text('grammar_point_key').notNull(),
    masteryScore: real('mastery_score').notNull(), // 0.0–1.0
    confidence: real('confidence').notNull(), // 0.0–1.0
    evidenceCount: integer('evidence_count').notNull(),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.grammarPointKey] }),
    userLanguageIdx: index('user_grammar_mastery_user_language_idx').on(
      table.userId,
      table.language,
    ),
  }),
);

export const errorObservations = pgTable(
  'error_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: text('language').notNull(), // denormalized, uppercase (TR/ES/DE)
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'set null',
    }),
    // The history row this error was extracted from. Cascade so re-deriving or
    // erasing history sweeps the derived observations with it.
    exerciseHistoryId: uuid('exercise_history_id')
      .notNull()
      .references(() => userExerciseHistory.id, { onDelete: 'cascade' }),
    exerciseType: text('exercise_type').notNull(), // where it happened
    // The exercise's PRIMARY grammar point (always available today).
    hostGrammarPointKey: text('host_grammar_point_key'),
    // The point this specific error is ABOUT. Null until Phase 3 fills it via
    // per-error prompt attribution; consumers fall back to host_grammar_point_key.
    errorGrammarPointKey: text('error_grammar_point_key'),
    errorType: text('error_type').notNull(), // grammar | vocabulary | spelling | pragmatics
    severity: text('severity').notNull(), // minor | major
    wrongText: text('wrong_text').notNull(),
    correction: text('correction').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    // Coach / history windowed scan: filter by user+language, order by recency.
    userLanguageOccurredAtIdx: index('error_observations_user_language_occurred_at_idx').on(
      table.userId,
      table.language,
      table.occurredAt,
    ),
    // Growth-zone / per-point lookups (Phase 2/3 consumers).
    userErrorPointIdx: index('error_observations_user_error_point_idx').on(
      table.userId,
      table.errorGrammarPointKey,
    ),
    // Backfill idempotency: "already observed this history row?" check.
    historyIdIdx: index('error_observations_history_id_idx').on(table.exerciseHistoryId),
  }),
);

export type ErrorObservation = typeof errorObservations.$inferSelect;
export type NewErrorObservation = typeof errorObservations.$inferInsert;

/** Permanent per-exercise cache of the translation word-hint map (cross-user). */
export const exerciseWordHints = pgTable('exercise_word_hints', {
  exerciseId: uuid('exercise_id')
    .primaryKey()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  unitsJson: jsonb('units_json').$type<WordHintUnit[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExerciseWordHints = typeof exerciseWordHints.$inferSelect;
