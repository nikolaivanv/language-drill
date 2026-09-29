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
import { CORRECT_THRESHOLD, LABELABLE_EXERCISE_TYPES, LABEL_STRATA, LABEL_TAGS } from '@language-drill/shared';
import { exercises, submissionLabels, userExerciseHistory } from '@language-drill/db';
import { EVALUATION_SYSTEM_PROMPT_VERSION, renderLearnerView } from '@language-drill/ai';
import { Hono } from 'hono';
import { and, eq, getTableName, gte, inArray, lte, sql } from 'drizzle-orm';
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
  //
  // The table name is DERIVED via `getTableName`, not spelled out as a
  // literal: a hardcoded string here plus a compiled-SQL test that asserts
  // the same hardcoded string is an illusory mitigation — after a table
  // rename, the hardcode and the assertion would stay in agreement while
  // production (a real, renamed table) breaks. `sql.raw` is still required
  // for the seed half of the expression (see `safeSeed`'s doc comment: a
  // bound literal inside this SQL function has broken before), so the two
  // pieces are concatenated rather than expressed with `sql` template
  // interpolation throughout.
  const table = getTableName(userExerciseHistory);
  return stratum === 'random'
    ? sql.raw(`md5(${table}.id::text || '${seed}')`)
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

const SaveLabelSchema = z
  .object({
    gradeOk: z.boolean().nullable(),
    feedbackOk: z.boolean().nullable(),
    stratum: z.enum(LABEL_STRATA),
    tags: z
      .array(z.enum(LABEL_TAGS))
      .max(LABEL_TAGS.length)
      // The UI can't produce a duplicate (it toggles a tag in/out of a set),
      // but a raw request can, and an unrejected duplicate double-counts that
      // tag in the /admin/labeling/stats histogram.
      .refine((t) => new Set(t).size === t.length, { message: 'Duplicate tags are not allowed' })
      .optional(),
    critique: z.string().trim().max(2000).optional(),
  })
  // labeledBy and promptVersion are stamped server-side. A body that supplies
  // either is a client bug, so fail loudly instead of silently ignoring it.
  .strict();

adminLabeling.post('/admin/labeling/:submissionId', async (c) => {
  const submissionId = c.req.param('submissionId');
  if (!z.string().uuid().safeParse(submissionId).success) {
    return c.json({ error: 'Invalid submission id', code: 'VALIDATION_ERROR' }, 400);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400);
  }
  const parsed = SaveLabelSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid label', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { gradeOk, feedbackOk, stratum, tags, critique } = parsed.data;

  // A bare `false` is unusable three weeks later, and the critique is the raw
  // material the next tag comes from.
  const hasFalse = gradeOk === false || feedbackOk === false;
  if (hasFalse && (critique === undefined || critique.length === 0)) {
    return c.json({ error: 'Explain what was wrong', code: 'CRITIQUE_REQUIRED' }, 400);
  }

  const exists = await db
    .select({ id: userExerciseHistory.id })
    .from(userExerciseHistory)
    .where(eq(userExerciseHistory.id, submissionId))
    .limit(1);
  if (exists.length === 0) {
    return c.json({ error: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' }, 404);
  }

  const labeledBy = c.get('userId');
  const labeledAt = new Date();
  await db
    .insert(submissionLabels)
    .values({
      submissionId,
      gradeOk,
      feedbackOk,
      tags: tags ?? [],
      critique: critique ?? null,
      stratum,
      promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
      labeledBy,
      labeledAt,
    })
    .onConflictDoUpdate({
      target: [submissionLabels.submissionId, submissionLabels.labeledBy],
      // `stratum` is deliberately ABSENT here (present only in the INSERT
      // values above). It is fixed at first touch, not re-stamped on
      // re-label: first touch is the only correct provenance, since it names
      // the selection mechanism that actually put the row in front of the
      // labeler. Without this, a labeler who labels a row under `targeted`
      // and later revisits it from a stale-cached `random` page (queue pages
      // are `staleTime: Infinity`, and a page fetched before this row was
      // labelled can still list it) would silently rewrite its stratum from
      // `targeted` to `random` — smuggling a boundary-selected row into the
      // one denominator that must never be blended with a defect hunt.
      set: {
        gradeOk,
        feedbackOk,
        tags: tags ?? [],
        critique: critique ?? null,
        promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
        labeledAt,
      },
    });

  return c.json({ saved: true, promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION });
});

adminLabeling.get('/admin/labeling/stats', async (c) => {
  const perStratum = await db
    .select({
      stratum: submissionLabels.stratum,
      count: sql<number>`count(*)`,
      gradeOk: sql<number>`count(*) filter (where ${submissionLabels.gradeOk} = true)`,
      feedbackOk: sql<number>`count(*) filter (where ${submissionLabels.feedbackOk} = true)`,
    })
    .from(submissionLabels)
    .groupBy(submissionLabels.stratum)
    .orderBy(submissionLabels.stratum);

  const tagRows = await db
    .select({
      tag: sql<string>`jsonb_array_elements_text(${submissionLabels.tags})`,
      count: sql<number>`count(*)`,
    })
    .from(submissionLabels)
    .groupBy(sql`jsonb_array_elements_text(${submissionLabels.tags})`)
    .orderBy(sql`count(*) desc`);

  const todayRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(submissionLabels)
    .where(sql`${submissionLabels.labeledAt} >= date_trunc('day', now())`);

  return c.json({
    strata: perStratum.map((r) => {
      const count = Number(r.count);
      return {
        stratum: r.stratum,
        count,
        gradeOkRate: count === 0 ? 0 : Number(r.gradeOk) / count,
        feedbackOkRate: count === 0 ? 0 : Number(r.feedbackOk) / count,
      };
    }),
    tags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
    labeledToday: Number(todayRows[0]?.count ?? 0),
  });
});
