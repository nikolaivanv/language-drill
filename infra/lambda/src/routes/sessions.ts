import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, isNull, isNotNull, gte, desc, inArray, notInArray } from 'drizzle-orm';
import { Language, CefrLevel, CORRECT_THRESHOLD, ExerciseType, targetItemCount, type SkillMovement } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  userLanguageProfiles,
  userGrammarMastery,
  userPreferences,
  errorObservations,
  getGrammarPoint,
} from '@language-drill/db';
import { rankPlanCandidates, reasonFor, type PointMastery, type RankContext } from '../lib/mastery/rank';
import { buildRankContext } from '../lib/mastery/rank-context';
import { computeSkillMovements, type SkillHistoryRow } from '../lib/debrief/skill-movements.js';
import { db } from '../db';
import { approvedStatusFilter, audioReadyFilter, freshFirstOrderBy } from '../lib/exercise-filters';
import { mergeSessionRows } from '../lib/session-selection';
import { presignAudioUrl } from '../lib/audio-url';
import { withAudioUrl } from '../lib/dictation-content';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  V1_PLAN_SHAPE,
  composeFreshPlan,
  hydrateFromSession,
  isFreeWritingDay,
  startOfUtcDay,
  planSkeleton,
  ESTIMATED_MINUTES_BY_TYPE,
  type PlanItem,
  type PoolDraw,
} from '../lib/today-plan';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. Mirrors the comment block in
// `routes/profiles.ts` and `routes/progress.ts`.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const TodayQuerySchema = z.object({
  language: LearningLanguageEnum,
});

const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;

