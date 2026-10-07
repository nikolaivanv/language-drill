import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, lt } from 'drizzle-orm';
import { Language, ExerciseType } from '@language-drill/shared';
import { exercises, userExerciseHistory } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Free-writing history — read-only revisit of the caller's graded essays.
//
// Every graded free-writing submit already stores the essay and the full
// evaluation in `user_exercise_history.responseJson` ({ userAnswer, evaluation }).
// These routes only read it back. The evaluation is returned verbatim (not
// re-validated here): rows written by older evaluator versions may not match
// today's schema, and the client decides how to degrade per attempt instead of
// the whole list failing.
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/free-writing/history', authMiddleware);
app.use('/free-writing/history/*', authMiddleware);

export const FREE_WRITING_HISTORY_DEFAULT_LIMIT = 30;
export const FREE_WRITING_HISTORY_MAX_LIMIT = 100;

const ListQuerySchema = z.object({
  language: z.nativeEnum(Language).optional(),
  limit: z.coerce.number().int().min(1).max(FREE_WRITING_HISTORY_MAX_LIMIT).optional(),
  /** ISO timestamp — return attempts evaluated strictly before it (the previous page's `nextCursor`). */
  cursor: z.string().datetime().optional(),
});

type StoredResponse = { userAnswer?: unknown; evaluation?: unknown };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

app.get('/free-writing/history', async (c) => {
  const userId = c.get('userId');
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, cursor } = parsed.data;
  const limit = parsed.data.limit ?? FREE_WRITING_HISTORY_DEFAULT_LIMIT;

  const conditions = [
    eq(userExerciseHistory.userId, userId),
    eq(exercises.type, ExerciseType.FREE_WRITING),
  ];
  if (language) conditions.push(eq(exercises.language, language));
  if (cursor) conditions.push(lt(userExerciseHistory.evaluatedAt, new Date(cursor)));

  const rows = await db
    .select({
      id: userExerciseHistory.id,
      exerciseId: userExerciseHistory.exerciseId,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      score: userExerciseHistory.score,
      responseJson: userExerciseHistory.responseJson,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(and(...conditions))
    .orderBy(desc(userExerciseHistory.evaluatedAt))
    .limit(limit);

  const items = rows.map((r) => {
    const evaluation = asRecord((asRecord(r.responseJson) as StoredResponse).evaluation);
    const content = asRecord(r.contentJson);
    return {
      id: r.id,
      exerciseId: r.exerciseId,
      evaluatedAt: r.evaluatedAt ? r.evaluatedAt.toISOString() : null,
      language: r.language,
      difficulty: r.difficulty,
      title: stringOrNull(content.title),
      score: r.score,
      overallCefr: stringOrNull(evaluation.overallCefr),
      headline: stringOrNull(evaluation.headline),
      wordCount: numberOrNull(evaluation.wordCount),
    };
  });

  const last = items[items.length - 1];
  const nextCursor = items.length === limit && last?.evaluatedAt ? last.evaluatedAt : null;

  return c.json({ items, nextCursor });
});

app.get('/free-writing/history/:submissionId', async (c) => {
  const userId = c.get('userId');
  const submissionId = c.req.param('submissionId');
  if (!z.string().uuid().safeParse(submissionId).success) {
    return c.json({ error: 'Attempt not found', code: 'NOT_FOUND' }, 404);
  }

  const rows = await db
    .select({
      id: userExerciseHistory.id,
      exerciseId: userExerciseHistory.exerciseId,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      responseJson: userExerciseHistory.responseJson,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(
      and(
        eq(userExerciseHistory.id, submissionId),
        eq(userExerciseHistory.userId, userId),
        eq(exercises.type, ExerciseType.FREE_WRITING),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'Attempt not found', code: 'NOT_FOUND' }, 404);
  }

  const stored = asRecord(row.responseJson) as StoredResponse;
  return c.json({
    id: row.id,
    exerciseId: row.exerciseId,
    evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
    language: row.language,
    difficulty: row.difficulty,
    content: row.contentJson,
    userAnswer: stringOrNull(stored.userAnswer),
    evaluation: stored.evaluation ?? null,
  });
});

export default app;
