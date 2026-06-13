import { index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { exercises } from './exercises';
import { practiceSessions } from './sessions';
import { users } from './users';

export const userExerciseHistory = pgTable(
  'user_exercise_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id),
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    sessionId: uuid('session_id').references(() => practiceSessions.id, { onDelete: 'set null' }),
    score: real('score'), // 0.0–1.0
    responseJson: jsonb('response_json'), // user's answer + Claude evaluation output
    evaluatedAt: timestamp('evaluated_at'),
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
    userId: text('user_id').references(() => users.id),
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

export const userGrammarMastery = pgTable(
  'user_grammar_mastery',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
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
