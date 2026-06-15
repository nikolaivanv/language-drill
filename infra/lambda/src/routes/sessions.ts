import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, isNull, isNotNull, gte, desc, inArray } from 'drizzle-orm';
import { Language, CefrLevel, CORRECT_THRESHOLD, ExerciseType } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  userLanguageProfiles,
  userGrammarMastery,
  getGrammarPoint,
} from '@language-drill/db';
import { rankPlanCandidates, type PointMastery } from '../lib/mastery/rank';
import { db } from '../db';
import { approvedStatusFilter, freshFirstOrderBy } from '../lib/exercise-filters';
import { presignAudioUrl } from '../lib/audio-url';
import { withAudioUrl } from '../lib/dictation-content';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  V1_PLAN_SHAPE,
  composeFreshPlan,
  hydrateFromSession,
  startOfUtcDay,
  type PlanItem,
  type PoolDraw,
} from '../lib/today-plan';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. Mirrors the comment block in
// `routes/profiles.ts` and `routes/progress.ts`.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const TodayQuerySchema = z.object({
  language: LearningLanguageEnum,
});

const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;

/** Request body for POST /sessions (mirrors api-client CreateSessionRequest) */
export const CreateSessionRequestSchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  exerciseCount: z.number().int().min(1).max(20),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const sessions = new Hono<{ Bindings: Bindings; Variables: Variables }>();

sessions.use('/sessions/*', authMiddleware);

