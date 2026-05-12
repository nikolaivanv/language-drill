import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import {
  ALL_CURRICULA,
  buildCellKey,
  buildCellKeyFromRow,
  enumerateCurriculumCells,
  exercises,
  generationJobs,
  targetCellSize,
  userExerciseHistory,
} from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';

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

  // Three aggregating queries in parallel — the in-memory cell list filters
  // the response shape, so each query stays a single index-friendly aggregate
  // rather than per-cell round-trips.
  const [countRows, lastRefilledRows, depletionRows] = await Promise.all([
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
  ]);

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
      targetSize: targetCellSize(depletionRate7d),
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
    db
      .select({
        cellKey: generationJobs.cellKey,
        approved: sql<number>`SUM(${generationJobs.approvedCount})::int`,
        flagged: sql<number>`SUM(${generationJobs.flaggedCount})::int`,
        rejected: sql<number>`SUM(${generationJobs.rejectedCount})::int`,
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
    };
    existing.approvedCount += row.approved;
    existing.flaggedCount += row.flagged;
    existing.rejectedCount += row.rejected;
    approvalAgg.set(groupKey, existing);
  }

  const approvalRates = [...approvalAgg.values()]
    .map((entry) => {
      const total =
        entry.approvedCount + entry.flaggedCount + entry.rejectedCount;
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

export default admin;