/** Request body for POST /sessions (mirrors api-client CreateSessionRequest) */
export const CreateSessionRequestSchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  exerciseCount: z.number().int().min(1).max(20),
  exerciseType: z.nativeEnum(ExerciseType).optional(),
  grammarPointKey: z.string().min(1).optional(),
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

  const { language, difficulty, exerciseCount, exerciseType, grammarPointKey } = bodyResult.data;
  const userId = c.get('userId');
  const now = new Date();

  // Over-fetch factor: pull more candidates than needed so the in-memory ranker
  // has real choice. freshFirstOrderBy remains the SQL pre-order (exposure
  // control); the ranker reorders within the over-fetched set by mastery gap +
  // error weight, then the top exerciseCount rows are taken.
  const OVERFETCH = Math.max(exerciseCount * 4, 20);

  // Pull a manifest of N exercises for this (language, difficulty), ordered so
  // never-attempted exercises come first (exposure control); falls through to
  // INSUFFICIENT_EXERCISES if the pool is too small. `audioReadyFilter` keeps
  // un-synthesized dictation rows out of every pull (no-op for non-dictation
  // rows); `exerciseType`, when set, restricts to a single type (e.g. the
  // dictation-only launcher). When `grammarPointKey` is set, the targeted
  // grammar-point exercises are pulled first; any shortfall is filled from the
  // broader pool (same filters, excluding already-picked ids).
  const baseWhere = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
    audioReadyFilter(exercisesTable),
    ...(exerciseType ? [eq(exercisesTable.type, exerciseType)] : []),
  ];

  let candidateRows;
  if (grammarPointKey) {
    // Over-fetch targeted rows; fill any shortfall from the broader pool.
    const targeted = await db
      .select()
      .from(exercisesTable)
      .where(and(...baseWhere, eq(exercisesTable.grammarPointKey, grammarPointKey)))
      .orderBy(freshFirstOrderBy(userId))
      .limit(OVERFETCH);

    if (targeted.length >= exerciseCount) {
      candidateRows = targeted;
    } else {
      const targetedIds = targeted.map((r: { id: string }) => r.id);
      const topUpWhere = targetedIds.length
        ? [...baseWhere, notInArray(exercisesTable.id, targetedIds)]
        : baseWhere;
      const topUp = await db
        .select()
        .from(exercisesTable)
        .where(and(...topUpWhere))
        .orderBy(freshFirstOrderBy(userId))
        .limit(OVERFETCH - targeted.length);
      candidateRows = mergeSessionRows(targeted, topUp, OVERFETCH);
    }
  } else {
    candidateRows = await db
      .select()
      .from(exercisesTable)
      .where(and(...baseWhere))
      .orderBy(freshFirstOrderBy(userId))
      .limit(OVERFETCH);
  }

  if (candidateRows.length < exerciseCount) {
    return c.json(
      {
        error: 'Not enough exercises in the pool for this filter',
        code: 'INSUFFICIENT_EXERCISES',
        details: { available: candidateRows.length, requested: exerciseCount },
      },
      422,
    );
  }

  // -------------------------------------------------------------------------
  // Error-aware ranking: build context (mastery + 30-day error counts) and
  // reorder the over-fetched candidates. The SQL pre-order (freshFirstOrderBy)
  // is preserved as the stable tiebreak so equal-priority points honour
  // exposure control. Take the top exerciseCount items from the ranked list.
  // -------------------------------------------------------------------------
  const rankCtx = await buildRankContext(db, userId, language, now);
  const draws: import('../lib/today-plan').PoolDraw[] = candidateRows
    .filter((r) => r.type && r.difficulty)
    .map((r) => ({
      id: r.id,
      type: r.type as import('@language-drill/shared').ExerciseType,
      topicHint: null,
      difficulty: r.difficulty as import('@language-drill/shared').CefrLevel,
      grammarPointKey: r.grammarPointKey ?? null,
    }));
  const ranked = rankPlanCandidates(draws, rankCtx);
  const topIds = new Set(ranked.slice(0, exerciseCount).map((d) => d.id));
  const rowById = new Map(candidateRows.map((r) => [r.id, r]));
  const rows = ranked
    .filter((d) => topIds.has(d.id))
    .map((d) => rowById.get(d.id)!);

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

  const exercisesOut = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      type: r.type,
      language: r.language,
      difficulty: r.difficulty,
      grammarPointKey: r.grammarPointKey,
      contentJson: withAudioUrl(r.contentJson, await presignAudioUrl(r.audioS3Key)),
    })),
  );

  return c.json({ id: inserted[0].id, exercises: exercisesOut });
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
// GET /sessions/today — read-only preview of today's plan for the dashboard
// ---------------------------------------------------------------------------
// Two paths:
//   - Path A (hydrate): a practice_sessions row exists for (userId, language)
//     started today (UTC) → return its items with `done`/`queued` statuses,
//     populating `summary` when every kept item is done AND completedAt is set.
//   - Path B (fresh):    no today-session → draw 5 exercises from the pool
//     using V1_PLAN_SHAPE and return them as queued.
//
// Performance budget: ≤ 2 SQL round-trips on most days. Query 1 (today-session
// lookup) and the proficiency-level fetch share one RTT via Promise.all; Path
// B's pool sample is the second. On a language's free-writing cadence day
// (~1/3 of days) one extra indexed lookup gates the freeWriting block.
// ---------------------------------------------------------------------------
sessions.get('/sessions/today', async (c) => {
  const queryResult = TodayQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.flatten(),
      },
      400,
    );
  }

  const { language } = queryResult.data;
  const userId = c.get('userId');
  const dayStart = startOfUtcDay(new Date());

  // Lookback window for per-point error counts — mirrors the progress/curriculum endpoint.
  const errorSince = new Date(Date.now() - 30 * 86_400_000);

  // -------------------------------------------------------------------------
  // Query 1 (parallel): today's session + proficiency level + daily-minutes prefs + error counts
  // -------------------------------------------------------------------------
  const [todayRows, profileRows, prefsRows, errorRows] = await Promise.all([
    db
      .select({
        sessionId: practiceSessions.id,
        exerciseIds: practiceSessions.exerciseIds,
        exerciseCount: practiceSessions.exerciseCount,
        correctCount: practiceSessions.correctCount,
        startedAt: practiceSessions.startedAt,
        completedAt: practiceSessions.completedAt,
      })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          eq(practiceSessions.language, language),
          gte(practiceSessions.startedAt, dayStart),
        ),
      )
      .orderBy(desc(practiceSessions.startedAt))
      .limit(1),
    db
      .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
      .from(userLanguageProfiles)
      .where(
        and(
          eq(userLanguageProfiles.userId, userId),
          eq(userLanguageProfiles.language, language),
        ),
      )
      .limit(1),
    db
      .select({ dailyMinutes: userPreferences.dailyMinutes })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1),
    db
      .select({
        key: sql<string>`COALESCE(${errorObservations.errorGrammarPointKey}, ${errorObservations.hostGrammarPointKey})`,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(errorObservations)
      .where(
        and(
          eq(errorObservations.userId, userId),
          eq(errorObservations.language, language),
          gte(errorObservations.occurredAt, errorSince),
        ),
      )
      .groupBy(
        sql`COALESCE(${errorObservations.errorGrammarPointKey}, ${errorObservations.hostGrammarPointKey})`,
      ),
  ]);

  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;

  // Daily goal target from the user's preferences (null → default 8 items).
  const dailyMinutes = prefsRows[0]?.dailyMinutes ?? null;

  // Per-point error count map for the last 30 days — used by both rank and reasonFor.
  const errorCountByPoint = new Map<string, number>();
  for (const r of errorRows) {
    if (r.key) errorCountByPoint.set(r.key, Number(r.n));
  }

  // -------------------------------------------------------------------------
  // Mastery rows — fetched early so both Path A and Path B can compute `reason`.
  // -------------------------------------------------------------------------
  const masteryRows = await db
    .select({
      grammarPointKey: userGrammarMastery.grammarPointKey,
      masteryScore: userGrammarMastery.masteryScore,
      lastPracticedAt: userGrammarMastery.lastPracticedAt,
    })
    .from(userGrammarMastery)
    .where(
      and(
        eq(userGrammarMastery.userId, userId),
        eq(userGrammarMastery.language, language),
      ),
    );

  const masteryByPoint = new Map<string, PointMastery>(
    masteryRows.map((r) => [
      r.grammarPointKey,
      { masteryScore: r.masteryScore, lastPracticedAt: new Date(r.lastPracticedAt) },
    ]),
  );

  // Shared rank context (both paths use it for reasonFor; Path B also uses it for ranking).
  const rankCtx: RankContext = {
    masteryByPoint,
    errorCountByPoint,
    prereqsOf: (key) => getGrammarPoint(key)?.prerequisiteKeys ?? [],
    now: new Date(),
  };

  // -------------------------------------------------------------------------
  // Free-writing block (Plan 1)
  // -------------------------------------------------------------------------
  // On this language's cadence day, surface a free-writing block — but only if
  // an approved free-writing exercise exists for (language, level), so the
  // block never links to a page with no prompt. Runs on ~1/3 of dashboard
  // loads; one extra indexed lookup, sequential after proficiency since it
  // depends on the resolved level. Independent of Path A/B — the block reflects
  // today's nudge whether or not the quick-drill session has been started.
  let freeWriting: { estimatedMinutes: number } | null = null;
  if (isFreeWritingDay(new Date(), language)) {
    const fwRows = await db
      .select({ id: exercisesTable.id })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, language),
          eq(exercisesTable.difficulty, proficiencyLevel),
          eq(exercisesTable.type, ExerciseType.FREE_WRITING),
          approvedStatusFilter(exercisesTable),
        ),
      )
      .limit(1);
    if (fwRows.length > 0) {
      freeWriting = {
        estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[ExerciseType.FREE_WRITING],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Path A — hydrate from today's session
  // -------------------------------------------------------------------------
  if (todayRows.length > 0) {
    const session = todayRows[0];
    const exerciseIds = session.exerciseIds ?? [];

    // Single round trip: project the exercise rows joined LEFT to history
    // filtered by sessionId. historyId IS NOT NULL ⇒ user attempted it.
    //
    // Deliberate non-filter on review_status: this read hydrates exercises by
    // stored manifest IDs. A flagged exercise that was already in a session
    // manifest stays in that session; filtering would create a phantom missing
    // slot for the user. See lib/exercise-filters.ts for the inventory of
    // filtered vs. non-filtered call sites.
    const itemRows = await db
      .select({
        exerciseId: exercisesTable.id,
        type: exercisesTable.type,
        topicHint: sql<string | null>`${exercisesTable.contentJson}->>'topicHint'`,
        grammarPointKey: exercisesTable.grammarPointKey,
        difficulty: exercisesTable.difficulty,
        historyId: userExerciseHistory.id,
      })
      .from(exercisesTable)
      .leftJoin(
        userExerciseHistory,
        and(
          eq(userExerciseHistory.exerciseId, exercisesTable.id),
          eq(userExerciseHistory.sessionId, session.sessionId),
        ),
      )
      .where(inArray(exercisesTable.id, exerciseIds));

    const exercisesMap = new Map<
      string,
      { type: ExerciseType; topicHint: string | null; grammarPointKey: string | null; difficulty: CefrLevel }
    >();
    const attemptedIds = new Set<string>();
    for (const row of itemRows) {
      if (!row.type || !isExerciseType(row.type)) continue;
      if (!row.difficulty || !isCefrLevel(row.difficulty)) continue;
      exercisesMap.set(row.exerciseId, {
        type: row.type,
        topicHint: row.topicHint,
        grammarPointKey: row.grammarPointKey,
        difficulty: row.difficulty,
      });
      if (row.historyId !== null) attemptedIds.add(row.exerciseId);
    }

    const { items, summary } = hydrateFromSession({
      session: {
        id: session.sessionId,
        exerciseIds,
        exerciseCount: session.exerciseCount,
        correctCount: session.correctCount,
        startedAt: new Date(session.startedAt as Date),
        completedAt: session.completedAt
          ? new Date(session.completedAt as Date)
          : null,
      },
      exercises: exercisesMap,
      attemptedIds,
    });

    return c.json({
      language,
      generatedAt: new Date().toISOString(),
      totalEstimatedMinutes: items.reduce(
        (sum, it) => sum + it.estimatedMinutes,
        0,
      ),
      items: items.map((it) => toWireItem(it, rankCtx)),
      summary,
      code: null,
      resumeSessionId: session.completedAt === null ? session.sessionId : null,
      freeWriting,
    });
  }

  // -------------------------------------------------------------------------
  // Path B — compose a fresh plan from the pool, sized by daily-minutes goal.
  // -------------------------------------------------------------------------
  // The sample over-fetches distinct candidates per type so composeFreshPlan
  // can backfill a slot whose native type is missing (see its doc comment).
  // Pool draw and mastery rows were already fetched above; rank candidates
  // (exposure order is preserved as the tiebreak) before composing — so each
  // slot picks the highest-priority item of its type.
  const draws = await sampleFreshPool({ language, difficulty: proficiencyLevel, userId });

  const ranked = rankPlanCandidates(draws, rankCtx);

  const size = targetItemCount(dailyMinutes);
  const { items, insufficient } = composeFreshPlan(ranked, planSkeleton(size));

  const generatedAt = new Date().toISOString();

  if (insufficient) {
    return c.json({
      language,
      generatedAt,
      totalEstimatedMinutes: 0,
      items: [],
      summary: null,
      code: 'INSUFFICIENT_POOL' as const,
      resumeSessionId: null,
      freeWriting,
    });
  }

  return c.json({
    language,
    generatedAt,
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items: items.map((it) => toWireItem(it, rankCtx)),
    summary: null,
    code: null,
    resumeSessionId: null,
    freeWriting,
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id — fetch a session's manifest + attempt state for resume
// ---------------------------------------------------------------------------
sessions.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Invalid session id', code: 'VALIDATION_ERROR', details: idResult.error.flatten() },
      400,
    );
  }

  // Ownership in the predicate: cross-user / unknown both collapse to 404.
  const sessionRows = await db
    .select({
      id: practiceSessions.id,
      exerciseIds: practiceSessions.exerciseIds,
      completedAt: practiceSessions.completedAt,
    })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.id, id), eq(practiceSessions.userId, userId)))
    .limit(1);

  if (sessionRows.length === 0) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, 404);
  }

  const session = sessionRows[0];
  const exerciseIds = (session.exerciseIds ?? []) as string[];

  // Manifest rows (no review_status filter — see Path A rationale) + attempted set.
  const [rows, historyRows] = await Promise.all([
    db
      .select()
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds)),
    db
      .selectDistinct({ exerciseId: userExerciseHistory.exerciseId })
      .from(userExerciseHistory)
      .where(eq(userExerciseHistory.sessionId, id)),
  ]);

  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const exercises = await Promise.all(
    exerciseIds
      .map((eid) => rowMap.get(eid))
      .filter((r): r is NonNullable<typeof r> => r != null) // drop deleted exercises
      .map(async (r) => ({
        id: r.id,
        type: r.type,
        language: r.language,
        difficulty: r.difficulty,
        grammarPointKey: r.grammarPointKey,
        contentJson: withAudioUrl(r.contentJson, await presignAudioUrl(r.audioS3Key)),
      })),
  );

  const attemptedExerciseIds = historyRows.map((h) => h.exerciseId);

  // Resume must always reflect live attempt-state — never let an intermediary
  // cache a stale manifest (matches the route's error paths and the api-client
  // hook, which sets no staleTime).
  c.header('Cache-Control', 'no-store');
  return c.json({
    id: session.id,
    exercises,
    attemptedExerciseIds,
    completedAt: session.completedAt ? new Date(session.completedAt as Date).toISOString() : null,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OVERFETCH_PER_TYPE = 20; // give ranking real choice per type

/**
 * Path B's pool sample: for each distinct exercise type in V1_PLAN_SHAPE, draws
 * up to `OVERFETCH_PER_TYPE` distinct rows via UNION-ALL (one exposure-ordered
 * LIMIT-N select per type). Over-fetching lets `composeFreshPlan` backfill a
 * slot whose native type is missing with a distinct exercise of another type;
 * it returns `insufficient: true` only when the pool yields no rows at all.
 *
 * Exercises are ordered by `freshFirstOrderBy` (never-attempted first, then
 * least-recently-seen) so the user is always shown fresh content before repeats.
 */
async function sampleFreshPool(params: {
  language: string;
  difficulty: CefrLevel;
  userId: string;
}): Promise<PoolDraw[]> {
  const { language, difficulty, userId } = params;
  const levels = levelsAtOrBelow(difficulty);
  const planTypes = [...new Set(V1_PLAN_SHAPE.map((slot) => slot.type))];
  const typeQueries = planTypes.map(
    (type) => sql`
      (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty, grammar_point_key
       FROM exercises
       WHERE language = ${language}
         AND difficulty = ANY(ARRAY[${sql.join(levels.map((l) => sql`${l}`), sql`, `)}]::text[])
         AND type = ${type}
         AND review_status IN ('auto-approved', 'manual-approved')
         -- Never draw a dictation row whose audio hasn't been synthesized yet
         -- (audio_s3_key IS NULL). Non-dictation rows are unaffected. Defensive:
         -- dictation isn't in V1_PLAN_SHAPE today, but the gate must hold if it
         -- is ever added. Mirrors lib/exercise-filters.ts audioReadyFilter.
         AND (type <> 'dictation' OR audio_s3_key IS NOT NULL)
       ORDER BY ${freshFirstOrderBy(userId)}
       LIMIT ${OVERFETCH_PER_TYPE})
    `,
  );
  const unionSql = sql.join(typeQueries, sql` UNION ALL `);

  const result = await db.execute(unionSql);
  const rows = (result as unknown as {
    rows: Array<{
      id: string;
      type: string;
      topic_hint: string | null;
      difficulty: string;
      grammar_point_key: string | null;
    }>;
  }).rows;

  const draws: PoolDraw[] = [];
  for (const row of rows) {
    if (!isExerciseType(row.type)) continue;
    if (!isCefrLevel(row.difficulty)) continue;
    draws.push({
      id: row.id,
      type: row.type,
      topicHint: row.topic_hint,
      difficulty: row.difficulty,
      grammarPointKey: row.grammar_point_key,
    });
  }
  return draws;
}

/** Maps an in-memory PlanItem to the wire shape consumed by useTodayPlan. */
function toWireItem(item: PlanItem, ctx: RankContext) {
  return {
    index: item.index,
    type: item.type,
    topicHint: item.topicHint,
    grammarPointKey: item.grammarPointKey,
    // Resolve the curriculum display name server-side (same pattern as the
    // debrief route) so the web bundle never imports the curriculum. The
    // timeline subtitle prefers this over the free-text topicHint (decision D5).
    grammarPointName: item.grammarPointKey
      ? (getGrammarPoint(item.grammarPointKey)?.name ?? null)
      : null,
    difficulty: item.difficulty,
    itemCount: item.itemCount,
    estimatedMinutes: item.estimatedMinutes,
    status: item.status,
    reason: reasonFor(item.grammarPointKey, ctx),
  };
}

const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));
function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === 'string' && CEFR_LEVELS.has(value);
}

