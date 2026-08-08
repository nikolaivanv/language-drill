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
      confidence: userGrammarMastery.confidence,
    })
    .from(userGrammarMastery);

  // `confidence` is carried alongside the score because `solid` is a
  // TWO-condition predicate (see the lost-solid count below); scoring alone
  // cannot tell whether a point was ever solid to begin with.
  const existingByKey = new Map<string, { masteryScore: number; confidence: number }>();
  for (const r of existingRows) {
    if (r.userId && r.grammarPointKey && r.masteryScore != null) {
      existingByKey.set(`${r.userId}:${r.grammarPointKey}`, {
        masteryScore: r.masteryScore,
        confidence: r.confidence ?? 0,
      });
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
  type Shift = {
    userId: string;
    grammarPointKey: string;
    from: number | null;
    fromConfidence: number | null;
    to: number;
  };
  const shifts: Shift[] = [];
  for (const [k, history] of byUserLang) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    const finalStates = replayHistory(history);
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      const prior = existingByKey.get(`${userId}:${grammarPointKey}`) ?? null;
      shifts.push({
        userId,
        grammarPointKey,
        from: prior ? prior.masteryScore : null,
        fromConfidence: prior ? prior.confidence : null,
        to: s.masteryScore,
      });
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

  // `solid` (curriculum-map.ts SOLID_MASTERY=0.8, SOLID_CONFIDENCE=0.6) drives
  // map cell color, solidCount, the readyToAdvance banner, and prereqUnmet on
  // downstream points. This change compresses thin points toward 0.5, so
  // `solid` can only be LOST here, never gained.
  // Both conditions matter: a point scoring >=0.8 with confidence <0.6 was
  // never `solid`, so dropping below 0.8 costs nothing. Counting on score
  // alone over-reports — and it over-reports exactly where this change bites,
  // since confidence >=0.6 needs ~5+ observations while the points that move
  // most are the thin, low-confidence ones. `confidence` only ever grows with
  // evidenceCount, so a point that was solid can lose it only via the score.
  const lostSolid = changed.filter(
    (s) => s.from >= 0.8 && (s.fromConfidence ?? 0) >= 0.6 && s.to < 0.8,
  ).length;
  // rank.ts PREREQ_THRESHOLD=0.3 gates whether a point counts as satisfied
  // prerequisite evidence for downstream points.
  const crossedPrereq = changed.filter((s) => (s.from >= 0.3) !== (s.to >= 0.3)).length;

  // Rows the rebuild does NOT cover: existing user_grammar_mastery keys with
  // no corresponding row in `shifts`. These arise from grammar-point key
  // renames or exercises whose grammarPointKey was nulled/re-keyed — the
  // history query above INNER-JOINs exercises and requires a non-null key,
  // so such rows are silently skipped and keep their old ceiling forever.
  const staleNotRebuilt = existingByKey.size - shifts.filter((s) => s.from !== null).length;

  console.log(
    `Diff: ${changed.length} moved, ${brandNew} new, ` +
      `mean |Δ| ${mean.toFixed(4)}, max |Δ| ${max.toFixed(4)}.`,
  );
  console.log(
    `  lost 'solid' (masteryScore>=0.8 && confidence>=0.6, drives map color / ` +
      `solidCount / readyToAdvance / downstream prereqUnmet): ${lostSolid}`,
  );
  console.log(
    `  crossed the prereq threshold (masteryScore>=0.3, gates downstream ` +
      `prerequisite evidence in rank.ts): ${crossedPrereq}`,
  );
  console.log(
    `  stale (not rebuilt) — existing rows this run never touched, e.g. from ` +
      `a grammar-point rename or a nulled/re-keyed exercise: ${staleNotRebuilt}`,
  );

  const fmt = (s: Shift) =>
    `  ${s.grammarPointKey.padEnd(38)} ${(s.from ?? 0).toFixed(3)} → ${s.to.toFixed(3)}` +
    `  (${s.from === null ? 'new' : (s.to - s.from >= 0 ? '+' : '') + (s.to - s.from).toFixed(3)})`;

  console.log('\nTop 20 largest shifts:');
  for (const s of [...changed].sort((a, b) => absDelta(b) - absDelta(a)).slice(0, 20)) {
    console.log(fmt(s));
  }

  // This is a PROXY for served order, not the served order itself: rank.ts
  // priority is `gap * prereqPenalty + errorTerm`, and it adds a GROWTH_BOOST
  // when effective mastery falls inside a middle band (0.3-0.7), so priority
  // is non-monotonic in masteryScore. Because this change pushes thin points
  // toward 0.5 — i.e. into that band — a point moving e.g. 0.75 -> 0.70 can
  // gain priority discontinuously. Compare the two orderings as a sanity
  // check, not as the decisive signal.
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
