/**
 * Maps the scheduler's `EnqueueDecision` (the policy that decides whether a
 * cell is enqueued on the next tick) to a stable status string for the admin
 * pool dashboard. Pure — no DB, no env. The dashboard surfaces the exact
 * decision the scheduler will make, rather than a re-derived heuristic.
 */

import type { EnqueueDecision, RecentJob } from './scheduler-decision';

export type CellStatus =
  | 'active'
  | 'target-reached'
  | 'low-yield'
  | 'saturated-dedup'
  | 'never-run'
  | 'out-of-scope';

/**
 * @param decision  The `decideEnqueue` result for the cell.
 * @param recentJob The most recent succeeded job for the cell (or null). Only
 *                  distinguishes `enqueue` → `active` (has run before) from
 *                  `never-run`; the skip branches carry their own meaning.
 */
export function cellStatusFromDecision(
  decision: EnqueueDecision,
  recentJob: RecentJob | null,
): CellStatus {
  switch (decision.kind) {
    case 'enqueue':
      return recentJob === null ? 'never-run' : 'active';
    case 'skip-target-reached':
      return 'target-reached';
    case 'skip-low-yield':
      return 'low-yield';
    case 'skip-saturated-dedup':
      return 'saturated-dedup';
    case 'skip-c2':
      return 'out-of-scope';
  }
}
