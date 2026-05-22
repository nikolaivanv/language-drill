import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, gte, count } from 'drizzle-orm';
import { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import type { ExerciseContent } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  usageEvents,
} from '@language-drill/db';
import {
  createObservedClaudeClient,
  evaluateAnswer,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  withLlmTrace,
} from '@language-drill/ai';
import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const DAILY_EVAL_LIMIT = 50;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Query params for GET /exercises */
export const ExerciseQuerySchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  type: z.nativeEnum(ExerciseType).optional(),
});

/** Request body for POST /exercises/:id/submit */
export const SubmitAnswerSchema = z.object({
  answer: z.string().min(1),
  sessionId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const exercises = new Hono<{ Bindings: Bindings; Variables: Variables }>();

exercises.use('/exercises/*', authMiddleware);

// ---------------------------------------------------------------------------
// GET /exercises — return a random exercise matching the given filters
// ---------------------------------------------------------------------------
exercises.get('/exercises', async (c) => {
  const parsed = ExerciseQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }

  const { language, difficulty, type } = parsed.data;

  const conditions = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
  ];

  if (type) {
    conditions.push(eq(exercisesTable.type, type));
  }

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'No exercises found', code: 'NO_EXERCISES' }, 404);
  }

  const row = rows[0];
  return c.json({
    id: row.id,
    type: row.type,
    language: row.language,
    difficulty: row.difficulty,
    grammarPointKey: row.grammarPointKey,
    contentJson: row.contentJson,
  });
});

// ---------------------------------------------------------------------------
// GET /exercises/:id — return a single exercise by ID
// ---------------------------------------------------------------------------
exercises.get('/exercises/:id', async (c) => {
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, id), approvedStatusFilter(exercisesTable)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }

  const row = rows[0];
  return c.json({
    id: row.id,
    type: row.type,
    language: row.language,
    difficulty: row.difficulty,
    grammarPointKey: row.grammarPointKey,
    contentJson: row.contentJson,
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — evaluate the user's answer via Claude
// ---------------------------------------------------------------------------
exercises.post('/exercises/:id/submit', async (c) => {
  const id = c.req.param('id');

  // 1. Validate request body
  const bodyResult = SubmitAnswerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyResult.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: bodyResult.error.flatten() },
      400,
    );
  }
  const { answer: userAnswer, sessionId } = bodyResult.data;

  // 2. Fetch exercise by ID
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, id), approvedStatusFilter(exercisesTable)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }

  const exercise = rows[0];
  const userId = c.get('userId');

  // 2b. Validate session linkage BEFORE rate-limit + Claude — no side effects on failure
  if (sessionId !== undefined) {
    const sessionRows = await db
      .select({
        userId: practiceSessions.userId,
        completedAt: practiceSessions.completedAt,
        exerciseIds: practiceSessions.exerciseIds,
      })
      .from(practiceSessions)
      .where(eq(practiceSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];
    if (
      !session ||
      session.userId !== userId ||
      session.completedAt !== null ||
      !session.exerciseIds.includes(id)
    ) {
      return c.json({ error: 'Invalid session', code: 'INVALID_SESSION' }, 400);
    }
  }

  // 3. Check daily usage limit
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'ai_evaluation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );

  if (Number(todayCount) >= DAILY_EVAL_LIMIT) {
    return c.json(
      { error: 'Daily evaluation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }

  // 4. Mint the submissionId BEFORE the Claude call so the userExerciseHistory
  // row id and the Langfuse trace id are 1:1 — enables a one-click jump from
  // the DB row to the trace (Req 9 AC 2). UUID v4 fits the existing
  // `uuid().defaultRandom()` column without a schema change.
  const submissionId = randomUUID();
  const requestId =
    (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
      ?.requestContext?.requestId ?? 'local';

  // 5. Call Claude for evaluation
  try {
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY);
    const result = await withLlmTrace(
      {
        feature: 'evaluate',
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
        requestId,
        userId,
        submissionId,
        language: exercise.language as Language,
        cefrLevel: exercise.difficulty as CefrLevel,
        exerciseType: exercise.type as ExerciseType,
      },
      () =>
        evaluateAnswer(client, {
          exercise: exercise.contentJson as ExerciseContent,
          userAnswer,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
        }),
    );

    // 6. Record history and usage on success — `id: submissionId` makes the
    // history row id equal to the Langfuse trace tag (see step 4 above).
    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score: result.score,
      responseJson: { userAnswer, evaluation: result },
      evaluatedAt: new Date(),
    });

    await db.insert(usageEvents).values({
      userId,
      eventType: 'ai_evaluation',
      metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
    });

    return c.json(result);
  } catch (err) {
    // 7. Claude failure — do NOT write to history. The Proxy already
    // finalized the Langfuse generation with level=ERROR (Req 5 AC 3)
    // before re-throwing here.
    console.error('[POST /exercises/:id/submit] Claude evaluation failed:', err);
    return c.json(
      { error: 'Evaluation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }
});

export default exercises;
