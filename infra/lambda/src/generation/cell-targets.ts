/**
 * Per-cell generation target resolver (R3). The arithmetic itself moved to
 * `@language-drill/shared` (2026-08-11) so `packages/ai`'s `audit:collapse` CLI
 * can compute the same targets without depending on this package. This module
 * keeps the `Cell`-typed entry point the scheduler and admin route already call,
 * plus the coverage give-up constant.
 */

import { resolveCellTargetFor } from '@language-drill/shared';
import type { Cell } from '@language-drill/db';

export { CELL_TARGET_DEFAULTS } from '@language-drill/shared';

/**
 * Phase 1 coverage controller — a person bucket is **given up** (excluded from
 * the deficit) when its most recent targeted batch asked for it at least this
 * many times and produced zero approved drafts realizing it. Two honest attempts
 * before suppression; person buckets are small, so a single-attempt miss is too
 * noisy. Cleared by a CURRICULUM_VERSION bump. Design-tunable.
 */
export const GIVE_UP_MIN_ATTEMPTS = 2;

/** Resolve the generation target for a cell. Pure. See `resolveCellTargetFor`
 *  in `@language-drill/shared` for the full resolution-order contract. */
export function resolveCellTarget(cell: Cell): number {
  return resolveCellTargetFor(cell);
}
