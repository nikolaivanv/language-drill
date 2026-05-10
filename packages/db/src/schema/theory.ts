import {
  type InferInsertModel,
  type InferSelectModel,
  sql,
} from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { TheoryTopicJson } from '@language-drill/shared';

/**
 * Storage for generated theory pages. One approved row per cell — enforced by
 * the partial unique index `theory_topics_pool_lookup_idx` filtered to
 * `review_status IN ('auto-approved', 'manual-approved')`. The panel-facing
 * read index (`theory_topics_panel_idx`) carries the same filter.
 *
 * The `id` column is caller-supplied (no `defaultRandom()`): Phase 2 derives
 * it deterministically via `deterministicUuid` so the same cell yields the
 * same UUID across reruns. The `content_json` column is typed against
 * `TheoryTopicJson` so Drizzle's inference produces typed reads/writes.
 */
export const theoryTopics = pgTable(
  'theory_topics',
  {
    id: uuid('id').primaryKey(),
    language: text('language').notNull(),
    grammarPointKey: text('grammar_point_key').notNull(),
    topicId: text('topic_id').notNull(),
    cefrLevel: text('cefr_level').notNull(),
    contentJson: jsonb('content_json').$type<TheoryTopicJson>().notNull(),
    generationSource: text('generation_source').notNull().default('manual'),
    modelId: text('model_id'),
    qualityScore: real('quality_score'),
    reviewStatus: text('review_status').notNull().default('auto-approved'),
    flaggedReasons: jsonb('flagged_reasons'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    poolLookupIdx: uniqueIndex('theory_topics_pool_lookup_idx')
      .on(table.language, table.grammarPointKey)
      .where(
        sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved')`,
      ),
    panelIdx: index('theory_topics_panel_idx')
      .on(table.language, table.topicId)
      .where(
        sql`${table.reviewStatus} IN ('auto-approved', 'manual-approved')`,
      ),
    languageCheck: check(
      'theory_topics_language_check',
      sql`${table.language} IN ('ES', 'DE', 'TR')`,
    ),
    cefrCheck: check(
      'theory_topics_cefr_check',
      sql`${table.cefrLevel} IN ('A1', 'A2', 'B1', 'B2')`,
    ),
    generationSourceCheck: check(
      'theory_topics_generation_source_check',
      sql`${table.generationSource} IN ('manual', 'claude-realtime', 'claude-batch')`,
    ),
    reviewStatusCheck: check(
      'theory_topics_review_status_check',
      sql`${table.reviewStatus} IN ('auto-approved', 'flagged', 'rejected', 'manual-approved')`,
    ),
  }),
);

/**
 * DB-row type for the `theory_topics` table. NOTE: this is the database row
 * shape — NOT the runtime React-bearing `TheoryTopic` in
 * `apps/web/components/theory/types.ts`. That panel type carries
 * `React.ReactNode` bodies; this row's `contentJson` carries the
 * JSON-serializable `TheoryTopicJson` (from `@language-drill/shared`).
 */
export type TheoryTopic = InferSelectModel<typeof theoryTopics>;
export type NewTheoryTopic = InferInsertModel<typeof theoryTopics>;

/**
 * Per-cell audit trail for theory generation. Mirror of `generation_jobs`
 * with two structural differences: (1) no `requested_count` — theory
 * cardinality is exactly 1 page per cell; (2) the four integer count
 * columns (`producedCount` / `approvedCount` / `flaggedCount` /
 * `rejectedCount`) collapse to three booleans (`approved` / `flagged` /
 * `rejected`).
 */
export const theoryGenerationJobs = pgTable(
  'theory_generation_jobs',
  {
    id: uuid('id').primaryKey(),
    cellKey: text('cell_key').notNull(),
    status: text('status').notNull(),
    trigger: text('trigger').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    inputTokensUsed: integer('input_tokens_used'),
    outputTokensUsed: integer('output_tokens_used'),
    costUsdEstimate: numeric('cost_usd_estimate', { precision: 10, scale: 4 }),
    approved: boolean('approved'),
    flagged: boolean('flagged'),
    rejected: boolean('rejected'),
    errorMessage: text('error_message'),
  },
  (table) => ({
    cellIdx: index('theory_generation_jobs_cell_idx').on(
      table.cellKey,
      table.startedAt.desc(),
    ),
    statusCheck: check(
      'theory_generation_jobs_status_check',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed')`,
    ),
    triggerCheck: check(
      'theory_generation_jobs_trigger_check',
      sql`${table.trigger} IN ('cli', 'scheduled', 'admin')`,
    ),
  }),
);

export type TheoryGenerationJob = InferSelectModel<typeof theoryGenerationJobs>;
export type NewTheoryGenerationJob = InferInsertModel<typeof theoryGenerationJobs>;