// ---------------------------------------------------------------------------
// POST /sessions — create a new practice session, return its manifest
// ---------------------------------------------------------------------------
sessions.post('/sessions', async (c) => {
  const bodyResult = CreateSessionRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );

  if (!bodyResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.flatten(),
      },
      400,
    );
  }

  const { language, difficulty, exerciseCount } = bodyResult.data;
  const userId = c.get('userId');

  // Pull a manifest of N exercises for this (language, difficulty), ordered so
  // never-attempted exercises come first (exposure control); falls through to
  // INSUFFICIENT_EXERCISES if the pool is too small.
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(
      and(
        eq(exercisesTable.language, language),
        eq(exercisesTable.difficulty, difficulty),
        approvedStatusFilter(exercisesTable),
      ),
    )
    .orderBy(freshFirstOrderBy(userId))
    .limit(exerciseCount);

  if (rows.length < exerciseCount) {
    return c.json(
      {
        error: 'Not enough exercises in the pool for this filter',
        code: 'INSUFFICIENT_EXERCISES',
        details: { available: rows.length, requested: exerciseCount },
      },
      422,
    );
  }

  // Insert the session row with the chosen exercise IDs
  const inserted = await db
    .insert(practiceSessions)
    .values({
      userId,
      language,
      difficulty,
      exerciseCount,
      exerciseIds: rows.map((r) => r.id),
    })
    .returning({ id: practiceSessions.id });

  const exercisesOut = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      type: r.type,
      language: r.language,
      difficulty: r.difficulty,
      grammarPointKey: r.grammarPointKey,
      contentJson: withAudioUrl(r.contentJson, await presignAudioUrl(r.audioS3Key)),
    })),
  );

  return c.json({ id: inserted[0].id, exercises: exercisesOut });
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/complete — finalize a session, return summary stats
// ---------------------------------------------------------------------------
sessions.post('/sessions/:id/complete', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  // 1. Compute correct + attempted counts in ONE query.
  //    Postgres `count(...)` returns string-bigint via the driver, hence Number(...) coercion.
  const countRows = await db
    .select({
      correct: sql<number>`count(distinct ${userExerciseHistory.exerciseId}) filter (where ${userExerciseHistory.score} >= ${CORRECT_THRESHOLD})`,
      attempted: sql<number>`count(distinct ${userExerciseHistory.exerciseId})`,
    })
    .from(userExerciseHistory)
    .where(eq(userExerciseHistory.sessionId, id));

  const correctCount = Number(countRows[0]?.correct ?? 0);
  const attemptedCount = Number(countRows[0]?.attempted ?? 0);

  // 2. Atomic UPDATE — race-safe via WHERE completed_at IS NULL.
  //    A concurrent re-completion sees a non-null completed_at and the UPDATE matches 0 rows.
  //    Cross-user attempts also fail here because user_id is part of the predicate.
  const updated = await db
    .update(practiceSessions)
    .set({ completedAt: new Date(), correctCount })
    .where(
      and(
        eq(practiceSessions.id, id),
        eq(practiceSessions.userId, userId),
        isNull(practiceSessions.completedAt),
      ),
    )
    .returning({
      id: practiceSessions.id,
      startedAt: practiceSessions.startedAt,
      exerciseCount: practiceSessions.exerciseCount,
    });

  if (updated.length === 0) {
    return c.json({ error: 'Invalid session', code: 'INVALID_SESSION' }, 400);
  }

  const { startedAt, exerciseCount } = updated[0];
  const durationSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt as Date).getTime()) / 1000),
  );
  const skippedCount = exerciseCount - attemptedCount;

  return c.json({
    id: updated[0].id,
    exerciseCount,
    correctCount,
    attemptedCount,
    skippedCount,
    durationSeconds,
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/today — read-only preview of today's plan for the dashboard
// ---------------------------------------------------------------------------
// Two paths:
//   - Path A (hydrate): a practice_sessions row exists for (userId, language)
//     started today (UTC) → return its items with `done`/`queued` statuses,
//     populating `summary` when every kept item is done AND completedAt is set.
//   - Path B (fresh):    no today-session → draw 5 exercises from the pool
//     using V1_PLAN_SHAPE and return them as queued.
//
// Performance budget: ≤ 2 SQL round-trips. Query 1 (today-session lookup) and
// the proficiency-level fetch are dispatched in parallel via Promise.all so
// they share one wall-clock RTT; Path B's pool sample is the second RTT.
// ---------------------------------------------------------------------------
sessions.get('/sessions/today', async (c) => {
  const queryResult = TodayQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.flatten(),
      },
      400,
    );
  }

  const { language } = queryResult.data;
  const userId = c.get('userId');
  const dayStart = startOfUtcDay(new Date());

  // -------------------------------------------------------------------------
  // Query 1 (parallel): today's session + proficiency level
  // -------------------------------------------------------------------------
  const [todayRows, profileRows] = await Promise.all([
    db
      .select({
        sessionId: practiceSessions.id,
        exerciseIds: practiceSessions.exerciseIds,
        exerciseCount: practiceSessions.exerciseCount,
        correctCount: practiceSessions.correctCount,
        startedAt: practiceSessions.startedAt,
        completedAt: practiceSessions.completedAt,
      })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          eq(practiceSessions.language, language),
          gte(practiceSessions.startedAt, dayStart),
        ),
      )
      .orderBy(desc(practiceSessions.startedAt))
      .limit(1),
    db
      .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
      .from(userLanguageProfiles)
      .where(
        and(
          eq(userLanguageProfiles.userId, userId),
          eq(userLanguageProfiles.language, language),
        ),
      )
      .limit(1),
  ]);

  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;

  // -------------------------------------------------------------------------
  // Path A — hydrate from today's session
  // -------------------------------------------------------------------------
  if (todayRows.length > 0) {
    const session = todayRows[0];
    const exerciseIds = session.exerciseIds ?? [];

    // Single round trip: project the exercise rows joined LEFT to history
    // filtered by sessionId. historyId IS NOT NULL ⇒ user attempted it.
    //
    // Deliberate non-filter on review_status: this read hydrates exercises by
    // stored manifest IDs. A flagged exercise that was already in a session
    // manifest stays in that session; filtering would create a phantom missing
    // slot for the user. See lib/exercise-filters.ts for the inventory of
    // filtered vs. non-filtered call sites.
    const itemRows = await db
      .select({
        exerciseId: exercisesTable.id,
        type: exercisesTable.type,
        topicHint: sql<string | null>`${exercisesTable.contentJson}->>'topicHint'`,
        difficulty: exercisesTable.difficulty,
        historyId: userExerciseHistory.id,
      })
      .from(exercisesTable)
      .leftJoin(
        userExerciseHistory,
        and(
          eq(userExerciseHistory.exerciseId, exercisesTable.id),
          eq(userExerciseHistory.sessionId, session.sessionId),
        ),
      )
      .where(inArray(exercisesTable.id, exerciseIds));

    const exercisesMap = new Map<
      string,
      { type: ExerciseType; topicHint: string | null; difficulty: CefrLevel }
    >();
    const attemptedIds = new Set<string>();
    for (const row of itemRows) {
      if (!row.type || !isExerciseType(row.type)) continue;
      if (!row.difficulty || !isCefrLevel(row.difficulty)) continue;
      exercisesMap.set(row.exerciseId, {
        type: row.type,
        topicHint: row.topicHint,
        difficulty: row.difficulty,
      });
      if (row.historyId !== null) attemptedIds.add(row.exerciseId);
    }

    const { items, summary } = hydrateFromSession({
      session: {
        id: session.sessionId,
        exerciseIds,
        exerciseCount: session.exerciseCount,
        correctCount: session.correctCount,
        startedAt: new Date(session.startedAt as Date),
        completedAt: session.completedAt
          ? new Date(session.completedAt as Date)
          : null,
      },
      exercises: exercisesMap,
      attemptedIds,
    });

    return c.json({
      language,
      generatedAt: new Date().toISOString(),
      totalEstimatedMinutes: items.reduce(
        (sum, it) => sum + it.estimatedMinutes,
        0,
      ),
      items: items.map(toWireItem),
      summary,
      code: null,
    });
  }

  // -------------------------------------------------------------------------
  // Path B — compose a fresh 5-item plan from the pool.
  // -------------------------------------------------------------------------
  // The sample over-fetches distinct candidates per type so composeFreshPlan
  // can backfill a slot whose native type is missing (see its doc comment).
  // Fetch the pool sample and the user's per-point mastery in parallel, then
  // rank candidates (exposure order is preserved as the tiebreak) before
  // composing — so each slot picks the highest-priority item of its type.
  const [draws, masteryRows] = await Promise.all([
    sampleFreshPool({ language, difficulty: proficiencyLevel, userId }),
    db
      .select({
        grammarPointKey: userGrammarMastery.grammarPointKey,
        masteryScore: userGrammarMastery.masteryScore,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, userId),
          eq(userGrammarMastery.language, language),
        ),
      ),
  ]);

  const masteryByPoint = new Map<string, PointMastery>(
    masteryRows.map((r) => [
      r.grammarPointKey,
      { masteryScore: r.masteryScore, lastPracticedAt: new Date(r.lastPracticedAt) },
    ]),
  );

  const ranked = rankPlanCandidates(draws, {
    masteryByPoint,
    prereqsOf: (key) => getGrammarPoint(key)?.prerequisiteKeys ?? [],
    now: new Date(),
  });

  const { items, insufficient } = composeFreshPlan(ranked);

  const generatedAt = new Date().toISOString();

  if (insufficient) {
    return c.json({
      language,
      generatedAt,
      totalEstimatedMinutes: 0,
      items: [],
      summary: null,
      code: 'INSUFFICIENT_POOL' as const,
    });
  }

  return c.json({
    language,
    generatedAt,
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items: items.map(toWireItem),
    summary: null,
    code: null,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OVERFETCH_PER_TYPE = 20; // give ranking real choice per type

/**
 * Path B's pool sample: for each distinct exercise type in V1_PLAN_SHAPE, draws
 * up to `OVERFETCH_PER_TYPE` distinct rows via UNION-ALL (one exposure-ordered
 * LIMIT-N select per type). Over-fetching lets `composeFreshPlan` backfill a
 * slot whose native type is missing with a distinct exercise of another type;
 * it returns `insufficient: true` only when the pool yields no rows at all.
 *
 * Exercises are ordered by `freshFirstOrderBy` (never-attempted first, then
 * least-recently-seen) so the user is always shown fresh content before repeats.
 */
async function sampleFreshPool(params: {
  language: string;
  difficulty: CefrLevel;
  userId: string;
}): Promise<PoolDraw[]> {
  const { language, difficulty, userId } = params;
  const planTypes = [...new Set(V1_PLAN_SHAPE.map((slot) => slot.type))];
  const typeQueries = planTypes.map(
    (type) => sql`
      (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty, grammar_point_key
       FROM exercises
       WHERE language = ${language}
         AND difficulty = ${difficulty}
         AND type = ${type}
         AND review_status IN ('auto-approved', 'manual-approved')
         -- Never draw a dictation row whose audio hasn't been synthesized yet
         -- (audio_s3_key IS NULL). Non-dictation rows are unaffected. Defensive:
         -- dictation isn't in V1_PLAN_SHAPE today, but the gate must hold if it
         -- is ever added. Mirrors lib/exercise-filters.ts audioReadyFilter.
         AND (type <> 'dictation' OR audio_s3_key IS NOT NULL)
       ORDER BY ${freshFirstOrderBy(userId)}
       LIMIT ${OVERFETCH_PER_TYPE})
    `,
  );
  const unionSql = sql.join(typeQueries, sql` UNION ALL `);

  const result = await db.execute(unionSql);
  const rows = (result as unknown as {
    rows: Array<{
      id: string;
      type: string;
      topic_hint: string | null;
      difficulty: string;
      grammar_point_key: string | null;
    }>;
  }).rows;

  const draws: PoolDraw[] = [];
  for (const row of rows) {
    if (!isExerciseType(row.type)) continue;
    if (!isCefrLevel(row.difficulty)) continue;
    draws.push({
      id: row.id,
      type: row.type,
      topicHint: row.topic_hint,
      difficulty: row.difficulty,
      grammarPointKey: row.grammar_point_key,
    });
  }
  return draws;
}

/** Maps an in-memory PlanItem to the wire shape consumed by useTodayPlan. */
function toWireItem(item: PlanItem) {
  return {
    index: item.index,
    type: item.type,
    topicHint: item.topicHint,
    difficulty: item.difficulty,
    itemCount: item.itemCount,
    estimatedMinutes: item.estimatedMinutes,
    status: item.status,
  };
}

const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));
function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === 'string' && CEFR_LEVELS.has(value);
}

