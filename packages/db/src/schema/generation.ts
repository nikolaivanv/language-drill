import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const generationJobs = pgTable(
  'generation_jobs',
  {
    // Caller-supplied so the row id can match the SQS dedup id (Phase 4).
    // No `defaultRandom()` — writers must derive the id deterministically.
    id: uuid('id').primaryKey(),
    cellKey: text('cell_key').notNull(), // <lang>:<level>:<type>:<grammar_point_key>
    requestedCount: integer('requested_count').notNull(),
    producedCount: integer('produced_count').notNull().default(0),
    approvedCount: integer('approved_count').notNull().default(0),
    flaggedCount: integer('flagged_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    /**
     * Slots where all `MAX_DEDUP_RETRIES` regenerations hit the
     * `exercises_dedup_idx` UNIQUE index. Already included in `rejectedCount`
     * (per the `CellResult` contract that the CLI relies on for its breakdown
     * line); persisted separately so the admin approval-rate metric can
     * exclude search-space exhaustion from a quality denominator. Defaults to
     * 0 — historical rows written before this column existed report 0 and the
     * approval rate over those rows continues to look low for cells where
     * dedup dominated. New rows populate it from `CellResult.dedupGivenUpCount`.
     */
    dedupGivenUpCount: integer('dedup_given_up_count').notNull().default(0),
    status: text('status').notNull(), // queued | running | succeeded | failed (TS-enforced)
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    inputTokensUsed: integer('input_tokens_used'),
    outputTokensUsed: integer('output_tokens_used'),
    costUsdEstimate: numeric('cost_usd_estimate', { precision: 10, scale: 4 }),
    trigger: text('trigger').notNull(), // cli | scheduled | admin (TS-enforced)
    errorMessage: text('error_message'),
    /**
     * Curriculum-source version (e.g. `'2026-05-23'`) for the cell's language
     * at the time this job ran. The scheduler compares this to the on-disk
     * `CURRICULUM_VERSION_<LANG>` constant to decide whether suppression
     * should clear after a curriculum edit. NULL on legacy rows pre-migration.
     */
    curriculumVersion: text('curriculum_version'),
  },
  (table) => ({
    cellIdx: index('generation_jobs_cell_idx').on(table.cellKey, table.startedAt.desc()),
  }),
);

export type GenerationJob = InferSelectModel<typeof generationJobs>;
export type NewGenerationJob = InferInsertModel<typeof generationJobs>;
