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
  /**
   * Per-axis distribution of the cell's APPROVED exercises, e.g.
   * `{ person: { "3sg": 12, "2pl": 2 }, polarity: { affirmative: 13 } }`.
   * `null` when the cell has no tagged approved rows. Axes appear only when
   * present in the pool (Pool Coverage Controller, Phase 0).
   */
  coverageDistribution: z
    .record(z.string(), z.record(z.string(), z.number()))
    .nullable(),
  /**
   * The scheduler decision this cell would receive on its next tick, mirrored
   * from the server's `decideEnqueue` (single source of truth):
   * - `active` — will generate (under target, last run productive).
   * - `target-reached` — approved ≥ target; nothing to do.
   * - `low-yield` — suppressed: last run produced < 3 net-new approvals.
   * - `saturated-dedup` — suppressed: last run was dedup-heavy.
   * - `never-run` — no succeeded job yet.
   * - `out-of-scope` — level outside the Round-1 CEFR set (defensive; not
   *   reachable for A1–B2).
   * Suppression (`low-yield` / `saturated-dedup`) clears on a curriculum bump.
   */
  status: z.enum([
    'active',
    'target-reached',
    'low-yield',
    'saturated-dedup',
    'never-run',
    'out-of-scope',
  ]),
  /**
   * Metrics from the most recent succeeded generation job — the evidence
   * behind `status`. `null` when the cell has never run. `curriculumVersion`
   * is null on legacy rows written before the column existed.
   */
  lastJob: z
    .object({
      approvedCount: z.number(),
      requestedCount: z.number(),
      dedupGivenUpCount: z.number(),
      curriculumVersion: z.string().nullable(),
    })
    .nullable(),
});

export type PoolStatusItem = z.infer<typeof PoolStatusItemSchema>;
export type PoolCellStatus = PoolStatusItem['status'];

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
