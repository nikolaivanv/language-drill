import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { CefrLevel, Language } from '@language-drill/shared';
import { exercises, userExerciseHistory } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  aggregateRadar,
  aggregateTopicMastery,
  pivotCells,
  DEFAULT_SHADE_THRESHOLDS,
  type ContributingRow,
} from '../lib/progress-aggregation';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. Mirrors the comment block in
// `routes/profiles.ts`.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const RadarQuerySchema = z.object({
  language: LearningLanguageEnum,
});

const HeatmapQuerySchema = z.object({
  language: LearningLanguageEnum,
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const ROLLING_WINDOW_DAYS = 90;
const HEATMAP_WINDOW_DAYS = 30;
const MAX_HEATMAP_TOPICS = 8;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const progress = new Hono<{ Bindings: Bindings; Variables: Variables }>();

progress.use('/progress/*', authMiddleware);

// ---------------------------------------------------------------------------
// GET /progress/radar — six-axis skill snapshot for the active language
// ---------------------------------------------------------------------------
progress.get('/progress/radar', async (c) => {
  const parsed = RadarQuerySchema.safeParse(c.req.query());
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

  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const windowStart = new Date(now.getTime() - ROLLING_WINDOW_DAYS * MS_PER_DAY);

  const rawRows = await db
    .select({
      score: userExerciseHistory.score,
      difficulty: exercises.difficulty,
      type: exercises.type,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        eq(exercises.language, language),
        gte(userExerciseHistory.evaluatedAt, windowStart),
        isNotNull(userExerciseHistory.score),
        isNotNull(userExerciseHistory.evaluatedAt),
        isNotNull(exercises.type),
        isNotNull(exercises.difficulty),
      ),
    );

  // The DB columns are nullable in the schema and difficulty/type are free-text.
  // Narrow to the shape `aggregateRadar` expects, dropping rows that don't fit.
  const rows: ContributingRow[] = [];
  for (const row of rawRows) {
    if (row.score === null || row.evaluatedAt === null) continue;
    if (row.type === null || row.difficulty === null) continue;
    if (!isCefrLevel(row.difficulty)) continue;
    rows.push({
      score: row.score,
      difficulty: row.difficulty,
      type: row.type,
      evaluatedAt: row.evaluatedAt,
    });
  }

  const axes = aggregateRadar(rows, now);
  return c.json({ language, axes });
});

// ---------------------------------------------------------------------------
// GET /progress/heatmap — topic × day attempt grid for the last 30 days
// ---------------------------------------------------------------------------
progress.get('/progress/heatmap', async (c) => {
  const parsed = HeatmapQuerySchema.safeParse(c.req.query());
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

  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const windowStart = new Date(now.getTime() - ROLLING_WINDOW_DAYS * MS_PER_DAY);

  const topicHintExpr = sql<
    string | null
  >`lower(${exercises.contentJson}->>'topicHint')`;

  const rawRows = await db
    .select({
      score: userExerciseHistory.score,
      difficulty: exercises.difficulty,
      type: exercises.type,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      topicHint: topicHintExpr,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        eq(exercises.language, language),
        gte(userExerciseHistory.evaluatedAt, windowStart),
        isNotNull(userExerciseHistory.score),
        isNotNull(userExerciseHistory.evaluatedAt),
        isNotNull(exercises.type),
        isNotNull(exercises.difficulty),
        isNotNull(topicHintExpr),
      ),
    );

  // Group rows by topicHint, dropping rows that fail nullability or shape.
  const buckets = new Map<string, ContributingRow[]>();
  for (const row of rawRows) {
    if (row.score === null || row.evaluatedAt === null) continue;
    if (row.type === null || row.difficulty === null) continue;
    if (!isCefrLevel(row.difficulty)) continue;
    if (!row.topicHint) continue; // also drop empty strings
    const list = buckets.get(row.topicHint) ?? [];
    list.push({
      score: row.score,
      difficulty: row.difficulty,
      type: row.type,
      evaluatedAt: row.evaluatedAt,
    });
    buckets.set(row.topicHint, list);
  }

  // Top N by row count over the 90-day window.
  const topTopics = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_HEATMAP_TOPICS);

  const heatmapStart = new Date(now.getTime() - HEATMAP_WINDOW_DAYS * MS_PER_DAY);

  const topics = topTopics.map(([topicId, rows]) => {
    const recent = rows.filter((r) => r.evaluatedAt >= heatmapStart);
    return {
      topicId,
      name: topicId,
      mastery: aggregateTopicMastery(rows, now),
      cells: pivotCells(recent, now, HEATMAP_WINDOW_DAYS),
    };
  });

  return c.json({
    language,
    days: HEATMAP_WINDOW_DAYS,
    topics,
    shadeThresholds: DEFAULT_SHADE_THRESHOLDS,
  });
});

const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));
function isCefrLevel(value: string): value is CefrLevel {
  return CEFR_LEVELS.has(value);
}

export default progress;
