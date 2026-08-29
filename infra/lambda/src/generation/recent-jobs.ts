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
 * A `row_number()` window collapses retries (same cell, multiple succeeded
 * jobs across days) to the one with the latest `started_at`, and in the same
 * pass derives each cell's trailing zero-approval streak. The
 * `generation_jobs_cell_idx` index `(cell_key, started_at desc)` supplies the
 * ordering.
 *
 * Returned map is keyed by `cell_key`; cells with no succeeded job are
 * absent (the caller treats `undefined` lookups as `null`).
 */
export async function loadMostRecentSucceededJobPerCell(
  db: Db,
): Promise<Map<string, RecentJob>> {
  // `consecutive_zero_approved_runs` = how many succeeded runs this cell has
  // ended with `approved_count = 0`, counting back from the latest. Computed
  // as (rank of the most recent nonzero run - 1), falling back to the cell's
  // total run count when it has NEVER approved anything. `decideEnqueue` uses
  // it to tell a stuck coverage tail from a converging one.
  //
  // This replaces the old `DISTINCT ON` with a window pass over the same
  // rows. `generation_jobs` holds ~4k succeeded rows across ~774 cells, so
  // the extra sort is immaterial, and it keeps the whole thing one round trip.
  const result = await db.execute(sql`
    WITH j AS (
      SELECT cell_key, approved_count, requested_count, dedup_given_up_count,
             curriculum_version, grammar_point_fingerprint, coverage_outcome,
             finished_at,
             row_number() OVER (PARTITION BY cell_key ORDER BY started_at DESC) AS rn
      FROM generation_jobs
      WHERE status = 'succeeded'
    ),
    first_nonzero AS (
      SELECT cell_key, min(rn) AS rn FROM j WHERE approved_count > 0 GROUP BY cell_key
    ),
    totals AS (
      SELECT cell_key, count(*) AS n FROM j GROUP BY cell_key
    )
    SELECT j.cell_key, j.approved_count, j.requested_count, j.dedup_given_up_count,
           j.curriculum_version, j.grammar_point_fingerprint, j.coverage_outcome,
           j.finished_at,
           COALESCE(fz.rn - 1, t.n) AS consecutive_zero_approved_runs
    FROM j
    LEFT JOIN first_nonzero fz ON fz.cell_key = j.cell_key
    JOIN totals t ON t.cell_key = j.cell_key
    WHERE j.rn = 1
  `);

  type Row = {
    cell_key: string;
    approved_count: number;
    requested_count: number;
    dedup_given_up_count: number;
    curriculum_version: string | null;
    grammar_point_fingerprint: string | null;
    coverage_outcome: CoverageOutcome | null;
    finished_at: Date | string;
    consecutive_zero_approved_runs: number | string | null;
  };

  const rows = result.rows as unknown as Row[];
  const map = new Map<string, RecentJob>();
  for (const row of rows) {
    map.set(row.cell_key, {
      approvedCount: row.approved_count,
      requestedCount: row.requested_count,
      dedupGivenUpCount: row.dedup_given_up_count,
      curriculumVersion: row.curriculum_version,
      // `?? null` so a row from before the column existed — or any caller
      // that omits it — takes the legacy fallback path in `decideEnqueue`
      // rather than reading as "a fingerprint that differs from everything".
      grammarPointFingerprint: row.grammar_point_fingerprint ?? null,
      coverageOutcome: row.coverage_outcome,
      finishedAt:
        row.finished_at instanceof Date
          ? row.finished_at
          : new Date(row.finished_at),
      // pg returns COUNT/arithmetic as a string via node-postgres; Number()
      // it here so `decideEnqueue`'s `<` comparison is numeric and not a
      // string compare that would make '10' < 3 read as true.
      consecutiveZeroApprovedRuns: Number(row.consecutive_zero_approved_runs ?? 0),
    });
  }
  return map;
}