const EXERCISE_TYPES = new Set<string>(Object.values(ExerciseType));
function isExerciseType(value: string): value is ExerciseType {
  return EXERCISE_TYPES.has(value);
}

// ---------------------------------------------------------------------------
// GET /sessions/:id/debrief — read-only post-session debrief
// ---------------------------------------------------------------------------
// Returns session metadata + per-item review data in manifest order. Pure
// read: no Claude, no writes. Two SQL trips: one for the session row
// (ownership + completion gate), one for the per-item join via DISTINCT ON
// to collapse retries to the most-recent submission per (session, exercise).
//
// 404 collapses cross-user, unknown-id, and not-completed cases into the
// same response per NFR Security (avoids leaking session existence).
// ---------------------------------------------------------------------------

interface DebriefItemRow {
  exercise_id: string;
  type: string;
  grammar_point_key: string | null;
  content_json: unknown;
  score: number | null;
  response_json: unknown;
}

/**
 * Defensive parse of `user_exercise_history.response_json`. The submit handler
 * writes `{ userAnswer, evaluation }`, but if a row is malformed (e.g. older
 * format, manual edit), we degrade gracefully: null both fields, but the row
 * still counts as attempted (status derives from `score`). See Error Handling
 * §7 in design.md.
 */
function parseResponseJson(raw: unknown): {
  userAnswer: string | null;
  evaluation: unknown | null;
} {
  if (!raw || typeof raw !== 'object') {
    return { userAnswer: null, evaluation: null };
  }
  const obj = raw as Record<string, unknown>;
  const userAnswer = typeof obj.userAnswer === 'string' ? obj.userAnswer : null;
  const evaluation =
    obj.evaluation && typeof obj.evaluation === 'object' ? obj.evaluation : null;
  return { userAnswer, evaluation };
}