/**
 * Returns all CEFR levels at or below the given level (inclusive), in
 * ascending order. Used by `sampleFreshPool` to include lower-level exercises
 * that a learner at this level can still benefit from drilling.
 *
 * A1→[A1]; A2→[A1,A2]; B1→[A1,A2,B1]; B2→[A1,A2,B1,B2]; etc.
 *
 * Exported for unit testing — pure function with no dependencies.
 */
export const CEFR_LEVEL_ORDER: readonly CefrLevel[] = [
  CefrLevel.A1,
  CefrLevel.A2,
  CefrLevel.B1,
  CefrLevel.B2,
  CefrLevel.C1,
  CefrLevel.C2,
];

export function levelsAtOrBelow(level: CefrLevel): CefrLevel[] {
  const idx = CEFR_LEVEL_ORDER.indexOf(level);
  if (idx === -1) return [level];
  return CEFR_LEVEL_ORDER.slice(0, idx + 1) as CefrLevel[];
}

const EXERCISE_TYPES = new Set<string>(Object.values(ExerciseType));
function isExerciseType(value: string): value is ExerciseType {
  return EXERCISE_TYPES.has(value);
}

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
  grammar_point_key: string | null;
  content_json: unknown;
  audio_s3_key: string | null;
  history_id: string | null;
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
    // Forensic log: the 404 collapses cross-user / unknown / not-completed by
    // design (NFR Security), but in production we want to know which axis
    // tripped a real user. Greppable by `event:debrief.not_found`.
    console.warn(
      'debrief: session row not found for ownership+completion predicate',
      { event: 'debrief.not_found', sessionId: id, userId },
    );
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
  //
  // Deliberate non-filter on review_status: like Path A above, this hydrates
  // exercises by IDs already committed to a practice_sessions manifest.
  // Filtering would drop a flagged exercise from a completed session's debrief
  // view — wrong UX. See lib/exercise-filters.ts for the inventory.
  // Drizzle's `sql\`\`` interpolates a JS array as a positional record
  // `($N, $N+1, …)` — a Postgres ROW, not an array. `ANY(record)` is invalid
  // syntax (`op ANY/ALL (array) requires array on right side`). `IN (record)`
  // accepts the same record shape, so we use IN here. See bug
  // `.claude/bugs/debrief-items-query-failure/`.
  const itemsResult = await db.execute(sql`
    SELECT e.id AS exercise_id, e.type, e.grammar_point_key, e.content_json,
           e.audio_s3_key,
           h.id AS history_id, h.score, h.response_json
    FROM exercises e
    LEFT JOIN (
      SELECT DISTINCT ON (exercise_id)
             id, exercise_id, score, response_json, evaluated_at
      FROM user_exercise_history
      WHERE session_id = ${id}
      ORDER BY exercise_id, evaluated_at DESC NULLS LAST
    ) h ON h.exercise_id = e.id
    WHERE e.id IN ${exerciseIds}
  `);

  // Drizzle's neon-serverless `db.execute` returns the pg-style QueryResult,
  // typed loosely. Narrow it to the projected shape via cast.
  const itemRows = itemsResult.rows as unknown as DebriefItemRow[];

  // Build a lookup so we can iterate the manifest in order (Req 2.1).
  const rowMap = new Map<string, DebriefItemRow>();
  for (const row of itemRows) {
    rowMap.set(row.exercise_id, row);
  }

  const items = (
    await Promise.all(
      exerciseIds.map(async (exerciseId) => {
        const row = rowMap.get(exerciseId);
        if (!row) return null; // exercise rows are immutable; defensive only

        // Dictation items get a presigned audioUrl injected into contentJson so
        // the debrief can replay the clip (mirrors POST /sessions). Non-dictation
        // content is returned unchanged. presignAudioUrl returns null when the
        // key is absent / bucket env unset, and withAudioUrl then leaves audioUrl
        // absent — never throws.
        const contentJson =
          row.type === ExerciseType.DICTATION
            ? withAudioUrl(row.content_json, await presignAudioUrl(row.audio_s3_key))
            : row.content_json;

        const hasHistory = row.score !== null && row.score !== undefined;
        if (!hasHistory) {
          return {
            exerciseId,
            submissionId: null,
            type: row.type as ExerciseType,
            grammarPointKey: row.grammar_point_key,
            grammarPointName: row.grammar_point_key
              ? (getGrammarPoint(row.grammar_point_key)?.name ?? null)
              : null,
            contentJson,
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
          submissionId: row.history_id,
          type: row.type as ExerciseType,
          grammarPointKey: row.grammar_point_key,
          grammarPointName: row.grammar_point_key
            ? (getGrammarPoint(row.grammar_point_key)?.name ?? null)
            : null,
          contentJson,
          status,
          userAnswer,
          score,
          evaluation,
        };
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);

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

  // --- Skill movements (design spec 2026-06-16) ---------------------------
  // Affected points = grammar points the session graded (non-skipped, keyed).
  const affectedLabels = new Map<string, string>();
  for (const it of items) {
    if (it.status !== 'skipped' && it.grammarPointKey) {
      affectedLabels.set(it.grammarPointKey, getGrammarPoint(it.grammarPointKey)?.name ?? it.grammarPointKey);
    }
  }
  let skillMovements: SkillMovement[] = [];
  if (affectedLabels.size > 0) {
    const histRows = await db
      .select({
        id: userExerciseHistory.id,
        sessionId: userExerciseHistory.sessionId,
        grammarPointKey: exercisesTable.grammarPointKey,
        difficulty: exercisesTable.difficulty,
        score: userExerciseHistory.score,
        evaluatedAt: userExerciseHistory.evaluatedAt,
      })
      .from(userExerciseHistory)
      .innerJoin(exercisesTable, eq(userExerciseHistory.exerciseId, exercisesTable.id))
      .where(
        and(
          eq(userExerciseHistory.userId, userId),
          eq(exercisesTable.language, session.language),
          inArray(exercisesTable.grammarPointKey, [...affectedLabels.keys()]),
          isNotNull(userExerciseHistory.score),
          isNotNull(userExerciseHistory.evaluatedAt),
          isNotNull(exercisesTable.difficulty),
        ),
      );
    const rows: SkillHistoryRow[] = histRows.map((r) => ({
      id: r.id,
      grammarPointKey: r.grammarPointKey as string,
      score: r.score as number,
      difficulty: r.difficulty as CefrLevel,
      evaluatedAt: r.evaluatedAt as Date,
    }));
    const sessionRowIds = new Set(histRows.filter((r) => r.sessionId === session.id).map((r) => r.id));
    skillMovements = computeSkillMovements({ rows, sessionRowIds, labels: affectedLabels });
  }

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
    skillMovements,
  });
});

export default sessions;
