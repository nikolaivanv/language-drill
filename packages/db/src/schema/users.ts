import { pgTable, text, timestamp, uuid, unique, smallint, jsonb, boolean } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { DailyMinutes, GoalId, LearningLanguage } from '@language-drill/shared';

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

// Onboarding signals that don't belong on userLanguageProfiles. One row per
// user; absent rows are treated as "user hasn't completed onboarding" and
// served via documented defaults at the API layer (see Requirement 9.2).
// FK is ON DELETE CASCADE so account deletion sweeps preferences too.
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  primaryLanguage: text('primary_language').$type<LearningLanguage>().notNull(),
  goals: jsonb('goals').$type<GoalId[]>().notNull().default([]),
  dailyMinutes: smallint('daily_minutes').$type<DailyMinutes>().notNull(),
  gentleNudges: boolean('gentle_nudges').notNull().default(true),
  notes: text('notes').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserPreferences = InferSelectModel<typeof userPreferences>;
export type NewUserPreferences = InferInsertModel<typeof userPreferences>;
