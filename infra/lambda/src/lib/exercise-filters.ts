import { exercises as exercisesTable, userExerciseHistory } from '@language-drill/db';
import { inArray, sql } from 'drizzle-orm';

/**
 * Review statuses that are eligible to be served via pool-discovery and
 * direct-fetch endpoints. Flagged and rejected exercises are excluded.
 *
 * Filtered call sites (use `approvedStatusFilter`):
 *   - routes/exercises.ts: GET /exercises (random pool draw)
 *   - routes/exercises.ts: GET /exercises/:id (direct fetch)
 *   - routes/exercises.ts: POST /exercises/:id/submit (exercise lookup)
 *   - routes/sessions.ts:  POST /sessions (pool sample)
 *   - routes/sessions.ts:  GET /sessions/today Path B (raw-SQL UNION-ALL —
 *     adds the predicate inline rather than calling this helper)
 *
 * Sites that intentionally do NOT filter:
 *   - routes/sessions.ts:  GET /sessions/today Path A (manifest hydration)
 *   - routes/sessions.ts:  GET /sessions/:id/debrief (manifest hydration)
 *   - packages/db/scripts/seed-exercises.ts (writes use the column default)
 */
export const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

/**
 * Drizzle predicate that constrains an `exercises` query to approved rows.
 * Pass the `exercises` table reference; intended to compose under `and(...)`
 * alongside language/difficulty/type predicates.
 */
export function approvedStatusFilter(table: typeof exercisesTable) {
  return inArray(table.reviewStatus, APPROVED_STATUSES);
}

/**
 * ORDER BY fragment implementing per-user exposure control for a pool draw over
 * the `exercises` table. Never-attempted exercises sort first (NULLS FIRST);
 * among attempted ones the least-recently-seen come first; `random()` breaks
 * ties within a group. Correlated on `exercises.id`, so it only works on a query
 * whose FROM is the `exercises` table. Uses
 * `user_exercise_history_exercise_id_idx (exercise_id, evaluated_at)` for the
 * per-exercise scan; user_id is filtered post-scan (not covered).
 */
export function freshFirstOrderBy(userId: string) {
  return sql`(
    select max(${userExerciseHistory.evaluatedAt})
    from ${userExerciseHistory}
    where ${userExerciseHistory.exerciseId} = ${exercisesTable.id}
      and ${userExerciseHistory.userId} = ${userId}
  ) asc nulls first, random()`;
}
