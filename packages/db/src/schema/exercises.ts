import type { CoverageTags, GenerationReason } from '@language-drill/shared';
import { type InferSelectModel, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { skillTopics } from './skills';

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type'), // cloze | translation | vocab_recall | listening | speaking | ...
    language: text('language'), // EN | ES | DE | TR
    difficulty: text('difficulty'), // cefrLevel: A1 | A2 | B1 | B2 | C1 | C2
    // The JSONB blob carries the discriminated-union ExerciseContent shape from
    // @language-drill/shared, plus a writer-only `_dedupKey: string` field added
    // at insert time (Phase 3) and read by the partial UNIQUE index below via
    // (content_json->>'_dedupKey'). Type guards in @language-drill/shared
    // discriminate on `type` and ignore unrelated fields, so the writer
    // metadata is invisible to runtime consumers.
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
    flaggedReasons: jsonb('flagged_reasons').$type<GenerationReason[]>(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    // Realized coverage values per axis (person/wordClass/polarity/sentenceType)
    // for pool-diversity monitoring (Pool Coverage Controller, Phase 0). Written
    // by the generation insert path from the validator's `coverage` result and
    // by the `backfill:coverage-tags` CLI for legacy rows. Aggregated generically
    // by GET /admin/pool-status via LATERAL jsonb_each_text.
    coverageTags: jsonb('coverage_tags').$type<CoverageTags | null>(),
  },
  (table) => ({
    poolLookupIdx: index('exercises_pool_lookup_idx')
      .on(table.language, table.difficulty, table.type, table.grammarPointKey)
      .where(sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved')`),
    // Phase 3 — across-batch surface dedup. The `flagged` review_status is
    // included so a flagged duplicate of an already-approved row is blocked
    // at insert time (review CLI's tryApprove path catches the conflict and
    // demotes via the same constraint). `content_json ? '_dedupKey'` excludes
    // the 36 hand-authored seed rows (no _dedupKey) from the uniqueness check.
    dedupIdx: uniqueIndex('exercises_dedup_idx')
      .on(
        table.language,
        table.type,
        table.difficulty,
        table.grammarPointKey,
        sql`(content_json->>'_dedupKey')`,
      )
      .where(
        sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved', 'flagged') AND content_json ? '_dedupKey'`,
      ),
    // Supports the vocab_recall per-word count cap (≤ N exercises per
    // `expectedWord` per cell). The `validateAndInsertWithRetry` path counts
    // existing approved/flagged rows for (cell, expectedWord) before INSERT;
    // this partial index keeps that count cheap. Column order mirrors
    // `exercises_dedup_idx` (language, type, difficulty, grammarPointKey, expr).
    vocabWordIdx: index('exercises_vocab_word_idx')
      .on(
        table.language,
        table.type,
        table.difficulty,
        table.grammarPointKey,
        sql`(content_json->>'expectedWord')`,
      )
      .where(
        sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved', 'flagged')`,
      ),
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
