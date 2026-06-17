import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Append-only trail of mutating admin actions. No FK on adminUserId: admins may be
// env-listed IDs without a users row, and the trail must survive user deletion.
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: text('admin_user_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('admin_audit_log_created_at_idx').on(table.createdAt),
  }),
);
