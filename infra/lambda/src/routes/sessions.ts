import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, isNull, gte, desc, inArray } from 'drizzle-orm';
import { Language, CefrLevel, CORRECT_THRESHOLD, ExerciseType } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  userLanguageProfiles,
} from '@language-drill/db';
import { db } from '../db';
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

  // Pull a random manifest of N exercises for this (language, difficulty)
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(
      and(
        eq(exercisesTable.language, language),
        eq(exercisesTable.difficulty, difficulty),
      ),
    )
    .orderBy(sql`random()`)
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

  return c.json({
    id: inserted[0].id,
    exercises: rows.map((r) => ({
      id: r.id,
      type: r.type,
      language: r.language,
      difficulty: r.difficulty,
      contentJson: r.contentJson,
    })),
  });
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
  // Path B — compose a fresh 5-item plan from the pool (UNION-ALL one query)
  // -------------------------------------------------------------------------
  // The UNION-ALL preserves slot order so draws[i] aligns with V1_PLAN_SHAPE[i].
  const draws = await sampleFreshPool({ language, difficulty: proficiencyLevel });
  const { items, insufficient } = composeFreshPlan(draws);

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

/**
 * Path B's pool sample: draws one exercise per slot in V1_PLAN_SHAPE order via
 * UNION-ALL of five LIMIT 1 selects. Returns rows in slot order so callers can
 * align `draws[i]` with `V1_PLAN_SHAPE[i]` directly. Missing types yield fewer
 * rows; `composeFreshPlan` then returns `insufficient: true`.
 */
async function sampleFreshPool(params: {
  language: string;
  difficulty: CefrLevel;
}): Promise<PoolDraw[]> {
  const { language, difficulty } = params;
  const slotQueries = V1_PLAN_SHAPE.map(
    (slot) => sql`
      (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty
       FROM exercises
       WHERE language = ${language}
         AND difficulty = ${difficulty}
         AND type = ${slot.type}
       ORDER BY random()
       LIMIT 1)
    `,
  );
  const unionSql = sql.join(slotQueries, sql` UNION ALL `);

  const result = await db.execute(unionSql);
  const rows = (result as unknown as {
    rows: Array<{ id: string; type: string; topic_hint: string | null; difficulty: string }>;
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

export default sessions;
