import { randomInt, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import {
  ALL_CURRICULA,
  adminAuditLog,
  buildCellKey,
  buildCellKeyFromRow,
  enumerateCurriculumCells,
  exercises,
  generationJobs,
  invitations,
  requireEnv,
  targetCellSize,
  theoryTopics,
  userExerciseHistory,
} from '@language-drill/db';
import { normalizeFlaggedReasons } from '@language-drill/shared';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { db } from '../db';
import { resolveCellTarget } from '../generation/cell-targets';
import { parseGenerationJobMessage, type GenerationJobMessage } from '../generation/job-message';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';
import { recordAdminAction } from '../lib/admin-audit';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const PoolStatusQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

admin.use('/admin/*', authMiddleware, adminMiddleware);

// ---------------------------------------------------------------------------
// GET /admin/pool-status — per-cell exercise counts, last refill, depletion
// ---------------------------------------------------------------------------
admin.get('/admin/pool-status', async (c) => {
  const parsed = PoolStatusQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { language, level } = parsed.data;

  // Four aggregating queries in parallel — the in-memory cell list filters
  // the response shape, so each query stays a single index-friendly aggregate
  // rather than per-cell round-trips. The fourth (coverage) uses a raw
  // db.execute with a LATERAL unnest that the Drizzle query builder cannot
  // express; it runs alongside the three builder queries rather than serially.
  const [countRows, lastRefilledRows, depletionRows, coverageResult] = await Promise.all([
    db
      .select({
        language: exercises.language,
        difficulty: exercises.difficulty,
        type: exercises.type,
        grammarPointKey: exercises.grammarPointKey,
        approved: sql<number>`COUNT(*) FILTER (WHERE ${exercises.reviewStatus} IN ('auto-approved', 'manual-approved'))::int`,
        flagged: sql<number>`COUNT(*) FILTER (WHERE ${exercises.reviewStatus} = 'flagged')::int`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE ${exercises.reviewStatus} = 'rejected')::int`,
      })
      .from(exercises)
      .where(isNotNull(exercises.grammarPointKey))
      .groupBy(
        exercises.language,
        exercises.difficulty,
        exercises.type,
        exercises.grammarPointKey,
      ),
    db
      .select({
        cellKey: generationJobs.cellKey,
        // `.mapWith(finishedAt)` reuses the column's timestamptz→Date decoder
        // for the aggregate; the `sql<Date | null>` cast alone is types-only
        // and the Neon driver returns raw `MAX(timestamptz)` as a string.
        lastRefilledAt: sql<Date | null>`MAX(${generationJobs.finishedAt})`.mapWith(
          generationJobs.finishedAt,
        ),
      })
      .from(generationJobs)
      .where(eq(generationJobs.status, 'succeeded'))
      .groupBy(generationJobs.cellKey),
    db
      .select({
        language: exercises.language,
        difficulty: exercises.difficulty,
        type: exercises.type,
        grammarPointKey: exercises.grammarPointKey,
        consumed7d: sql<number>`COUNT(*)::int`,
      })
      .from(userExerciseHistory)
      .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
      .where(
        and(
          gte(userExerciseHistory.evaluatedAt, sql`NOW() - INTERVAL '7 days'`),
          isNotNull(exercises.grammarPointKey),
        ),
      )
      .groupBy(
        exercises.language,
        exercises.difficulty,
        exercises.type,
        exercises.grammarPointKey,
      ),
    db.execute(sql`
      SELECT
        language,
        difficulty,
        type,
        grammar_point_key AS "grammarPointKey",
        tag.key   AS axis,
        tag.value AS value,
        COUNT(*)::int AS n
      FROM exercises
      CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
      WHERE review_status IN ('auto-approved', 'manual-approved')
        AND coverage_tags IS NOT NULL
      GROUP BY language, difficulty, type, grammar_point_key, tag.key, tag.value
    `),
  ]);
  const coverageRows = coverageResult.rows as unknown as Array<{
    language: string;
    difficulty: string;
    type: string;
    grammarPointKey: string;
    axis: string;
    value: string;
    n: number;
  }>;

  // Build O(1) lookup maps keyed by canonical cell key.
  const countByCell = new Map<
    string,
    { approved: number; flagged: number; rejected: number }
  >();
  for (const row of countRows) {
    countByCell.set(buildCellKeyFromRow(row), {
      approved: row.approved,
      flagged: row.flagged,
      rejected: row.rejected,
    });
  }

  // Drizzle returns `timestamp(..., { withTimezone: true })` columns as Date
  // objects; normalize to ISO strings so the wire shape stays stable across
  // driver versions (rather than relying on JSON.stringify's implicit Date
  // serialization).
  const lastRefilledByCell = new Map<string, string | null>();
  for (const row of lastRefilledRows) {
    lastRefilledByCell.set(
      row.cellKey,
      row.lastRefilledAt ? row.lastRefilledAt.toISOString() : null,
    );
  }

  const consumedByCell = new Map<string, number>();
  for (const row of depletionRows) {
    consumedByCell.set(buildCellKeyFromRow(row), row.consumed7d);
  }

  // Build a nested map: cellKey → axis → value → count. Only cells with at
  // least one tagged approved exercise appear; all others resolve to null below.
  const coverageByCell = new Map<
    string,
    Record<string, Record<string, number>>
  >();
  for (const row of coverageRows) {
    const cellKey = buildCellKeyFromRow(row);
    const dist = coverageByCell.get(cellKey) ?? {};
    const axisMap = dist[row.axis] ?? {};
    axisMap[row.value] = row.n;
    dist[row.axis] = axisMap;
    coverageByCell.set(cellKey, dist);
  }

  // Enumerate the full cell universe, filter by requested params, and merge
  // the DB results in. Cells with zero exercises stay in the response — they
  // are the ones most urgent to refill.
  const allCells = enumerateCurriculumCells(ALL_CURRICULA).filter((cell) => {
    if (language && cell.language !== language) return false;
    if (level && cell.cefrLevel !== level) return false;
    return true;
  });

  const items = allCells.map((cell) => {
    const cellKey = buildCellKey({
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
    });
    const counts = countByCell.get(cellKey) ?? {
      approved: 0,
      flagged: 0,
      rejected: 0,
    };
    const consumed7d = consumedByCell.get(cellKey) ?? 0;
    const depletionRate7d = Math.round((consumed7d / 7) * 10) / 10;
    return {
      language: cell.language,
      level: cell.cefrLevel,
      type: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      approved: counts.approved,
      flagged: counts.flagged,
      rejected: counts.rejected,
      lastRefilledAt: lastRefilledByCell.get(cellKey) ?? null,
      depletionRate7d,
      // `targetSize` is the demand-derived ideal pool size (depletion tiers,
      // floors at 50 for idle cells). `generationTarget` is what the scheduler
      // actually tops the cell up to (`resolveCellTarget`: per-cell R3 target,
      // e.g. 20 for A1 cloze). Both are surfaced so the dashboard's coverage
      // reflects the real generation goal, and a generationTarget below
      // targetSize flags a cell whose target may need raising.
      targetSize: targetCellSize(depletionRate7d),
      generationTarget: resolveCellTarget(cell),
      coverageDistribution: coverageByCell.get(cellKey) ?? null,
    };
  });

  // Sort lexicographically — A1 < A2 < B1 < B2 holds for the four supported
  // levels; revisit if C1/C2 join the curriculum.
  items.sort((a, b) => {
    if (a.language !== b.language) return a.language < b.language ? -1 : 1;
    if (a.level !== b.level) return a.level < b.level ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.grammarPointKey < b.grammarPointKey ? -1 : 1;
  });

  return c.json(items);
});

// ---------------------------------------------------------------------------
// GET /admin/pool-cell — per-cell curriculum floors + rejection-reason aggregate
// ---------------------------------------------------------------------------

const PoolCellQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  type: z.string().min(1),
  grammarPoint: z.string().min(1),
});

admin.get('/admin/pool-cell', async (c) => {
  const parsed = PoolCellQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint } = parsed.data;
  const cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint });

  const cell = enumerateCurriculumCells(ALL_CURRICULA).find((cc) => cc.cellKey === cellKey);
  const floors: Record<string, Record<string, number>> = {};
  for (const axis of cell?.grammarPoint.coverageSpec?.axes ?? []) {
    const axisFloors: Record<string, number> = {};
    for (const [value, n] of Object.entries(axis.floors)) {
      if (typeof n === 'number') axisFloors[value] = n;
    }
    floors[axis.name] = axisFloors;
  }

  const jobRows = await db
    .select({ rejectionReasonCounts: generationJobs.rejectionReasonCounts })
    .from(generationJobs)
    .where(eq(generationJobs.cellKey, cellKey));
  const rejectionReasonCounts: Record<string, number> = {};
  for (const row of jobRows) {
    const counts = row.rejectionReasonCounts as Record<string, number> | null;
    if (!counts) continue;
    for (const [code, n] of Object.entries(counts)) {
      if (typeof n === 'number') rejectionReasonCounts[code] = (rejectionReasonCounts[code] ?? 0) + n;
    }
  }

  return c.json({ floors, rejectionReasonCounts });
});

// ---------------------------------------------------------------------------
// GET /admin/generation-stats — cost spend, batch outcomes, approval rates
// ---------------------------------------------------------------------------

type GenerationJobStatus = 'succeeded' | 'failed' | 'running' | 'queued';
const JOB_STATUSES: readonly GenerationJobStatus[] = [
  'succeeded',
  'failed',
  'running',
  'queued',
];

admin.get('/admin/generation-stats', async (c) => {
  const [costRows, statusCountRows, approvalRows] = await Promise.all([
    // Q1 — cost this week + this month. SUM of zero rows is NULL, so COALESCE
    // keeps the wire shape stable for an empty `generation_jobs` table.
    db
      .select({
        weekCost: sql<string>`COALESCE(SUM(${generationJobs.costUsdEstimate}) FILTER (WHERE ${generationJobs.startedAt} >= NOW() - INTERVAL '7 days'), 0)`,
        monthCost: sql<string>`COALESCE(SUM(${generationJobs.costUsdEstimate}) FILTER (WHERE ${generationJobs.startedAt} >= DATE_TRUNC('month', NOW())), 0)`,
      })
      .from(generationJobs),
    // Q2 — job counts by status (7d). Statuses absent from the result default
    // to 0 in the merge step below.
    db
      .select({
        status: generationJobs.status,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(generationJobs)
      .where(gte(generationJobs.startedAt, sql`NOW() - INTERVAL '7 days'`))
      .groupBy(generationJobs.status),
    // Q3 — approval counts per cellKey (30d). Aggregation by (language,
    // level, type) — across grammar points — happens in JS after parsing the
    // cellKey, since `generationJobs` doesn't store the components separately.
    // `dedupGivenUp` is pulled separately so the approval-rate denominator can
    // back it out — dedup-give-ups are search-space exhaustion, not a quality
    // signal. `rejectedCount` already includes dedup per the runOneCell
    // contract; subtracting `dedupGivenUpCount` gives the validator-only
    // rejected count.
    db
      .select({
        cellKey: generationJobs.cellKey,
        approved: sql<number>`SUM(${generationJobs.approvedCount})::int`,
        flagged: sql<number>`SUM(${generationJobs.flaggedCount})::int`,
        rejected: sql<number>`SUM(${generationJobs.rejectedCount})::int`,
        dedupGivenUp: sql<number>`SUM(${generationJobs.dedupGivenUpCount})::int`,
      })
      .from(generationJobs)
      .where(gte(generationJobs.startedAt, sql`NOW() - INTERVAL '30 days'`))
      .groupBy(generationJobs.cellKey),
  ]);

  // Drizzle returns Postgres `numeric` as string — parse to Number for JSON.
  const costRow = costRows[0];
  const costThisWeekUsd = parseFloat(costRow?.weekCost ?? '0');
  const costThisMonthUsd = parseFloat(costRow?.monthCost ?? '0');

  const jobsThisWeek: Record<GenerationJobStatus, number> = {
    succeeded: 0,
    failed: 0,
    running: 0,
    queued: 0,
  };
  for (const row of statusCountRows) {
    if ((JOB_STATUSES as readonly string[]).includes(row.status)) {
      jobsThisWeek[row.status as GenerationJobStatus] = row.cnt;
    }
  }

  // Aggregate Q3 across grammar points: cellKey is `<lang>:<level>:<type>:<gp>`
  // so splitting on `:` gives the three components we want to group on.
  const approvalAgg = new Map<
    string,
    {
      language: string;
      level: string;
      type: string;
      approvedCount: number;
      flaggedCount: number;
      rejectedCount: number;
      dedupGivenUpCount: number;
    }
  >();
  for (const row of approvalRows) {
    const parts = row.cellKey.split(':');
    if (parts.length < 4) continue;
    const language = parts[0].toUpperCase();
    const level = parts[1].toUpperCase();
    const type = parts[2];
    const groupKey = `${language}:${level}:${type}`;
    const existing = approvalAgg.get(groupKey) ?? {
      language,
      level,
      type,
      approvedCount: 0,
      flaggedCount: 0,
      rejectedCount: 0,
      dedupGivenUpCount: 0,
    };
    existing.approvedCount += row.approved;
    existing.flaggedCount += row.flagged;
    existing.rejectedCount += row.rejected;
    existing.dedupGivenUpCount += row.dedupGivenUp;
    approvalAgg.set(groupKey, existing);
  }

  const approvalRates = [...approvalAgg.values()]
    .map((entry) => {
      // Validator-only rejected: back out dedup-give-ups, which are search-
      // space exhaustion, not a quality verdict. `Math.max(0, …)` defends
      // against the rare case where pre-column historical rows have
      // dedupGivenUp > rejected (shouldn't happen with current writers, but
      // wrong-by-construction beats divide-by-negative).
      const plainRejected = Math.max(
        0,
        entry.rejectedCount - entry.dedupGivenUpCount,
      );
      const total =
        entry.approvedCount + entry.flaggedCount + plainRejected;
      return {
        ...entry,
        total,
        approvalRate:
          total === 0 ? 0 : Math.round((entry.approvedCount / total) * 1000) / 1000,
      };
    })
    .filter((entry) => entry.total > 0)
    .map(({ total: _total, ...rest }) => rest);

  return c.json({
    costThisWeekUsd,
    costThisMonthUsd,
    jobsThisWeek,
    approvalRates,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/theory/coverage — 12-row coverage of approved/flagged theory rows
// joined against the curriculum's grammar-point count per (language, level).
// Always 12 rows (3 languages × 4 levels), even when both counts are zero —
// the client decides how to render zero-total cells.
// ---------------------------------------------------------------------------

const COVERAGE_LANGUAGES = ['ES', 'DE', 'TR'] as const;
const COVERAGE_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

type CoverageLanguage = (typeof COVERAGE_LANGUAGES)[number];
type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/**
 * Curriculum denominator per (language, level): the count of distinct grammar
 * points. `enumerateCurriculumCells` returns one cell per (grammarPoint,
 * exerciseType) pair — for theory we collapse to distinct grammar points by
 * deduping on `grammarPoint.key`.
 */
function theoryCurriculumTotals(): Map<string, number> {
  const totals = new Map<string, Set<string>>();
  for (const cell of enumerateCurriculumCells(ALL_CURRICULA)) {
    if (cell.grammarPoint.kind !== 'grammar') continue;
    const key = `${cell.language}:${cell.cefrLevel}`;
    let set = totals.get(key);
    if (!set) {
      set = new Set<string>();
      totals.set(key, set);
    }
    set.add(cell.grammarPoint.key);
  }
  const result = new Map<string, number>();
  for (const [key, set] of totals) {
    result.set(key, set.size);
  }
  return result;
}

admin.get('/admin/theory/coverage', async (c) => {
  const aggregateRows = await db
    .select({
      language: theoryTopics.language,
      level: theoryTopics.cefrLevel,
      approved: sql<number>`COUNT(*) FILTER (WHERE ${theoryTopics.reviewStatus} IN ('auto-approved', 'manual-approved'))::int`,
      flagged: sql<number>`COUNT(*) FILTER (WHERE ${theoryTopics.reviewStatus} = 'flagged')::int`,
    })
    .from(theoryTopics)
    .groupBy(theoryTopics.language, theoryTopics.cefrLevel);

  const aggregates = new Map<string, { approved: number; flagged: number }>();
  for (const row of aggregateRows) {
    aggregates.set(`${row.language}:${row.level}`, {
      approved: row.approved,
      flagged: row.flagged,
    });
  }

  const totals = theoryCurriculumTotals();

  const rows: Array<{
    language: CoverageLanguage;
    level: CoverageLevel;
    approved: number;
    flagged: number;
    total: number;
  }> = [];
  for (const language of COVERAGE_LANGUAGES) {
    for (const level of COVERAGE_LEVELS) {
      const key = `${language}:${level}`;
      const agg = aggregates.get(key);
      rows.push({
        language,
        level,
        approved: agg?.approved ?? 0,
        flagged: agg?.flagged ?? 0,
        total: totals.get(key) ?? 0,
      });
    }
  }

  return c.json({ rows });
});

// ---------------------------------------------------------------------------
// GET /admin/content/exercises — list approved exercises (filters + search + pagination)
// GET /admin/content/theory   — list approved theory topics (filters + search + pagination)
// ---------------------------------------------------------------------------

const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

const ContentExercisesQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  type: z.string().optional(),
  grammarPoint: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const ContentTheoryQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  grammarPoint: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

admin.get('/admin/content/exercises', async (c) => {
  const parsed = ContentExercisesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, q, limit, offset } = parsed.data;
  const conds = [inArray(exercises.reviewStatus, [...APPROVED_STATUSES])];
  if (language) conds.push(eq(exercises.language, language));
  if (level) conds.push(eq(exercises.difficulty, level));
  if (type) conds.push(eq(exercises.type, type));
  if (grammarPoint) conds.push(eq(exercises.grammarPointKey, grammarPoint));
  if (q) conds.push(sql`${exercises.contentJson}::text ILIKE ${'%' + q + '%'}`);
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: exercises.id, language: exercises.language, difficulty: exercises.difficulty,
      type: exercises.type, grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson, coverageTags: exercises.coverageTags,
      qualityScore: exercises.qualityScore, generationSource: exercises.generationSource,
      modelId: exercises.modelId, reviewStatus: exercises.reviewStatus, generatedAt: exercises.generatedAt,
    }).from(exercises).where(where)
      .orderBy(sql`${exercises.generatedAt} DESC NULLS LAST`)
      .limit(limit ?? 25).offset(offset ?? 0),
    db.select({ count: count() }).from(exercises).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.difficulty, type: r.type,
    grammarPointKey: r.grammarPointKey, contentJson: stripDedupKey(r.contentJson),
    coverageTags: r.coverageTags, qualityScore: r.qualityScore,
    generationSource: r.generationSource, modelId: r.modelId, reviewStatus: r.reviewStatus,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

admin.get('/admin/content/theory', async (c) => {
  const parsed = ContentTheoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, grammarPoint, q, limit, offset } = parsed.data;
  const conds = [inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES])];
  if (language) conds.push(eq(theoryTopics.language, language));
  if (level) conds.push(eq(theoryTopics.cefrLevel, level));
  if (grammarPoint) conds.push(eq(theoryTopics.grammarPointKey, grammarPoint));
  if (q) conds.push(sql`${theoryTopics.contentJson}::text ILIKE ${'%' + q + '%'}`);
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: theoryTopics.id, language: theoryTopics.language, cefrLevel: theoryTopics.cefrLevel,
      grammarPointKey: theoryTopics.grammarPointKey, topicId: theoryTopics.topicId,
      contentJson: theoryTopics.contentJson, qualityScore: theoryTopics.qualityScore,
      generationSource: theoryTopics.generationSource, modelId: theoryTopics.modelId,
      reviewStatus: theoryTopics.reviewStatus, generatedAt: theoryTopics.generatedAt,
    }).from(theoryTopics).where(where)
      .orderBy(sql`${theoryTopics.generatedAt} DESC NULLS LAST`)
      .limit(limit ?? 25).offset(offset ?? 0),
    db.select({ count: count() }).from(theoryTopics).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.cefrLevel, grammarPointKey: r.grammarPointKey,
    topicId: r.topicId, contentJson: stripDedupKey(r.contentJson), qualityScore: r.qualityScore,
    generationSource: r.generationSource, modelId: r.modelId, reviewStatus: r.reviewStatus,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

// ---------------------------------------------------------------------------
// POST /admin/content/exercises/:id/demote
// POST /admin/content/exercises/:id/reject
// POST /admin/content/theory/:id/demote
// POST /admin/content/theory/:id/reject
// ---------------------------------------------------------------------------

type ContentOutcome = 'demoted' | 'rejected' | 'not_found' | 'already_resolved';

async function transitionContentExercise(id: string, toStatus: 'flagged' | 'rejected'): Promise<ContentOutcome> {
  const updated = await db
    .update(exercises)
    .set({ reviewStatus: toStatus })
    .where(and(eq(exercises.id, id), inArray(exercises.reviewStatus, [...APPROVED_STATUSES])))
    .returning({ id: exercises.id });
  if (updated.length > 0) return toStatus === 'flagged' ? 'demoted' : 'rejected';
  const existing = await db.select({ reviewStatus: exercises.reviewStatus }).from(exercises).where(eq(exercises.id, id)).limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

async function transitionContentTheory(id: string, toStatus: 'flagged' | 'rejected'): Promise<ContentOutcome> {
  const updated = await db
    .update(theoryTopics)
    .set({ reviewStatus: toStatus })
    .where(and(eq(theoryTopics.id, id), inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES])))
    .returning({ id: theoryTopics.id });
  if (updated.length > 0) return toStatus === 'flagged' ? 'demoted' : 'rejected';
  const existing = await db.select({ reviewStatus: theoryTopics.reviewStatus }).from(theoryTopics).where(eq(theoryTopics.id, id)).limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

const ContentIdSchema = z.string().uuid();

const EFFECTIVE_CONTENT = new Set<ContentOutcome>(['demoted', 'rejected']);

for (const action of ['demote', 'reject'] as const) {
  const toStatus = action === 'demote' ? ('flagged' as const) : ('rejected' as const);
  const auditAction = action === 'demote' ? ('content.demote' as const) : ('content.reject' as const);
  admin.post(`/admin/content/exercises/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    const outcome = await transitionContentExercise(idParsed.data, toStatus);
    if (EFFECTIVE_CONTENT.has(outcome)) {
      await recordAdminAction(db, { adminUserId: c.get('userId'), action: auditAction, targetType: 'exercise', targetId: idParsed.data, metadata: { outcome } });
    }
    return c.json({ outcome });
  });
  admin.post(`/admin/content/theory/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    const outcome = await transitionContentTheory(idParsed.data, toStatus);
    if (EFFECTIVE_CONTENT.has(outcome)) {
      await recordAdminAction(db, { adminUserId: c.get('userId'), action: auditAction, targetType: 'theory_topic', targetId: idParsed.data, metadata: { outcome } });
    }
    return c.json({ outcome });
  });
}

// ---------------------------------------------------------------------------
// GET /admin/flagged/exercises — list exercises awaiting moderation
// GET /admin/flagged/theory   — list theory topics awaiting moderation
// ---------------------------------------------------------------------------

const FlaggedExercisesQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  type: z.string().optional(),
  grammarPoint: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const FlaggedTheoryQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  grammarPoint: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function stripDedupKey(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content;
  const { _dedupKey, ...rest } = content as Record<string, unknown>;
  void _dedupKey;
  return rest;
}

admin.get('/admin/flagged/exercises', async (c) => {
  const parsed = FlaggedExercisesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, limit } = parsed.data;
  const conds = [eq(exercises.reviewStatus, 'flagged')];
  if (language) conds.push(eq(exercises.language, language));
  if (level) conds.push(eq(exercises.difficulty, level));
  if (type) conds.push(eq(exercises.type, type));
  if (grammarPoint) conds.push(eq(exercises.grammarPointKey, grammarPoint));
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: exercises.id, language: exercises.language, difficulty: exercises.difficulty,
      type: exercises.type, grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson, qualityScore: exercises.qualityScore,
      flaggedReasons: exercises.flaggedReasons, generatedAt: exercises.generatedAt,
    }).from(exercises).where(where).orderBy(asc(exercises.generatedAt)).limit(limit ?? 100),
    db.select({ count: count() }).from(exercises).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.difficulty, type: r.type,
    grammarPointKey: r.grammarPointKey, contentJson: stripDedupKey(r.contentJson),
    qualityScore: r.qualityScore, flaggedReasons: normalizeFlaggedReasons(r.flaggedReasons),
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

admin.get('/admin/flagged/theory', async (c) => {
  const parsed = FlaggedTheoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, grammarPoint, limit } = parsed.data;
  const conds = [eq(theoryTopics.reviewStatus, 'flagged')];
  if (language) conds.push(eq(theoryTopics.language, language));
  if (level) conds.push(eq(theoryTopics.cefrLevel, level));
  if (grammarPoint) conds.push(eq(theoryTopics.grammarPointKey, grammarPoint));
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: theoryTopics.id, language: theoryTopics.language, cefrLevel: theoryTopics.cefrLevel,
      grammarPointKey: theoryTopics.grammarPointKey, topicId: theoryTopics.topicId,
      contentJson: theoryTopics.contentJson, qualityScore: theoryTopics.qualityScore,
      flaggedReasons: theoryTopics.flaggedReasons, generatedAt: theoryTopics.generatedAt,
    }).from(theoryTopics).where(where).orderBy(asc(theoryTopics.generatedAt)).limit(limit ?? 100),
    db.select({ count: count() }).from(theoryTopics).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.cefrLevel, grammarPointKey: r.grammarPointKey,
    topicId: r.topicId, contentJson: stripDedupKey(r.contentJson), qualityScore: r.qualityScore,
    flaggedReasons: normalizeFlaggedReasons(r.flaggedReasons),
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

// ---------------------------------------------------------------------------
// POST /admin/flagged/exercises/:id/approve  — approve or demote-on-conflict
// POST /admin/flagged/exercises/:id/reject   — reject (preserves flaggedReasons)
// POST /admin/flagged/theory/:id/approve
// POST /admin/flagged/theory/:id/reject
// ---------------------------------------------------------------------------

// Postgres unique-violation detector — mirrors packages/db/scripts/review-flagged.ts
// `isUniqueViolation` (walks `.cause` since the driver wraps the SQLSTATE). Re-implemented
// here because that helper lives in a CLI script not importable from the Lambda bundle.
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof Error && 'code' in current && (current as { code: unknown }).code === '23505') {
      return true;
    }
    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }
    return false;
  }
  return false;
}

type ResolveOutcome = 'approved' | 'rejected' | 'demoted' | 'not_found' | 'already_resolved';

async function resolveExerciseFlagged(
  id: string,
  action: 'approve' | 'reject',
): Promise<ResolveOutcome> {
  const setValues = action === 'approve'
    ? { reviewStatus: 'manual-approved' as const, flaggedReasons: null }
    : { reviewStatus: 'rejected' as const };
  try {
    const updated = await db
      .update(exercises)
      .set(setValues)
      .where(and(eq(exercises.id, id), eq(exercises.reviewStatus, 'flagged')))
      .returning({ id: exercises.id });
    if (updated.length > 0) return action === 'approve' ? 'approved' : 'rejected';
  } catch (err) {
    if (action === 'approve' && isUniqueViolation(err)) {
      await db
        .update(exercises)
        .set({ reviewStatus: 'rejected' as const })
        .where(and(eq(exercises.id, id), eq(exercises.reviewStatus, 'flagged')));
      return 'demoted';
    }
    throw err;
  }
  const existing = await db
    .select({ reviewStatus: exercises.reviewStatus })
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

async function resolveTheoryFlagged(
  id: string,
  action: 'approve' | 'reject',
): Promise<ResolveOutcome> {
  const setValues = action === 'approve'
    ? { reviewStatus: 'manual-approved' as const, flaggedReasons: null }
    : { reviewStatus: 'rejected' as const };
  try {
    const updated = await db
      .update(theoryTopics)
      .set(setValues)
      .where(and(eq(theoryTopics.id, id), eq(theoryTopics.reviewStatus, 'flagged')))
      .returning({ id: theoryTopics.id });
    if (updated.length > 0) return action === 'approve' ? 'approved' : 'rejected';
  } catch (err) {
    if (action === 'approve' && isUniqueViolation(err)) {
      await db
        .update(theoryTopics)
        .set({ reviewStatus: 'rejected' as const })
        .where(and(eq(theoryTopics.id, id), eq(theoryTopics.reviewStatus, 'flagged')));
      return 'demoted';
    }
    throw err;
  }
  const existing = await db
    .select({ reviewStatus: theoryTopics.reviewStatus })
    .from(theoryTopics)
    .where(eq(theoryTopics.id, id))
    .limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

const FlaggedIdSchema = z.string().uuid();

const EFFECTIVE_FLAGGED = new Set<ResolveOutcome>(['approved', 'rejected', 'demoted']);

for (const [kind, resolve] of [
  ['exercises', resolveExerciseFlagged],
  ['theory', resolveTheoryFlagged],
] as const) {
  const targetType = kind === 'exercises' ? ('exercise' as const) : ('theory_topic' as const);
  for (const action of ['approve', 'reject'] as const) {
    admin.post(`/admin/flagged/${kind}/:id/${action}`, async (c) => {
      const idParsed = FlaggedIdSchema.safeParse(c.req.param('id'));
      if (!idParsed.success) {
        return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
      }
      const outcome = await resolve(idParsed.data, action);
      if (EFFECTIVE_FLAGGED.has(outcome)) {
        await recordAdminAction(db, {
          adminUserId: c.get('userId'),
          action: action === 'approve' ? 'flagged.approve' : 'flagged.reject',
          targetType,
          targetId: idParsed.data,
          metadata: { outcome },
        });
      }
      return c.json({ outcome });
    });
  }
}

// ---------------------------------------------------------------------------
// POST /admin/generate — enqueue an admin-triggered generation job
// ---------------------------------------------------------------------------

const ADMIN_PER_CELL_COST_CAP_USD = 2.0;

let sqsClient: SQSClient | null = null;
function getSqsClient(): SQSClient {
  if (!sqsClient) sqsClient = new SQSClient({ region: requireEnv('AWS_REGION') });
  return sqsClient;
}

const GenerateBodySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  type: z.string().min(1),
  grammarPoint: z.string().min(1),
  count: z.coerce.number().int().min(1).max(50),
});

admin.post('/admin/generate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = GenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, count } = parsed.data;

  const cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint });
  const cell = enumerateCurriculumCells(ALL_CURRICULA).find((cc) => cc.cellKey === cellKey);
  if (!cell) {
    return c.json({ error: 'Unknown cell', code: 'INVALID_CELL' }, 400);
  }

  // Best-effort in-flight guard: the consumer inserts the generation_jobs row only after it
  // dequeues, so two near-simultaneous admin requests for the same cell can both pass this
  // check. The UI's pending-disable covers that sub-second window; checkAuditRowState in the
  // consumer is the idempotency backstop. Accepted for a single-admin tool.
  const inFlight = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.cellKey, cellKey), inArray(generationJobs.status, ['queued', 'running'])))
    .limit(1);
  if (inFlight.length > 0) {
    return c.json({ error: 'A generation job for this cell is already in progress', code: 'GENERATION_IN_PROGRESS' }, 409);
  }

  const jobId = randomUUID();
  const message: GenerationJobMessage = {
    jobId,
    trigger: 'admin',
    spec: {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPointKey: cell.grammarPoint.key,
      topicDomain: null,
      count,
      batchSeed: `admin-${jobId}`,
    },
    maxCostUsd: ADMIN_PER_CELL_COST_CAP_USD,
  };
  parseGenerationJobMessage(message);

  await getSqsClient().send(
    new SendMessageCommand({ QueueUrl: requireEnv('GENERATION_QUEUE_URL'), MessageBody: JSON.stringify(message) }),
  );

  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'generation.trigger',
    targetType: 'cell',
    targetId: cellKey,
    metadata: { count, jobId },
  });

  return c.json({ jobId, status: 'queued' });
});

// ---------------------------------------------------------------------------
// Invite code management — generate, list, revoke
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 8;

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

const CreateInvitesSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(200).optional(),
});

admin.post('/admin/invites', async (c) => {
  const parsed = CreateInvitesSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { count: n, expiresInDays, note } = parsed.data;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  // 36^8 ≈ 2.8e12 codes vs a batch of ≤50 — collision is negligible. If one
  // does occur the unique constraint rejects the whole insert (caller retries).
  // Do NOT add onConflictDoNothing here: it would silently insert fewer than
  // `count` codes.
  const rows = Array.from({ length: n }, () => ({
    code: generateInviteCode(),
    expiresAt,
    note: note ?? null,
  }));
  const inserted = await db
    .insert(invitations)
    .values(rows)
    .returning({
      id: invitations.id,
      code: invitations.code,
      expiresAt: invitations.expiresAt,
      note: invitations.note,
    });

  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'invite.create',
    targetType: 'invite',
    targetId: null,
    metadata: { count: n },
  });

  return c.json({ codes: inserted });
});

admin.get('/admin/invites', async (c) => {
  const rows = await db
    .select({
      id: invitations.id,
      code: invitations.code,
      usedBy: invitations.usedBy,
      usedAt: invitations.usedAt,
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt,
      note: invitations.note,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .orderBy(desc(invitations.createdAt));
  const now = Date.now();
  const items = rows.map((r) => ({
    ...r,
    status: r.revokedAt
      ? 'revoked'
      : r.usedBy
        ? 'redeemed'
        : r.expiresAt && r.expiresAt.getTime() < now
          ? 'expired'
          : 'unused',
  }));
  return c.json({ items });
});

admin.post('/admin/invites/:id/revoke', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .select({
      id: invitations.id,
      usedBy: invitations.usedBy,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .where(eq(invitations.id, id))
    .limit(1);
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  if (row.usedBy) return c.json({ error: 'Already used', code: 'INVITE_USED' }, 409);
  if (row.revokedAt) return c.json({ ok: true }, 200);
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(eq(invitations.id, id));

  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'invite.revoke',
    targetType: 'invite',
    targetId: id,
    metadata: {},
  });

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /admin/audit — paginated, filterable read-only audit log
// ---------------------------------------------------------------------------

const AuditQuerySchema = z.object({
  action: z.string().optional(),
  targetType: z.string().optional(),
  adminUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

admin.get('/admin/audit', async (c) => {
  const parsed = AuditQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { action, targetType, adminUserId, limit, offset } = parsed.data;
  const conds: SQL[] = [];
  if (action) conds.push(eq(adminAuditLog.action, action));
  if (targetType) conds.push(eq(adminAuditLog.targetType, targetType));
  if (adminUserId) conds.push(eq(adminAuditLog.adminUserId, adminUserId));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.select({
      id: adminAuditLog.id,
      adminUserId: adminAuditLog.adminUserId,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      metadata: adminAuditLog.metadata,
      createdAt: adminAuditLog.createdAt,
    }).from(adminAuditLog).where(where)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit ?? 50).offset(offset ?? 0),
    db.select({ count: count() }).from(adminAuditLog).where(where),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    adminUserId: r.adminUserId,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    metadata: r.metadata,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

export default admin;
