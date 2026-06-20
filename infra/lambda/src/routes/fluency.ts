import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  Language,
  ExerciseType,
  type ExerciseContent,
  gradeFluencyAnswer,
  isFluencyEligibleType,
  FLUENCY_MASTERY_THRESHOLD,
  LATENCY_CEILING_MS,
  DEFAULT_FLUENCY_SESSION_SIZE,
  MIN_FLUENCY_POOL,
  FLUENCY_ELIGIBLE_TYPES,
} from '@language-drill/shared';
import { exercises as exercisesTable, fluencyAttempts } from '@language-drill/db';
import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { composeFluencySession, resolveFluencyTypes, type EligibleExercise } from '../lib/fluency-session';
import { aggregateFluencyStats, type FluencyAttemptRow } from '../lib/fluency-stats';

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

// Eligible-type enum for the optional `types` filter. Derived from the single
// source of truth so it can never drift from gradeFluencyAnswer's support.
const FluencyTypeEnum = z.enum(
  FLUENCY_ELIGIBLE_TYPES as unknown as [string, ...string[]],
);

const SessionBodySchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
  types: z.array(FluencyTypeEnum).nonempty().optional(),
});

const AttemptBodySchema = z.object({
  exerciseId: z.string().uuid(),
  answer: z.string().min(1),
  latencyMs: z.number().int().positive(),
});

const StatsQuerySchema = z.object({
  language: LearningLanguageEnum,
});

const STATS_WEEKS = 8;
const STATS_WINDOW_MS = STATS_WEEKS * 7 * 86_400_000;

const fluency = new Hono<{ Bindings: Bindings; Variables: Variables }>();

fluency.use('/fluency/*', authMiddleware);

// ---------------------------------------------------------------------------
// POST /fluency/session — return eligible mastered items for a timed drill
// ---------------------------------------------------------------------------
fluency.post('/fluency/session', async (c) => {
  const parsed = SessionBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, count = DEFAULT_FLUENCY_SESSION_SIZE } = parsed.data;
  const userId = c.get('userId');

  const typeList = resolveFluencyTypes(parsed.data.types as ExerciseType[] | undefined);
  const typesInList = sql.join(typeList.map((t) => sql`${t}`), sql`, `);

  // Eligible = the user's most-recent score per exercise is >= threshold, the
  // exercise is an eligible (locally-gradable) type, this language, approved.
  // DISTINCT ON collapses retries to the latest submission per exercise; the
  // outer filter keeps only those whose latest score cleared the threshold.
  // Raw-SQL DISTINCT ON: must inline the review_status predicate here
  // (no Drizzle helper). Mirrors `approvedStatusFilter` in the helper at
  // lib/exercise-filters.ts; keep both in sync if APPROVED_STATUSES changes.
  const result = await db.execute(sql`
    SELECT e.id, e.type, e.language, e.difficulty, e.grammar_point_key, e.content_json
    FROM exercises e
    JOIN (
      SELECT DISTINCT ON (exercise_id) exercise_id, score
      FROM user_exercise_history
      WHERE user_id = ${userId}
      ORDER BY exercise_id, evaluated_at DESC NULLS LAST
    ) h ON h.exercise_id = e.id
    WHERE e.language = ${language}
      AND e.type IN (${typesInList})
      AND e.review_status IN ('auto-approved', 'manual-approved')
      AND h.score >= ${FLUENCY_MASTERY_THRESHOLD}
  `);

  const rows = (result as unknown as {
    rows: Array<{
      id: string;
      type: string;
      language: string;
      difficulty: string;
      grammar_point_key: string | null;
      content_json: unknown;
    }>;
  }).rows;

  const pool: EligibleExercise[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    language: r.language,
    difficulty: r.difficulty,
    grammarPointKey: r.grammar_point_key,
    contentJson: r.content_json,
  }));

  const composed = composeFluencySession(pool, count);
  if (composed.insufficient) {
    return c.json(
      {
        error: 'Not enough mastered items for fluency mode',
        code: 'INSUFFICIENT_FLUENCY_POOL',
        details: { available: composed.available, required: MIN_FLUENCY_POOL },
      },
      409,
    );
  }

  return c.json({
    language,
    exercises: composed.items.map((e) => ({
      id: e.id,
      type: e.type,
      language: e.language,
      difficulty: e.difficulty,
      grammarPointKey: e.grammarPointKey,
      contentJson: e.contentJson,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /fluency/attempts — deterministically grade + record one timed answer
// ---------------------------------------------------------------------------
fluency.post('/fluency/attempts', async (c) => {
  const parsed = AttemptBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      422,
    );
  }
  const { exerciseId, answer, latencyMs } = parsed.data;
  const userId = c.get('userId');

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, exerciseId), approvedStatusFilter(exercisesTable)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }
  const exercise = rows[0];

  // Guard: only locally-gradable types are accepted in fluency mode.
  if (!exercise.type || !isFluencyEligibleType(exercise.type as ExerciseType)) {
    return c.json({ error: 'Exercise not eligible for fluency', code: 'NOT_FLUENCY_ELIGIBLE' }, 400);
  }

  const correct = gradeFluencyAnswer(exercise.contentJson as ExerciseContent, answer);
  const clampedLatency = Math.min(latencyMs, LATENCY_CEILING_MS);

  await db.insert(fluencyAttempts).values({
    userId,
    exerciseId,
    language: exercise.language,
    grammarPointKey: exercise.grammarPointKey,
    correct,
    latencyMs: clampedLatency,
  });

  // Resolve correctAnswer for instant feedback (no Claude).
  const content = exercise.contentJson as ExerciseContent;
  const correctAnswer =
    content.type === ExerciseType.CLOZE
      ? content.correctAnswer
      : content.type === ExerciseType.VOCAB_RECALL
        ? content.expectedWord
        : content.type === ExerciseType.CONJUGATION
          ? content.targetForm
          : ''; // defensive default; isFluencyEligibleType guard keeps only eligible types here

  return c.json({ correct, correctAnswer, latencyMs: clampedLatency });
});

// ---------------------------------------------------------------------------
// GET /fluency/stats — latency/accuracy/volume trend for the active language
// ---------------------------------------------------------------------------
fluency.get('/fluency/stats', async (c) => {
  const parsed = StatsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const windowStart = new Date(now.getTime() - STATS_WINDOW_MS);

  const rows = await db
    .select({
      latencyMs: fluencyAttempts.latencyMs,
      correct: fluencyAttempts.correct,
      attemptedAt: fluencyAttempts.attemptedAt,
    })
    .from(fluencyAttempts)
    .where(
      and(
        eq(fluencyAttempts.userId, userId),
        eq(fluencyAttempts.language, language),
        gte(fluencyAttempts.attemptedAt, windowStart),
      ),
    );

  const typed: FluencyAttemptRow[] = rows
    .filter((r) => r.attemptedAt !== null && r.latencyMs !== null)
    .map((r) => ({
      latencyMs: r.latencyMs as number,
      correct: r.correct as boolean,
      attemptedAt: r.attemptedAt as Date,
    }));

  const stats = aggregateFluencyStats(typed, now, STATS_WEEKS);
  return c.json({ language, ...stats });
});

export default fluency;
