import {
  userExerciseHistory,
  userGrammarMastery,
  exercises,
  type Db,
} from '@language-drill/db';
import { and, eq, gte, lt, isNotNull } from 'drizzle-orm';
import type { HistoryRow, MasteryRow } from './summary-data';

/**
 * Raw rows for the weekly summary. History is the user's evaluated exercises in
 * the window (joined to exercises for the grammar point + language); mastery is
 * the user's current per-point scores (for weak-spot selection). Shaping lives
 * in summary-data.ts (pure + tested).
 */
export async function gatherSummary(
  db: Db,
  userId: string,
  start: Date,
  end: Date,
): Promise<{ historyRows: HistoryRow[]; masteryRows: MasteryRow[] }> {
  const rawHistory = await db
    .select({
      grammarPointKey: exercises.grammarPointKey,
      language: exercises.language,
      score: userExerciseHistory.score,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        gte(userExerciseHistory.evaluatedAt, start),
        lt(userExerciseHistory.evaluatedAt, end),
        isNotNull(userExerciseHistory.evaluatedAt),
      ),
    );

  // NOTE: the real column is `masteryScore` (column: mastery_score), NOT `score`.
  // The brief's snippet incorrectly used userGrammarMastery.score which does not exist.
  const rawMastery = await db
    .select({
      grammarPointKey: userGrammarMastery.grammarPointKey,
      masteryScore: userGrammarMastery.masteryScore,
    })
    .from(userGrammarMastery)
    .where(eq(userGrammarMastery.userId, userId));

  return {
    historyRows: rawHistory
      .filter((r): r is typeof r & { language: string } => r.language !== null)
      .map((r) => ({
        grammarPointKey: r.grammarPointKey ?? null,
        language: r.language,
        score: r.score ?? null,
        evaluatedAt: r.evaluatedAt as Date,
      })),
    // Map masteryScore → score to match the MasteryRow interface { grammarPointKey, score }
    masteryRows: rawMastery
      .filter(
        (r): r is { grammarPointKey: string; masteryScore: number } =>
          r.grammarPointKey !== null && r.masteryScore !== null,
      )
      .map((r) => ({ grammarPointKey: r.grammarPointKey, score: r.masteryScore })),
  };
}
