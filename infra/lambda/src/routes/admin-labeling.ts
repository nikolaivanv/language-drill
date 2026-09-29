/**
 * Evaluator labeling surface. Serves real learner submissions for hand-labelling
 * and stores the verdicts — the ground truth `pnpm eval` lacks (it scores a
 * candidate against `expectedOutput: trace.output`, i.e. against itself).
 *
 * Mounted from admin.ts, so it inherits `admin.use('/admin/*', authMiddleware,
 * adminMiddleware)`. No recordAdminAction: a label mutates nothing a learner can
 * see, and the audit action union carries a web-side ripple that would buy
 * nothing here.
 *
 * See docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md.
 */
import { CORRECT_THRESHOLD, LABELABLE_EXERCISE_TYPES, LABEL_STRATA } from '@language-drill/shared';
import { exercises, submissionLabels, userExerciseHistory } from '@language-drill/db';
import { renderLearnerView } from '@language-drill/ai';
import { Hono } from 'hono';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db';
import type { Bindings, Variables } from '../middleware/auth';

export const adminLabeling = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** How far below/above the pass mark counts as "near the boundary". */
const NEAR_BOUNDARY_BELOW = 0.2;
const NEAR_BOUNDARY_ABOVE = 0.1;

const QueueQuerySchema = z.object({
  stratum: z.enum(LABEL_STRATA),
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  type: z.enum(LABELABLE_EXERCISE_TYPES).optional(),
  grammarPoint: z.string().max(120).optional(),
  nearBoundary: z.enum(['true', 'false']).optional(),
  scoreMin: z.coerce.number().min(0).max(1).optional(),
  scoreMax: z.coerce.number().min(0).max(1).optional(),
  hasErrors: z.enum(['true', 'false']).optional(),
  seed: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type QueueQuery = z.infer<typeof QueueQuerySchema>;

/**
 * The seed is INLINED into the ORDER BY expression, not bound — a bound literal
 * inside a SQL function has broken before in this codebase, and typecheck plus
 * tests are both blind to it. So it must be sanitized here: anything but
 * `[A-Za-z0-9-]{1,32}` falls back to today's date.
 */
export function safeSeed(raw: string | undefined, today: Date): string {
  const fallback = today.toISOString().slice(0, 10);
  if (raw === undefined) return fallback;
  return /^[A-Za-z0-9-]{1,32}$/.test(raw) ? raw : fallback;
}

/**
 * The row-selection predicates — the task's real product. Exported as a pure
 * function (rather than inlined in the handler) so a test can compile it to
 * real SQL text via drizzle's dialect, against the REAL `exercises` /
 * `userExerciseHistory` / `submissionLabels` schema objects, without needing a
 * live DB connection or a mocked `db`. That is the only way to prove the
 * deterministic-source exclusion, the LABELABLE_EXERCISE_TYPES restriction,
 * and the per-labeler NOT EXISTS reference the right columns — a mocked
 * `@language-drill/db` (as the route's own request-level tests use) replaces
 * these tables with `{ __mock: ... }` sentinels, so a wrong column reference
 * would silently pass those tests.
 */
export function buildQueueConditions(q: QueueQuery, labeler: string) {
  const conditions = [
    // Deterministic-source rows had no LLM judgment, so there is nothing to label.
    sql`${userExerciseHistory.responseJson}->'evaluation'->>'evaluationSource' IS DISTINCT FROM 'deterministic'`,
    // renderLearnerView throws outside this set; dictation/free-writing are other prompts entirely.
    inArray(exercises.type, [...LABELABLE_EXERCISE_TYPES]),
    // Unlabelled by THIS labeler (labels are per-labeler).
    sql`NOT EXISTS (
      SELECT 1 FROM ${submissionLabels} sl
      WHERE sl.submission_id = ${userExerciseHistory.id} AND sl.labeled_by = ${labeler}
    )`,
  ];

  if (q.language) conditions.push(eq(exercises.language, q.language));
  if (q.type) conditions.push(eq(exercises.type, q.type));
  if (q.grammarPoint) conditions.push(eq(exercises.grammarPointKey, q.grammarPoint));
  if (q.hasErrors === 'true') {
    conditions.push(
      sql`jsonb_array_length(COALESCE(${userExerciseHistory.responseJson}->'evaluation'->'errors', '[]'::jsonb)) > 0`,
    );
  }
  if (q.nearBoundary === 'true') {
    conditions.push(gte(userExerciseHistory.score, CORRECT_THRESHOLD - NEAR_BOUNDARY_BELOW));
    conditions.push(lte(userExerciseHistory.score, CORRECT_THRESHOLD + NEAR_BOUNDARY_ABOVE));
  }
  if (q.scoreMin !== undefined) conditions.push(gte(userExerciseHistory.score, q.scoreMin));
  if (q.scoreMax !== undefined) conditions.push(lte(userExerciseHistory.score, q.scoreMax));

  return conditions;
}

/**
 * The ORDER BY expression. Split out alongside `buildQueueConditions` so the
 * same SQL-compiling test can pin the md5 seed-ordering text (and would catch
 * a `user_exercise_history` table rename or a stray bound literal there).
 */
export function buildQueueOrder(stratum: QueueQuery['stratum'], seed: string) {
  // Stable pseudo-random order: a refresh must not reshuffle, a session must be
  // resumable, and a sample we quote a production rate from must be replayable.
  return stratum === 'random'
    ? sql.raw(`md5(user_exercise_history.id::text || '${seed}')`)
    : sql`abs(${userExerciseHistory.score} - ${CORRECT_THRESHOLD}) asc, ${userExerciseHistory.evaluatedAt} desc`;
}

/** Reference/answer fields per content type — rendered in their own panel, never merged into the stimulus. */
export function extractReferenceAnswers(content: unknown): Record<string, unknown> {
  if (content === null || typeof content !== 'object') return {};
  const c = content as Record<string, unknown>;
  const keep = [
    'correctAnswer',
    'acceptableAnswers',
    'referenceTranslation',
    'acceptableTranslations',
    'expectedWord',
    'modelAnswers',
    'targetForm',
    'acceptableForms',
    'referenceParaphrases',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  }
  return out;
}

adminLabeling.get('/admin/labeling/queue', async (c) => {
  const parsed = QueueQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const labeler = c.get('userId');
  const limit = q.limit ?? 25;

  const where = and(...buildQueueConditions(q, labeler));
  const seed = safeSeed(q.seed, new Date());
  const order = buildQueueOrder(q.stratum, seed);

  const rows = await db
    .select({
      submissionId: userExerciseHistory.id,
      exerciseId: exercises.id,
      language: exercises.language,
      cefrLevel: exercises.difficulty,
      exerciseType: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      responseJson: userExerciseHistory.responseJson,
      score: userExerciseHistory.score,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(where)
    .orderBy(order)
    .limit(limit);

  const remainingRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(where);

  let dropped = 0;
  const items = rows.flatMap((r) => {
    const resp = (r.responseJson ?? {}) as {
      userAnswer?: unknown;
      evaluation?: unknown;
      optionsRevealed?: unknown;
    };
    const optionsRevealed = resp.optionsRevealed === true;
    let learnerView: string;
    try {
      // Reproduce what the learner actually saw: options sit behind a toggle in
      // production, so only include them when this attempt revealed them.
      learnerView = renderLearnerView(r.contentJson as never, { includeOptions: optionsRevealed });
    } catch (err) {
      // A content type outside LABELABLE_EXERCISE_TYPES slipped through (stale
      // row, renamed type, or a content_json/exercises.type mismatch), or the
      // content itself is malformed. Drop the item — never 500 the whole page
      // for one row — but log it: this row still counts toward `remaining`
      // (same `where`), and the stable md5 order means it sits at the same
      // queue position on every refresh, so a silent drop here can present as
      // a permanently-empty page with a nonzero `remaining`.
      dropped += 1;
      console.warn(
        `admin-labeling: dropped unrenderable submission ${r.submissionId} (exercise ${r.exerciseId}, type ${r.exerciseType}):`,
        err,
      );
      return [];
    }
    return [
      {
        submissionId: r.submissionId,
        exerciseId: r.exerciseId,
        language: r.language,
        cefrLevel: r.cefrLevel,
        exerciseType: r.exerciseType,
        grammarPointKey: r.grammarPointKey,
        learnerView,
        referenceAnswers: extractReferenceAnswers(r.contentJson),
        userAnswer: resp.userAnswer ?? null,
        evaluation: resp.evaluation ?? null,
        score: r.score,
        evaluatedAt: r.evaluatedAt ? r.evaluatedAt.toISOString() : null,
        optionsRevealed,
      },
    ];
  });

  return c.json({ items, remaining: Number(remainingRows[0]?.count ?? 0), dropped });
});
