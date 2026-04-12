import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { skillTopics } from './skills';

export const exercises = pgTable('exercises', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type'), // cloze | translation | vocab_recall | listening | speaking | ...
  language: text('language'), // EN | ES | DE | TR
  difficulty: text('difficulty'), // cefrLevel: A1 | A2 | B1 | B2 | C1 | C2
  contentJson: jsonb('content_json'), // exercise body, options, expected answer shape
  audioS3Key: text('audio_s3_key'), // nullable
  createdAt: timestamp('created_at').defaultNow(),
});

export const exerciseTags = pgTable(
  'exercise_tags',
  {
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    skillTopicId: uuid('skill_topic_id').references(() => skillTopics.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.exerciseId, table.skillTopicId] }),
  }),
);
