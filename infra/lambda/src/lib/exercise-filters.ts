import {
  ALL_CURRICULA,
  exercises as exercisesTable,
  userExerciseHistory,
  scoringEvidenceFilter,
} from '@language-drill/db';
import { inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

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
 * Every grammar-point key in the shipped curriculum. Read lazily, not at module
 * scope: route tests mock `@language-drill/db` and most mocks do not define
 * `ALL_CURRICULA`, so touching it at import time would break every one of them.
 */
function curriculumKeys(): string[] {
  return ALL_CURRICULA.map((p) => p.key);
}

/**
 * Pool-discovery predicate: keep rows whose `grammar_point_key` is NULL
 * (untagged seed rows) or names a point that still exists in the curriculum.
 *
 * Why: removing a point from the curriculum does not touch its exercises. Their
 * dead key does not stop them being served, because the pool draws filter only
 * on language/level/type/status. `tr-a1-everyday-vocab` / `tr-a2-everyday-vocab`
 * were removed on 2026-06-07 and kept serving 37 approved rows in daily plans
 * until a manual cleanup on 2026-11-15
 * (docs/analysis/vocab-offlist-2026-11-15/README.md). With this predicate,
 * removing a point retires its exercises from every pool at once.
 *
 * Applied at pool-discovery sites only (the random draws, sampled into a
 * session or plan). Fetch-by-id surfaces (GET /exercises/:id, submit, manifest
 * hydration) intentionally do NOT apply it, so an exercise already in a learner's
 * session stays playable and submittable.
 *
 * Filtered call sites (Drizzle form, `inCurriculumFilter`):
 *   - routes/exercises.ts: GET /exercises, GET /exercises/conjugation-set
 *   - routes/sessions.ts:  POST /sessions (targeted, single-type and top-up pulls)
 *   - routes/public.ts:    GET /public/conjugation/set
 * Raw-SQL call sites (`inCurriculumSql`):
 *   - routes/sessions.ts:  sampleFreshPool (daily plan / untargeted POST /sessions)
 *   - routes/fluency.ts:   POST /fluency/session eligibility
 */
export function inCurriculumFilter(table: typeof exercisesTable): SQL {
  const keys = curriculumKeys();
  // An empty list would turn `inArray` into FALSE and empty every pool; the
  // curriculum is never empty in production, so fail open rather than closed.
  if (keys.length === 0) return sql`TRUE`;
  return or(isNull(table.grammarPointKey), inArray(table.grammarPointKey, keys)) as SQL;
}

/**
 * Raw-SQL twin of `inCurriculumFilter`, for queries written with `sql`...``
 * rather than the query builder. `column` is a trusted, hard-coded column
 * reference (`grammar_point_key`, `e.grammar_point_key`), never user input.
 * Keys are bound one parameter each (the `IN (...)` form already used for CEFR
 * levels in sampleFreshPool), not a bound array passed to `ANY(...)`, which
 * typechecks and passes mocked tests but breaks against real Postgres.
 */
export function inCurriculumSql(column: string): SQL {
  const keys = curriculumKeys();
  if (keys.length === 0) return sql`TRUE`;
  const col = sql.raw(column);
  return sql`(${col} IS NULL OR ${col} IN (${sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  )}))`;
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
