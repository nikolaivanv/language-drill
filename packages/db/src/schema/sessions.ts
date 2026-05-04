import { index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const practiceSessions = pgTable(
  'practice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id).notNull(),
    language: text('language').notNull(),
    difficulty: text('difficulty').notNull(),
    exerciseCount: smallint('exercise_count').notNull(),
    correctCount: smallint('correct_count').notNull().default(0),
    exerciseIds: jsonb('exercise_ids').$type<string[]>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    userIdStartedAtIdx: index('practice_sessions_user_id_started_at_idx').on(
      table.userId,
      table.startedAt,
    ),
  }),
);
