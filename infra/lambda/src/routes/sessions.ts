import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { Language, CefrLevel, CORRECT_THRESHOLD } from '@language-drill/shared';
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

export default sessions;
