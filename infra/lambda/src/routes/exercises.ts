import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, gte, count } from 'drizzle-orm';
import { Language, CefrLevel, ExerciseType, isFreeWritingContent, EXERCISE_ANSWER_MAX_CHARS } from '@language-drill/shared';
import type { ExerciseContent, FreeWritingContent } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  usageEvents,
  getGrammarPoint,
} from '@language-drill/db';
import {
  createObservedClaudeClient,
  evaluateAnswer,
  evaluateFreeWriting,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS,
  FREE_WRITING_EVAL_MAX_RETRIES,
  withLlmTrace,
} from '@language-drill/ai';
import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

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
  // `.max()` caps token-cost exposure: the answer is interpolated raw into the
  // evaluation prompt and sent to Claude (free writing runs a larger model), so
  // an unbounded answer is a cost-amplification lever. See
  // EXERCISE_ANSWER_MAX_CHARS for the rationale.
  answer: z.string().min(1).max(EXERCISE_ANSWER_MAX_CHARS),
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

  // Resolve curriculum grounding for the evaluator from the exercise's grammar
  // point. The evaluator runs on Haiku and otherwise sees only the exercise
  // content, so feeding it the authoritative rule + common errors stops it
  // confabulating rationales for rule-driven answers (e.g. the soft-l loanword
  // plural meşgul → meşguller). Best-effort: skipped when the key is absent or
  // not in the curriculum index.
  const grammarPoint = exercise.grammarPointKey
    ? getGrammarPoint(exercise.grammarPointKey)
    : undefined;
  const grammarGuidance = grammarPoint
    ? {
        name: grammarPoint.name,
        description: grammarPoint.description,
        commonErrors: grammarPoint.commonErrors,
      }
    : undefined;

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

  // 3. Resolve tier, run the global brake, then the per-user daily cap.
  const plan = await getEffectivePlan(userId);

  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json(
      {
        error: 'AI temporarily at capacity',
        code: 'GLOBAL_CAPACITY',
      },
      503,
    );
  }

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

  if (Number(todayCount) >= limitFor('ai_evaluation', plan)) {
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
    const content = exercise.contentJson as ExerciseContent;
    const isFreeWriting = isFreeWritingContent(content);

    // Eval-specific timeout/retries (Req 4.1): this client is constructed per
    // submit and used only for the evaluation call, so the fail-fast posture
    // is applied at construction (robust against the Langfuse Proxy not
    // forwarding per-request options). Free writing uses a larger budget.
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
      timeout: isFreeWriting ? FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS : EVAL_REQUEST_TIMEOUT_MS,
      maxRetries: isFreeWriting ? FREE_WRITING_EVAL_MAX_RETRIES : EVAL_MAX_RETRIES,
    });

    const traceMeta = {
      env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
      requestId,
      userId,
      submissionId,
      // R8: shared Langfuse join key with the generation+validation traces
      // for this exercise (`exercises.id` PK; same deterministic UUID).
      exerciseId: id,
      language: exercise.language as Language,
      cefrLevel: exercise.difficulty as CefrLevel,
      exerciseType: exercise.type as ExerciseType,
    };

    if (isFreeWriting) {
      const evaluation = await withLlmTrace(
        { ...traceMeta, feature: 'free-writing-eval', promptVersion: FREE_WRITING_EVAL_PROMPT_VERSION },
        () =>
          evaluateFreeWriting(client, {
            content: content as FreeWritingContent,
            userAnswer,
            language: exercise.language as Language,
            difficulty: exercise.difficulty as CefrLevel,
          }),
      );

      // 6. Record history and usage on success.
      await db.insert(userExerciseHistory).values({
        id: submissionId,
        userId,
        exerciseId: id,
        sessionId,
        score: evaluation.overallScore,
        responseJson: { userAnswer, evaluation },
        evaluatedAt: new Date(),
      });

      await db.insert(usageEvents).values({
        userId,
        eventType: 'ai_evaluation',
        metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
      });

      return c.json(evaluation);
    }

    const result = await withLlmTrace(
      { ...traceMeta, feature: 'evaluate', promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION },
      () =>
        evaluateAnswer(client, {
          exercise: content,
          userAnswer,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
          grammarGuidance,
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
