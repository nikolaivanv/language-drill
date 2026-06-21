// Shared builder for RankContext — used by both GET /sessions/today (inline,
// kept for its RTT budget) and POST /sessions (called here). Mirrors the
// construction in sessions.ts ~lines 336-372 so the two code paths stay in
// sync. Accepts `db` as a parameter so unit tests can inject a mock without
// touching module-level imports.
import { and, eq, gte, sql } from 'drizzle-orm';
import { userGrammarMastery, errorObservations, getGrammarPoint } from '@language-drill/db';
import type { RankContext, PointMastery } from './rank';

type Db = {
  select: (cols?: Record<string, unknown>) => {
    from: (...args: unknown[]) => {
      where: (...args: unknown[]) => unknown;
    };
  };
};

/**
 * Builds a RankContext for (userId, language) in two parallel DB queries:
 *  1. userGrammarMastery → masteryByPoint
 *  2. errorObservations (last 30 days, COALESCE'd key) → errorCountByPoint
 *
 * prereqsOf delegates to getGrammarPoint (in-memory curriculum); returns []
 * for unknown keys so the prereq penalty never fires on unmapped points.
 *
 * Accepts `db` as a parameter to keep unit tests framework-free.
 */
export async function buildRankContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  language: string,
  now: Date,
): Promise<RankContext> {
  const errorSince = new Date(now.getTime() - 30 * 86_400_000);

  const [masteryRows, errorRows] = await Promise.all([
    db
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

  const masteryByPoint = new Map<string, PointMastery>(
    (masteryRows as Array<{ grammarPointKey: string; masteryScore: number; lastPracticedAt: Date | string }>).map(
      (r) => [
        r.grammarPointKey,
        {
          masteryScore: r.masteryScore,
          lastPracticedAt: new Date(r.lastPracticedAt),
        },
      ],
    ),
  );

  const errorCountByPoint = new Map<string, number>();
  for (const r of errorRows as Array<{ key: string | null; n: number }>) {
    if (r.key) errorCountByPoint.set(r.key, Number(r.n));
  }

  return {
    masteryByPoint,
    errorCountByPoint,
    prereqsOf: (key: string) => getGrammarPoint(key)?.prerequisiteKeys ?? [],
    now,
  };
}