sessions.get('/sessions/:id/debrief', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  // 0. Validate UUID up front. Malformed UUIDs short-circuit before any DB call.
  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        error: 'Invalid session id',
        code: 'VALIDATION_ERROR',
        details: idResult.error.flatten(),
      },
      400,
    );
  }

  // 1. Session row + ownership + completion check in a single SELECT.
  //    Cross-user / unknown / not-yet-completed all collapse to no-row → 404.
  const sessionRows = await db
    .select()
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.id, id),
        eq(practiceSessions.userId, userId),
        isNotNull(practiceSessions.completedAt),
      ),
    )
    .limit(1);

  if (sessionRows.length === 0) {
    // Forensic log: the 404 collapses cross-user / unknown / not-completed by
    // design (NFR Security), but in production we want to know which axis
    // tripped a real user. Greppable by `event:debrief.not_found`.
    console.warn(
      'debrief: session row not found for ownership+completion predicate',
      { event: 'debrief.not_found', sessionId: id, userId },
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Session not found', code: 'SESSION_NOT_FOUND' },
      404,
    );
  }

  const session = sessionRows[0];
  const exerciseIds = session.exerciseIds as string[];

  // 2. Items query — single SQL trip, DISTINCT ON collapses retries to the
  //    most-recent submission per (session_id, exercise_id). LEFT JOIN ensures
  //    skipped items (no history row) still surface. NULLS LAST is defensive:
  //    `evaluated_at` is nullable in the schema.
  //
  // Deliberate non-filter on review_status: like Path A above, this hydrates
  // exercises by IDs already committed to a practice_sessions manifest.
  // Filtering would drop a flagged exercise from a completed session's debrief
  // view — wrong UX. See lib/exercise-filters.ts for the inventory.
  // Drizzle's `sql\`\`` interpolates a JS array as a positional record
  // `($N, $N+1, …)` — a Postgres ROW, not an array. `ANY(record)` is invalid
  // syntax (`op ANY/ALL (array) requires array on right side`). `IN (record)`
  // accepts the same record shape, so we use IN here. See bug
  // `.claude/bugs/debrief-items-query-failure/`.
  const itemsResult = await db.execute(sql`
    SELECT e.id AS exercise_id, e.type, e.grammar_point_key, e.content_json,
           h.score, h.response_json
    FROM exercises e
    LEFT JOIN (
      SELECT DISTINCT ON (exercise_id)
             exercise_id, score, response_json, evaluated_at
      FROM user_exercise_history
      WHERE session_id = ${id}
      ORDER BY exercise_id, evaluated_at DESC NULLS LAST
    ) h ON h.exercise_id = e.id
    WHERE e.id IN ${exerciseIds}
  `);

  // Drizzle's neon-serverless `db.execute` returns the pg-style QueryResult,
  // typed loosely. Narrow it to the projected shape via cast.
  const itemRows = itemsResult.rows as unknown as DebriefItemRow[];

  // Build a lookup so we can iterate the manifest in order (Req 2.1).
  const rowMap = new Map<string, DebriefItemRow>();
  for (const row of itemRows) {
    rowMap.set(row.exercise_id, row);
  }

  const items = exerciseIds
    .map((exerciseId) => {
      const row = rowMap.get(exerciseId);
      if (!row) return null; // exercise rows are immutable; defensive only
      const hasHistory = row.score !== null && row.score !== undefined;
      if (!hasHistory) {
        return {
          exerciseId,
          type: row.type as ExerciseType,
          grammarPointKey: row.grammar_point_key,
          contentJson: row.content_json,
          status: 'skipped' as const,
          userAnswer: null,
          score: null,
          evaluation: null,
        };
      }
      const score = Number(row.score);
      const { userAnswer, evaluation } = parseResponseJson(row.response_json);
      const status: 'correct' | 'incorrect' =
        score >= CORRECT_THRESHOLD ? 'correct' : 'incorrect';
      return {
        exerciseId,
        type: row.type as ExerciseType,
        grammarPointKey: row.grammar_point_key,
        contentJson: row.content_json,
        status,
        userAnswer,
        score,
        evaluation,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Counters derived from items so they stay aligned with per-item statuses.
  const attemptedCount = items.filter((i) => i.status !== 'skipped').length;
  const correctCount = items.filter((i) => i.status === 'correct').length;
  const skippedCount = session.exerciseCount - attemptedCount;

  const startedAt = new Date(session.startedAt as Date);
  const completedAt = new Date(session.completedAt as Date);
  const durationSeconds = Math.max(
    0,
    Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000),
  );

  c.header('Cache-Control', 'private, max-age=300');
  return c.json({
    id: session.id,
    language: session.language,
    difficulty: session.difficulty,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds,
    exerciseCount: session.exerciseCount,
    correctCount,
    attemptedCount,
    skippedCount,
    items,
  });
});

export default sessions;
