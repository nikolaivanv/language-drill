import {
  exercises as exercisesTable,
  userExerciseHistory,
  scoringEvidenceFilter,
} from '@language-drill/db';
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
 *   - routes/fluency.ts:   POST /fluency/attempts (exercise lookup)
 *   - routes/fluency.ts:   POST /fluency/session (raw-SQL eligibility query —
 *     adds the predicate inline rather than calling this helper)
 *   - routes/progress.ts:  GET /progress/points/:key (counts)
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
 * Drizzle predicate that excludes dictation rows with no synthesized audio yet
 * (`audio_s3_key IS NULL`). Non-dictation rows are unaffected. Generated
 * dictation text rows are approved before PR-2's audio-synth Lambda attaches
 * audio; this filter keeps those transient, unplayable rows out of every serve
 * path. Pass the `exercises` table reference; composes under `and(...)`
 * alongside `approvedStatusFilter` and the language/difficulty/type predicates.
 *
 * Note: `routes/sessions.ts`'s today-plan UNION-ALL pool draw inlines the
 * equivalent predicate as raw SQL rather than calling this helper.
 */
export function audioReadyFilter(table: typeof exercisesTable) {
  return sql`(${table.type} <> 'dictation' OR ${table.audioS3Key} IS NOT NULL)`;
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

/**
 * Re-exported from `@language-drill/db` so every serve-path and scoring
 * predicate is reachable from one module. Distinct from
 * `approvedStatusFilter`: that one decides what may be *served*, this one
 * decides what may be *scored*.
 *
 * Scoring call sites (must use `scoringEvidenceFilter`):
 *   - routes/progress.ts:  GET /progress/radar
 *   - routes/progress.ts:  GET /progress/curriculum errorRows
 *   - routes/insights.ts:  error observations + attempt counts
 *   - routes/insights.ts:  GET /insights/errors
 *   - routes/sessions.ts:  GET /sessions/:id/debrief skill movements
 *   - routes/sessions.ts:  GET /sessions/today errorRows
 *   - email/gather.ts:     weekly summary accuracy
 *   - lib/mastery/rank-context.ts: POST /sessions error counts — the twin of
 *     the GET /sessions/today errorRows query; without it the two disagreed
 *     and the same point could show `error-fix` on one screen but not the other
 *
 * Sites that intentionally do NOT filter:
 *   - routes/admin.ts (all)      — admin surfaces show raw truth
 *   - session debrief item lists — a record of what you did, not a score
 *   - routes/user-export.ts      — portability means the complete record
 *   - serve paths                — already gated by `approvedStatusFilter`
 *   - routes/sessions.ts:  POST /sessions/:id/complete countRows (sessions.ts:327-333)
 *     — explicit human ruling, not an oversight. `correct_count` is a record
 *     of that sitting: what the learner actually did that day, the same
 *     boundary already drawn for debrief item lists and activity counts.
 *     And because the value is persisted (`practice_sessions.correct_count`),
 *     filtering would only change *future* sessions' counts, making old and
 *     new session summaries mean different things — worse than the status
 *     quo, not better.
 */
export { scoringEvidenceFilter };
