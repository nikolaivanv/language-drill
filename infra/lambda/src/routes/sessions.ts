import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, isNull, isNotNull } from 'drizzle-orm';
import {
  Language,
  CefrLevel,
  CORRECT_THRESHOLD,
  type ExerciseType,
} from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
} from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

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
  const itemsResult = await db.execute(sql`
    SELECT e.id AS exercise_id, e.type, e.content_json,
           h.score, h.response_json
    FROM exercises e
    LEFT JOIN (
      SELECT DISTINCT ON (exercise_id)
             exercise_id, score, response_json, evaluated_at
      FROM user_exercise_history
      WHERE session_id = ${id}
      ORDER BY exercise_id, evaluated_at DESC NULLS LAST
    ) h ON h.exercise_id = e.id
    WHERE e.id = ANY(${exerciseIds})
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
