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

  // Existing stored mastery, for the old→new diff. Keyed the same way the
  // upsert's conflict target is: (userId, grammarPointKey).
  const existingRows = await db
    .select({
      userId: userGrammarMastery.userId,
      grammarPointKey: userGrammarMastery.grammarPointKey,
      masteryScore: userGrammarMastery.masteryScore,
    })
    .from(userGrammarMastery);

  const existingByKey = new Map<string, number>();
  for (const r of existingRows) {
    if (r.userId && r.grammarPointKey && r.masteryScore != null) {
      existingByKey.set(`${r.userId}:${r.grammarPointKey}`, r.masteryScore);
    }
  }

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
  type Shift = { userId: string; grammarPointKey: string; from: number | null; to: number };
  const shifts: Shift[] = [];
  for (const [k, history] of byUserLang) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    const finalStates = replayHistory(history);
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      const priorScore = existingByKey.get(`${userId}:${grammarPointKey}`) ?? null;
      shifts.push({ userId: userId!, grammarPointKey, from: priorScore, to: s.masteryScore });
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

  const changed = shifts.filter(
    (s) => s.from !== null && Math.abs(s.to - s.from) > 1e-6,
  ) as Array<Shift & { from: number }>;
  const absDelta = (s: { from: number; to: number }) => Math.abs(s.to - s.from);
  const mean =
    changed.length === 0
      ? 0
      : changed.reduce((acc, s) => acc + absDelta(s), 0) / changed.length;
  const max = changed.reduce((acc, s) => Math.max(acc, absDelta(s)), 0);
  const brandNew = shifts.filter((s) => s.from === null).length;

  console.log(
    `Diff: ${changed.length} moved, ${brandNew} new, ` +
      `mean |Δ| ${mean.toFixed(4)}, max |Δ| ${max.toFixed(4)}.`,
  );

  const fmt = (s: Shift) =>
    `  ${s.grammarPointKey.padEnd(38)} ${(s.from ?? 0).toFixed(3)} → ${s.to.toFixed(3)}` +
    `  (${s.from === null ? 'new' : (s.to - s.from >= 0 ? '+' : '') + (s.to - s.from).toFixed(3)})`;

  console.log('\nTop 20 largest shifts:');
  for (const s of [...changed].sort((a, b) => absDelta(b) - absDelta(a)).slice(0, 20)) {
    console.log(fmt(s));
  }

  // Selection ranks weakest-first, so this is the list that actually decides
  // what gets served next. Compare the two orderings, not just the values.
  console.log('\nWeakest 20 BEFORE:');
  for (const s of changed.slice().sort((a, b) => a.from - b.from).slice(0, 20)) {
    console.log(fmt(s));
  }
  console.log('\nWeakest 20 AFTER:');
  for (const s of changed.slice().sort((a, b) => a.to - b.to).slice(0, 20)) {
    console.log(fmt(s));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
