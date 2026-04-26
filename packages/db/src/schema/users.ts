import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

export const userLanguageProfiles = pgTable('user_language_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id).notNull(),
  language: text('language').notNull(),
  proficiencyLevel: text('proficiency_level').notNull(),
  assessedAt: timestamp('assessed_at'),
}, (table) => ({
  uniqueUserLanguage: unique('uq_user_language').on(table.userId, table.language),
}));
