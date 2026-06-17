import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { exercises } from './exercises';
import { userExerciseHistory } from './progress';
import { users } from './users';

// User-submitted reports that an exercise attempt looked wrong (bad
// answer-acceptance or bad explanation). One row per attempt (unique history_id).
// Flagging has NO effect on the exercise pool — an admin reviews and decides.
export const exerciseFlags = pgTable(
  'exercise_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The specific attempt being flagged. Cascade so right-to-erasure sweeps it.
    historyId: uuid('history_id')
      .notNull()
      .references(() => userExerciseHistory.id, { onDelete: 'cascade' }),
    // Denormalized for cheap admin filtering/joins; cascade with the exercise.
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    // Who flagged. Cascade matches the user-owned-table erasure convention.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'wrong_answer' | 'misleading_explanation' | 'confusing_prompt' | 'other'
    category: text('category').notNull(),
    note: text('note'), // nullable free-text
    // 'open' | 'resolved_rejected' | 'resolved_dismissed'
    status: text('status').notNull().default('open'),
    resolvedBy: text('resolved_by'), // admin userId; nullable
    resolvedAt: timestamp('resolved_at', { withTimezone: true }), // nullable
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One flag per attempt.
    historyIdUnique: uniqueIndex('exercise_flags_history_id_unique').on(table.historyId),
    // Admin queue: filter by status, newest first.
    statusCreatedAtIdx: index('exercise_flags_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);

export type ExerciseFlag = InferSelectModel<typeof exerciseFlags>;
export type NewExerciseFlag = InferInsertModel<typeof exerciseFlags>;
