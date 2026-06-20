import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  exercises,
  userExerciseHistory,
  userGrammarMastery,
  errorObservations,
  userLanguageProfiles,
  grammarPointsAtOrBelow,
  getGrammarPoint,
  curriculumOrderOf,
} from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  aggregateRadar,
  type ContributingRow,
} from '../lib/progress-aggregation';
import { reviewContributingRows } from '../lib/review/evidence';
import {
  buildCurriculumMap,
  nextCefrLevel,
  type CurriculumFact,
  type MasteryRow,
} from '../lib/curriculum-map';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const ROLLING_WINDOW_DAYS = 90;
const ERROR_WINDOW_DAYS = 30;
const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;

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

  // UNION in vocabulary-review evidence over the same 90-day window so reviews
  // advance the radar (Req 9.1, 9.5). The two review sentinels route to the
  // vocabulary + grammar axes via `axisForExerciseType`.
  const reviewRows = await reviewContributingRows(db, userId, language, ROLLING_WINDOW_DAYS);

  const axes = aggregateRadar([...rows, ...reviewRows], now);
  return c.json({ language, axes });
});

const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));
function isCefrLevel(value: string): value is CefrLevel {
  return CEFR_LEVELS.has(value);
}

// ---------------------------------------------------------------------------
// GET /progress/curriculum — per-point mastery map + readiness rollup
// ---------------------------------------------------------------------------
progress.get('/progress/curriculum', async (c) => {
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
  const errorSince = new Date(now.getTime() - ERROR_WINDOW_DAYS * MS_PER_DAY);

  // Active level — resolved from the user's language profile
  const profileRows = await db
    .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
    .from(userLanguageProfiles)
    .where(and(eq(userLanguageProfiles.userId, userId), eq(userLanguageProfiles.language, language)))
    .limit(1);
  const activeLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;

  // Mastery rows + recent-error counts (effective point) in parallel
  const [masteryRows, errorRows] = await Promise.all([
    db
      .select({
        grammarPointKey: userGrammarMastery.grammarPointKey,
        masteryScore: userGrammarMastery.masteryScore,
        confidence: userGrammarMastery.confidence,
        evidenceCount: userGrammarMastery.evidenceCount,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, userId),
          eq(userGrammarMastery.language, language),
        ),
      ),
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

  const masteryByKey = new Map<string, MasteryRow>();
  for (const r of masteryRows) {
    if (r.lastPracticedAt === null) continue;
    masteryByKey.set(r.grammarPointKey, {
      masteryScore: r.masteryScore,
      confidence: r.confidence,
      evidenceCount: r.evidenceCount,
      lastPracticedAt: r.lastPracticedAt,
    });
  }
  const errorCountByKey = new Map<string, number>();
  for (const r of errorRows) if (r.key) errorCountByKey.set(r.key, r.n);

  // Curriculum facts: active-level points + next-level preview (first 5)
  const all = grammarPointsAtOrBelow(language, CefrLevel.B2);
  const toFact = (p: (typeof all)[number]): CurriculumFact => ({
    key: p.key,
    name: p.name,
    cefrLevel: p.cefrLevel,
    order: curriculumOrderOf(p.key) ?? 0,
    prereqKeys: [...(p.prerequisiteKeys ?? [])],
    prereqNames: (p.prerequisiteKeys ?? []).map((pk) => getGrammarPoint(pk)?.name ?? pk),
  });
  const activePoints = all.filter((p) => p.cefrLevel === activeLevel).map(toFact);
  const nl = nextCefrLevel(activeLevel);
  const previewPoints = nl
    ? all
        .filter((p) => p.cefrLevel === nl)
        .map(toFact)
        .sort((a, b) => a.order - b.order)
        .slice(0, 5)
    : [];

  const result = buildCurriculumMap({
    activeLevel,
    activePoints,
    previewPoints,
    masteryByKey,
    errorCountByKey,
    now,
  });
  return c.json({ language, ...result });
});

export default progress;
