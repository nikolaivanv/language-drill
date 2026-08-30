/**
 * Scoped approval evidence for the scheduler's expected-yield ranking.
 *
 * Evidence is deliberately NOT lifetime. A cell's historical approval rate
 * stops describing the cell the moment something changes what generation does
 * for it, and ranking on stale evidence would keep a just-repaired cell
 * demoted — burying the fix. #707 hit exactly this and gated its variant
 * give-up on the point fingerprint for the same reason.
 *
 * Two scopes, both exact and both free of a schema change:
 *
 *   1. **Per cell — the point fingerprint.** Rows are keyed by
 *      `(cell_key, grammar_point_fingerprint)`, so a directive or curriculum
 *      edit changes the key, the scheduler's lookup misses, and the cell
 *      reverts to its prior. This is the #706/#708 repair path.
 *   2. **Global — the prompt version cutoff.** `since` is derived from the
 *      in-repo `GENERATION_PROMPT_VERSION` / `VALIDATION_PROMPT_VERSION`
 *      date suffixes (see `promptEvidenceCutoff`). A prompt change is global,
 *      so it needs no per-cell tracking — one date discards every row that
 *      predates it.
 *
 * The reset needs no code path of its own: `shrunkApprovalRate` collapses to
 * the prior when evidence is absent, so a reset cell simply ranks on
 * `need × prior` — its old deficit rank.
 */

import { type Db } from '@language-drill/db';
import { sql } from 'drizzle-orm';

export type ApprovalEvidenceRow = { approved: number; produced: number };

/**
 * Map key pairing a cell with the point fingerprint the evidence was gathered
 * under. Evidence recorded under a different fingerprint is a different cell
 * as far as the ranking is concerned.
 */
export function evidenceKey(
  cellKey: string,
  fingerprint: string | null,
): string {
  return `${cellKey}|${fingerprint ?? ''}`;
}

/**
 * Per-(cell, fingerprint) approved/produced sums over succeeded jobs started
 * at or after `since`.
 *
 * Grouping by fingerprint rather than filtering on it keeps this a single
 * bounded query: the scheduler knows each cell's CURRENT fingerprint and looks
 * up that key directly, so the 774 fingerprints never have to reach SQL.
 */
export async function loadScopedApprovalEvidence(
  db: Db,
  since: Date,
): Promise<Map<string, ApprovalEvidenceRow>> {
  const result = await db.execute(sql`
    SELECT cell_key,
           grammar_point_fingerprint,
           SUM(approved_count) AS approved,
           SUM(produced_count) AS produced
    FROM generation_jobs
    WHERE status = 'succeeded'
      AND started_at >= ${since}
    GROUP BY cell_key, grammar_point_fingerprint
  `);

  type Row = {
    cell_key: string;
    grammar_point_fingerprint: string | null;
    approved: number | string | null;
    produced: number | string | null;
  };

  const map = new Map<string, ApprovalEvidenceRow>();
  for (const row of result.rows as unknown as Row[]) {
    map.set(evidenceKey(row.cell_key, row.grammar_point_fingerprint), {
      // pg returns SUM() as a string; without Number() the shrinkage would do
      // string arithmetic.
      approved: Number(row.approved ?? 0),
      produced: Number(row.produced ?? 0),
    });
  }
  return map;
}
