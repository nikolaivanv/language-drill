import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /admin/pool-status response item
// ---------------------------------------------------------------------------

export const PoolStatusItemSchema = z.object({
  language: z.string(),
  level: z.string(),
  type: z.string(),
  grammarPointKey: z.string(),
  approved: z.number(),
  flagged: z.number(),
  rejected: z.number(),
  lastRefilledAt: z.string().nullable(),
  depletionRate7d: z.number(),
  /** Demand-derived ideal pool size (depletion tiers; floors at 50 when idle). */
  targetSize: z.number(),
  /**
   * The per-cell generation target the scheduler actually fills toward
   * (`resolveCellTarget`, R3) — e.g. 20 for an A1 cloze cell. Distinct from
   * `targetSize`: coverage % is measured against this, and a value below
   * `targetSize` signals a cell whose target may warrant raising.
   */
  generationTarget: z.number(),
});

export type PoolStatusItem = z.infer<typeof PoolStatusItemSchema>;

// ---------------------------------------------------------------------------
// GET /admin/generation-stats response
// ---------------------------------------------------------------------------

export const GenerationStatsSchema = z.object({
  costThisWeekUsd: z.number(),
  costThisMonthUsd: z.number(),
  jobsThisWeek: z.object({
    succeeded: z.number(),
    failed: z.number(),
    running: z.number(),
    queued: z.number(),
  }),
  approvalRates: z.array(
    z.object({
      language: z.string(),
      level: z.string(),
      type: z.string(),
      approvedCount: z.number(),
      flaggedCount: z.number(),
      /**
       * Includes dedup-given-up per the runOneCell contract. To get the
       * validator-only rejected count: `rejectedCount - dedupGivenUpCount`
       * (clamped at 0). The `approvalRate` field already does this subtraction.
       */
      rejectedCount: z.number(),
      /**
       * Slots where Claude exhausted retries against `exercises_dedup_idx`.
       * Already counted inside `rejectedCount`; surfaced separately so
       * operators can distinguish "validator said no" from "search space
       * exhausted" without needing to dig into CloudWatch.
       */
      dedupGivenUpCount: z.number(),
      approvalRate: z.number(),
    }),
  ),
});

export type GenerationStats = z.infer<typeof GenerationStatsSchema>;
