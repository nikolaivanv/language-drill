import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').unique().notNull(),
    usedBy: text('used_by'), // nullable — Clerk user ID
    usedAt: timestamp('used_at'), // nullable
    expiresAt: timestamp('expires_at'), // nullable
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    // Index for invite lookup at signup
    codeIdx: index('invitations_code_idx').on(table.code),
    // Index for API invite check middleware
    usedByIdx: index('invitations_used_by_idx').on(table.usedBy),
  }),
);

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id).notNull(),
  eventType: text('event_type').notNull(), // e.g. "ai_evaluation", "custom_exercise"
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});
