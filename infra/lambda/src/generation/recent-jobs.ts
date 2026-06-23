/**
 * Shared loader for the most recent succeeded `generation_jobs` row per cell.
 * Used by the scheduler (to feed `decideEnqueue`) and by the admin pool-status
 * endpoint (to surface each cell's scheduler decision + last-run evidence), so
 * the `RecentJob` query lives in exactly one place.
 */

import { type Db } from '@language-drill/db';
import { type CoverageOutcome } from '@language-drill/shared';
import { sql } from 'drizzle-orm';

import { type RecentJob } from './scheduler-decision';

/**
 * Read the most recent succeeded `generation_jobs` row for each `cell_key`.
 *
 * `DISTINCT ON` collapses retries (same cell, multiple succeeded jobs across
 * days) to the one with the latest `started_at`. The `generation_jobs_cell_idx`
 * index `(cell_key, started_at desc)` makes this a single bounded scan even
 * with thousands of historical rows.
 *
 * Returned map is keyed by `cell_key`; cells with no succeeded job are
 * absent (the caller treats `undefined` lookups as `null`).
 */
export async function loadMostRecentSucceededJobPerCell(
  db: Db,
): Promise<Map<string, RecentJob>> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (cell_key)
           cell_key, approved_count, requested_count, dedup_given_up_count,
           curriculum_version, coverage_outcome, finished_at
    FROM generation_jobs
    WHERE status = 'succeeded'
    ORDER BY cell_key, started_at DESC
  `);

  type Row = {
    cell_key: string;
    approved_count: number;
    requested_count: number;
    dedup_given_up_count: number;
    curriculum_version: string | null;
    coverage_outcome: CoverageOutcome | null;
    finished_at: Date | string;
  };

  const rows = result.rows as unknown as Row[];
  const map = new Map<string, RecentJob>();
  for (const row of rows) {
    map.set(row.cell_key, {
      approvedCount: row.approved_count,
      requestedCount: row.requested_count,
      dedupGivenUpCount: row.dedup_given_up_count,
      curriculumVersion: row.curriculum_version,
      coverageOutcome: row.coverage_outcome,
      finishedAt:
        row.finished_at instanceof Date
          ? row.finished_at
          : new Date(row.finished_at),
    });
  }
  return map;
}
