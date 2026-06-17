import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { exerciseFlags, exercises, userExerciseHistory } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';
import { recordAdminAction } from '../lib/admin-audit';

// Suppress unused-import warnings for symbols needed by Task 5 admin endpoints
// that will be added to this file.
void adminMiddleware;
void recordAdminAction;
void exercises;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// User-facing: authenticate (no admin gate).
app.use('/exercises/:exerciseId/flag', authMiddleware);

const FlagCategory = z.enum([
  'wrong_answer',
  'misleading_explanation',
  'confusing_prompt',
  'other',
]);

const FlagBodySchema = z.object({
  submissionId: z.string().uuid(),
  category: FlagCategory,
  note: z.string().trim().max(1000).optional(),
});

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof Error && 'code' in current && (current as { code: unknown }).code === '23505') return true;
    if (current instanceof Error && current.cause !== undefined) { current = current.cause; continue; }
    return false;
  }
  return false;
}

app.post('/exercises/:exerciseId/flag', async (c) => {
  const userId = c.get('userId');
  const exerciseId = c.req.param('exerciseId');
  if (!z.string().uuid().safeParse(exerciseId).success) {
    return c.json({ error: 'Invalid exercise id', code: 'VALIDATION_ERROR' }, 400);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400); }
  const parsed = FlagBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid flag', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { submissionId, category, note } = parsed.data;

  // The attempt must exist, belong to the caller, and match the exercise in the
  // path — a user can only flag their own attempt of this exercise.
  const rows = await db
    .select({ id: userExerciseHistory.id, userId: userExerciseHistory.userId, exerciseId: userExerciseHistory.exerciseId })
    .from(userExerciseHistory)
    .where(and(eq(userExerciseHistory.id, submissionId), eq(userExerciseHistory.userId, userId), eq(userExerciseHistory.exerciseId, exerciseId)))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' }, 404);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  try {
    await db.insert(exerciseFlags).values({
      id, historyId: submissionId, exerciseId, userId, category, note: note ?? null, status: 'open', createdAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: 'Already flagged', code: 'ALREADY_FLAGGED' }, 409);
    throw err;
  }
  return c.json({ id, status: 'open', createdAt: createdAt.toISOString() }, 201);
});

export default app;
