// One-off: replay existing user_exercise_history.response_json into
// error_observations. Idempotent — skips history rows already observed.
// Dry-run by default; pass --apply to write.
//
//   pnpm backfill:error-observations [--apply] [--user=<id>] [--language=ES|DE|TR]
import { and, asc, eq, inArray } from 'drizzle-orm';
import { createDb } from '../src/client';
import { errorObservations, exercises, userExerciseHistory } from '../src/schema';
import { backfillRowsFor, type BackfillHistoryRow, type ErrorObservationRow } from '../src/errors/observations';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const apply = process.argv.includes('--apply');
const userFilter = arg('user');
const languageFilter = arg('language');

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  const where = [];
  if (userFilter) where.push(eq(userExerciseHistory.userId, userFilter));
  if (languageFilter) where.push(eq(exercises.language, languageFilter));

  const rows = await db
    .select({
      userId: userExerciseHistory.userId,
      language: exercises.language,
      exerciseId: userExerciseHistory.exerciseId,
      sessionId: userExerciseHistory.sessionId,
      historyId: userExerciseHistory.id,
      exerciseType: exercises.type,
      hostGrammarPointKey: exercises.grammarPointKey,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      responseJson: userExerciseHistory.responseJson,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(userExerciseHistory.evaluatedAt));

  // Idempotency: which history rows already produced observations?
  const historyIds = rows.map((r) => r.historyId).filter((v): v is string => v != null);
  const observed = new Set<string>();
  for (let i = 0; i < historyIds.length; i += 1000) {
    const chunk = historyIds.slice(i, i + 1000);
    const existing = await db
      .select({ id: errorObservations.exerciseHistoryId })
      .from(errorObservations)
      .where(inArray(errorObservations.exerciseHistoryId, chunk));
    for (const e of existing) observed.add(e.id);
  }

  const toInsert: ErrorObservationRow[] = [];
  for (const r of rows) {
    if (!r.userId || !r.language || !r.exerciseId || !r.historyId || !r.exerciseType || !r.evaluatedAt) {
      continue;
    }
    const histRow: BackfillHistoryRow = {
      userId: r.userId,
      language: r.language,
      exerciseId: r.exerciseId,
      sessionId: r.sessionId ?? null,
      historyId: r.historyId,
      exerciseType: r.exerciseType,
      hostGrammarPointKey: r.hostGrammarPointKey ?? null,
      evaluatedAt: new Date(r.evaluatedAt),
      responseJson: r.responseJson,
    };
    toInsert.push(...backfillRowsFor(histRow, observed));
  }

  console.log(
    `Scanned ${rows.length} history rows → ${toInsert.length} new observations` +
      ` (${observed.size} history rows already observed).`,
  );

  if (!apply) {
    console.log('Dry-run. Pass --apply to write.');
    return;
  }
  for (let i = 0; i < toInsert.length; i += 500) {
    await db.insert(errorObservations).values(toInsert.slice(i, i + 500));
  }
  console.log(`Inserted ${toInsert.length} rows.`);
}

main().then(() => process.exit(0));
