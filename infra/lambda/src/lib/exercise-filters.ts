import { exercises } from '@language-drill/db';
import { inArray } from 'drizzle-orm';

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
export function approvedStatusFilter(table: typeof exercises) {
  return inArray(table.reviewStatus, APPROVED_STATUSES);
}
