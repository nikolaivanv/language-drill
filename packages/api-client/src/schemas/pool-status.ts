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
  targetSize: z.number(),
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
      rejectedCount: z.number(),
      approvalRate: z.number(),
    }),
  ),
});

export type GenerationStats = z.infer<typeof GenerationStatsSchema>;
