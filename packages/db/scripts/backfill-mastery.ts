// One-off: rebuild user_grammar_mastery from existing user_exercise_history by
// replaying each user's attempts (per grammar point) through the same update
// rule the live submit path uses. Idempotent — recomputes each row from
// scratch. Dry-run by default; pass --apply to write.
//
//   pnpm backfill:mastery [--apply] [--user=<id>] [--language=ES|DE|TR|EN]
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import { createDb } from '../src/client';
import { exercises, userExerciseHistory, userGrammarMastery } from '../src/schema';
import { replayHistory, type HistoryRow } from '../src/mastery/update';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const apply = process.argv.includes('--apply');
const userFilter = arg('user');
const languageFilter = arg('language');

const isCefr = (v: string | null): v is CefrLevel =>
  v != null && (Object.values(CefrLevel) as string[]).includes(v);

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  const where = [
    isNotNull(exercises.grammarPointKey),
    isNotNull(userExerciseHistory.score),
    isNotNull(userExerciseHistory.evaluatedAt),
    isNotNull(userExerciseHistory.userId),
  ];
  if (userFilter) where.push(eq(userExerciseHistory.userId, userFilter));
  if (languageFilter) where.push(eq(exercises.language, languageFilter));

  const rows = await db
    .select({
      userId: userExerciseHistory.userId,
      language: exercises.language,
      grammarPointKey: exercises.grammarPointKey,
      score: userExerciseHistory.score,
      difficulty: exercises.difficulty,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      evidenceWeight: userExerciseHistory.evidenceWeight,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(and(...where))
    .orderBy(asc(userExerciseHistory.evaluatedAt));

  // Group rows per (user, language); replayHistory folds per grammar point.
  type Key = string; // `${userId} ${language}`
  const byUserLang = new Map<Key, HistoryRow[]>();
  const langOf = new Map<Key, string>();
  for (const r of rows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    if (!isCefr(r.difficulty)) continue;
    const k = `${r.userId} ${r.language}`;
    langOf.set(k, r.language);
    const list = byUserLang.get(k) ?? [];
    list.push({
      grammarPointKey: r.grammarPointKey,
      score: r.score as number,
      difficulty: r.difficulty,
      evaluatedAt: new Date(r.evaluatedAt as Date),
      evidenceWeight: r.evidenceWeight ?? undefined,
    });
    byUserLang.set(k, list);
  }

  let upserts = 0;
  for (const [k, history] of byUserLang) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    const finalStates = replayHistory(history);
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      if (!apply) continue;
      await db
        .insert(userGrammarMastery)
        .values({
          userId,
          language,
          grammarPointKey,
          masteryScore: s.masteryScore,
          confidence: s.confidence,
          evidenceCount: s.evidenceCount,
          lastPracticedAt: s.lastPracticedAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userGrammarMastery.userId, userGrammarMastery.grammarPointKey],
          set: {
            language,
            masteryScore: s.masteryScore,
            confidence: s.confidence,
            evidenceCount: s.evidenceCount,
            lastPracticedAt: s.lastPracticedAt,
            updatedAt: new Date(),
          },
        });
    }
  }

  console.log(
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
      `across ${byUserLang.size} (user,language) groups from ${rows.length} history rows.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
