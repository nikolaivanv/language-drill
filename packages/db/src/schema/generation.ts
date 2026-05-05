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
    status: text('status').notNull(), // queued | running | succeeded | failed (TS-enforced)
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    inputTokensUsed: integer('input_tokens_used'),
    outputTokensUsed: integer('output_tokens_used'),
    costUsdEstimate: numeric('cost_usd_estimate', { precision: 10, scale: 4 }),
    trigger: text('trigger').notNull(), // cli | scheduled | admin (TS-enforced)
    errorMessage: text('error_message'),
  },
  (table) => ({
    cellIdx: index('generation_jobs_cell_idx').on(table.cellKey, table.startedAt.desc()),
  }),
);

export type GenerationJob = InferSelectModel<typeof generationJobs>;
export type NewGenerationJob = InferInsertModel<typeof generationJobs>;
