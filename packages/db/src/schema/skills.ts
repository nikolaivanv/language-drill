import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), // listening | reading | writing | speaking
  language: text('language').notNull(), // EN | ES | DE | TR
});

export const skillTopics = pgTable('skill_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  skillId: uuid('skill_id').references(() => skills.id),
  name: text('name').notNull(),
  cefrLevel: text('cefr_level'),
  language: text('language').notNull(),
});
