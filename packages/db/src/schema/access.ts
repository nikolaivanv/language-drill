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
    note: text('note'), // nullable — free-text label, e.g. who the code is for
    revokedAt: timestamp('revoked_at'), // nullable — set when an admin revokes
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    // Index for invite lookup at signup
    codeIdx: index('invitations_code_idx').on(table.code),
    // Index for API invite check middleware
    usedByIdx: index('invitations_used_by_idx').on(table.usedBy),
  }),
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(), // e.g. "ai_evaluation", "custom_exercise"
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    // Hot path: the per-request daily-limit query filters on
    // (user_id, event_type, created_at >= now-24h) on EVERY AI submission
    // (exercises submit, read generate, annotate-stream). Without this index
    // that's a sequential scan of an append-only table that grows with every
    // AI call. Column order matches the query's equality-then-range predicate.
    userEventTypeCreatedAtIdx: index('usage_events_user_id_event_type_created_at_idx').on(
      table.userId,
      table.eventType,
      table.createdAt,
    ),
  }),
);
