import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { exerciseFlags, exercises, userExerciseHistory } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';
import { recordAdminAction } from '../lib/admin-audit';

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

// Admin-gated flag review + resolution.
app.use('/admin/flags', authMiddleware, adminMiddleware);
app.use('/admin/flags/*', authMiddleware, adminMiddleware);

const ListQuerySchema = z.object({
  status: z.enum(['open', 'resolved_rejected', 'resolved_dismissed', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

app.get('/admin/flags', async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  const status = parsed.data.status ?? 'open';
  const limit = parsed.data.limit ?? 100;
  const where = status === 'all' ? undefined : eq(exerciseFlags.status, status);

  const baseSelect = {
    id: exerciseFlags.id, status: exerciseFlags.status, category: exerciseFlags.category,
    note: exerciseFlags.note, createdAt: exerciseFlags.createdAt, resolvedAt: exerciseFlags.resolvedAt,
    exerciseId: exerciseFlags.exerciseId, submissionId: exerciseFlags.historyId,
    exLanguage: exercises.language, exLevel: exercises.difficulty, exType: exercises.type,
    exGrammar: exercises.grammarPointKey, exReviewStatus: exercises.reviewStatus, exContent: exercises.contentJson,
    responseJson: userExerciseHistory.responseJson,
  };
  const listChain = db.select(baseSelect)
    .from(exerciseFlags)
    .innerJoin(userExerciseHistory, eq(userExerciseHistory.id, exerciseFlags.historyId))
    .innerJoin(exercises, eq(exercises.id, exerciseFlags.exerciseId));
  const countChain = db.select({ count: sql<number>`count(*)` }).from(exerciseFlags);

  const [rows, totalRows] = await Promise.all([
    (where ? listChain.where(where) : listChain).orderBy(desc(exerciseFlags.createdAt)).limit(limit),
    where ? countChain.where(where) : countChain,
  ]);

  const items = rows.map((r) => {
    const resp = (r.responseJson ?? {}) as { userAnswer?: unknown; evaluation?: unknown };
    return {
      id: r.id, status: r.status, category: r.category, note: r.note,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      exerciseId: r.exerciseId, submissionId: r.submissionId,
      exercise: { language: r.exLanguage, level: r.exLevel, type: r.exType, grammarPointKey: r.exGrammar, reviewStatus: r.exReviewStatus, contentJson: r.exContent },
      userAnswer: resp.userAnswer ?? null,
      evaluation: resp.evaluation ?? null,
    };
  });
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

type FlagResolveOutcome = 'rejected' | 'dismissed' | 'already_resolved' | 'not_found';

async function loadOpenFlag(id: string): Promise<{ exerciseId: string } | 'not_found' | 'already_resolved'> {
  const rows = await db.select({ id: exerciseFlags.id, exerciseId: exerciseFlags.exerciseId, status: exerciseFlags.status })
    .from(exerciseFlags).where(eq(exerciseFlags.id, id)).limit(1);
  if (rows.length === 0) return 'not_found';
  if (rows[0].status !== 'open') return 'already_resolved';
  return { exerciseId: rows[0].exerciseId };
}

app.post('/admin/flags/:id/reject', async (c) => {
  const id = c.req.param('id');
  const flag = await loadOpenFlag(id);
  if (flag === 'not_found' || flag === 'already_resolved') return c.json({ outcome: flag });
  // Terminal reject: pull from pool (from any non-rejected status).
  await db.update(exercises).set({ reviewStatus: 'rejected' }).where(eq(exercises.id, flag.exerciseId)).returning({ id: exercises.id });
  await db.update(exerciseFlags).set({ status: 'resolved_rejected', resolvedBy: c.get('userId'), resolvedAt: new Date() })
    .where(eq(exerciseFlags.id, id)).returning({ id: exerciseFlags.id });
  await recordAdminAction(db, { adminUserId: c.get('userId'), action: 'user_flag.reject', targetType: 'exercise', targetId: flag.exerciseId, metadata: { flagId: id } });
  return c.json({ outcome: 'rejected' as FlagResolveOutcome });
});

app.post('/admin/flags/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const flag = await loadOpenFlag(id);
  if (flag === 'not_found' || flag === 'already_resolved') return c.json({ outcome: flag });
  await db.update(exerciseFlags).set({ status: 'resolved_dismissed', resolvedBy: c.get('userId'), resolvedAt: new Date() })
    .where(eq(exerciseFlags.id, id)).returning({ id: exerciseFlags.id });
  await recordAdminAction(db, { adminUserId: c.get('userId'), action: 'user_flag.dismiss', targetType: 'exercise_flag', targetId: id, metadata: { exerciseId: flag.exerciseId } });
  return c.json({ outcome: 'dismissed' as FlagResolveOutcome });
});

export default app;
