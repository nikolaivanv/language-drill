import { type InferSelectModel, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { skillTopics } from './skills';

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type'), // cloze | translation | vocab_recall | listening | speaking | ...
    language: text('language'), // EN | ES | DE | TR
    difficulty: text('difficulty'), // cefrLevel: A1 | A2 | B1 | B2 | C1 | C2
    contentJson: jsonb('content_json'), // exercise body, options, expected answer shape
    audioS3Key: text('audio_s3_key'), // nullable
    createdAt: timestamp('created_at').defaultNow(),
    // ---- Phase 1 (exercise-generation) — generation metadata ----
    grammarPointKey: text('grammar_point_key'),
    topicDomain: text('topic_domain'),
    generationSource: text('generation_source').notNull().default('manual'),
    modelId: text('model_id'),
    qualityScore: real('quality_score'),
    reviewStatus: text('review_status').notNull().default('auto-approved'),
    flaggedReasons: jsonb('flagged_reasons'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
  },
  (table) => ({
    poolLookupIdx: index('exercises_pool_lookup_idx')
      .on(table.language, table.difficulty, table.type, table.grammarPointKey)
      .where(sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved')`),
  }),
);

export type Exercise = InferSelectModel<typeof exercises>;

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
