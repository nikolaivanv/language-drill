import {
  pgTable,
  text,
  timestamp,
  uuid,
  serial,
  unique,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { users } from './users';

/**
 * Per-user product-email consent. One row per user that has ever toggled a
 * preference; an absent row is treated as fully opted-out at the API layer.
 * Double opt-in: weeklySummary moves off → pending (confirm email sent) →
 * confirmed (link clicked). FK is ON DELETE CASCADE so account deletion
 * sweeps preferences (right-to-erasure).
 */
export const emailPreferences = pgTable('email_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  weeklySummary: text('weekly_summary')
    .$type<'off' | 'pending' | 'confirmed'>()
    .notNull()
    .default('off'),
  // Stable per-user token embedded in every email's unsubscribe link + the
  // List-Unsubscribe header. Never rotates.
  unsubscribeToken: uuid('unsubscribe_token').notNull().unique().defaultRandom(),
  // Set when weeklySummary='pending'; cleared on confirm.
  confirmToken: uuid('confirm_token'),
  confirmSentAt: timestamp('confirm_sent_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency ledger. The (user_id, kind, period_key) unique constraint is the
 * dedup backstop so a Lambda retry never double-sends the same weekly summary.
 * status: 'pending' = claimed but not yet sent; 'sent' = delivered to Resend;
 * 'skipped' = no activity that period, intentionally not sent.
 */
export const sentEmails = pgTable(
  'sent_emails',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'weekly_summary'
    periodKey: text('period_key').notNull(), // ISO week, e.g. '2026-W25'
    status: text('status')
      .$type<'pending' | 'sent' | 'skipped'>()
      .notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueSend: unique('uq_sent_emails_user_kind_period').on(
      table.userId,
      table.kind,
      table.periodKey,
    ),
  }),
);

export type EmailPreferences = InferSelectModel<typeof emailPreferences>;
export type NewEmailPreferences = InferInsertModel<typeof emailPreferences>;
export type SentEmail = InferSelectModel<typeof sentEmails>;
export type NewSentEmail = InferInsertModel<typeof sentEmails>;
