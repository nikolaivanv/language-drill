// One-off: rebuild user_grammar_mastery from existing user_exercise_history by
// replaying each user's attempts (per grammar point) through the same update
// rule the live submit path uses. Idempotent — recomputes each row from
// scratch. Dry-run by default; pass --apply to write.
//
//   pnpm backfill:mastery [--apply] [--user=<id>] [--language=ES|DE|TR|EN] [--include-demoted]
import { and, asc, eq, isNotNull, or, type SQL } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import { createDb, type Db } from '../src/client';
import { exercises, userExerciseHistory, userGrammarMastery } from '../src/schema';
import { replayHistory, type HistoryRow, type MasteryState } from '../src/mastery/update';
import { scoringEvidenceFilter } from '../src/lib/evidence';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

const isCefr = (v: string | null): v is CefrLevel =>
  v != null && (Object.values(CefrLevel) as string[]).includes(v);

// `${userId} ${language}` — a group key shared between the history replay and
// the stale-row lookup below.
export type GroupKey = string;

export type StaleMasteryRow = {
  userId: string;
  language: string;
  grammarPointKey: string;
};

/**
 * A pre-existing `user_grammar_mastery` row is stale when the replay (which
 * only sees surviving, non-defect-demoted evidence) produced no entry for its
 * `(user, language, grammarPointKey)` triple — i.e. every attempt that ever
 * fed that row has since been filtered out. The live submit path never
 * checks `demotionReason`, so nothing else corrects these rows; the backfill
 * must delete them explicitly or they sit stale forever, exactly where the
 * injustice is largest (every attempt was on a broken exercise).
 *
 * `existingRows` must already be scoped to only the `(user, language)` groups
 * present in `finalStatesByGroup` (see `groupScopeCondition` / `run` below) —
 * that's what makes the "zero surviving history ⇒ skip the whole group"
 * guard in `planStaleMasteryDeletions` effective.
 */
export function findStaleMasteryRows(
  finalStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>,
  existingRows: readonly StaleMasteryRow[],
): StaleMasteryRow[] {
  const stale: StaleMasteryRow[] = [];
  for (const row of existingRows) {
    const k: GroupKey = `${row.userId} ${row.language}`;
    const finalStates = finalStatesByGroup.get(k);
    if (!finalStates || !finalStates.has(row.grammarPointKey)) {
      stale.push(row);
    }
  }
  return stale;
}

/**
 * Decides whether stale-row deletion should run at all, before touching the
 * DB. Two independent guards:
 *
 *   1. `--include-demoted` is the rollback path — it must restore
 *      pre-2026-08 behaviour exactly, so it must never delete anything.
 *   2. A run whose replay produced zero groups (e.g. `--user`/`--language`
 *      matched nothing, or the evidence query came back empty for some
 *      unrelated reason) must not be treated as "every existing mastery row
 *      is now stale" — it's skipped instead. Deletion is only ever scoped to
 *      groups that have *some* surviving history; a group with none is never
 *      considered a deletion candidate, mass or otherwise.
 */
export function planStaleMasteryDeletions(params: {
  includeDemoted: boolean;
  finalStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>;
  existingRows: readonly StaleMasteryRow[];
}): StaleMasteryRow[] {
  if (params.includeDemoted) return [];
  if (params.finalStatesByGroup.size === 0) return [];
  return findStaleMasteryRows(params.finalStatesByGroup, params.existingRows);
}

/**
 * Builds the `(userId, language)` OR-of-ANDs condition scoping the
 * existing-mastery-row lookup to exactly the groups that have surviving
 * history — never broader. Returns `undefined` when there's nothing to scope
 * to (so the caller can skip the query entirely rather than run it
 * unconditionally, which is the other half of the mass-delete guard).
 */
export function groupScopeCondition(groupKeys: Iterable<GroupKey>): SQL | undefined {
  const conditions = [...groupKeys].map((k) => {
    const [userId, language] = k.split(' ');
    return and(eq(userGrammarMastery.userId, userId!), eq(userGrammarMastery.language, language!));
  });
  const defined = conditions.filter((c): c is SQL => c !== undefined);
  return defined.length ? or(...defined) : undefined;
}

export function summarize(params: {
  apply: boolean;
  upserts: number;
  deletes: number;
  groupCount: number;
  historyRowCount: number;
  includeDemoted: boolean;
}): string {
  const { apply, upserts, deletes, groupCount, historyRowCount, includeDemoted } = params;
  const base =
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
    `across ${groupCount} (user,language) groups from ${historyRowCount} history rows ` +
    `(${includeDemoted ? 'including' : 'excluding'} attempts on defect-demoted exercises).`;
  if (includeDemoted) return base;
  return (
    base +
    ` ${apply ? 'Deleted' : '[dry-run] Would delete'} ${deletes} stale mastery ` +
    `row(s) with zero surviving evidence.`
  );
}

export type RunOptions = {
  apply: boolean;
  userFilter?: string;
  languageFilter?: string;
  includeDemoted: boolean;
};

export type RunResult = {
  upserts: number;
  deletes: number;
  groupCount: number;
  historyRowCount: number;
};

/**
 * Orchestrates one backfill pass: replay surviving history into mastery
 * upserts, then (unless `includeDemoted`) delete any pre-existing mastery row
 * whose grammar point the replay produced zero evidence for at all. Pure
 * orchestration over an injected `Db` so it's testable without a real
 * Postgres connection — see `backfill-mastery.test.ts`.
 */
export async function run(db: Db, opts: RunOptions): Promise<RunResult> {
  const { apply, userFilter, languageFilter, includeDemoted } = opts;

  const where = [
    isNotNull(exercises.grammarPointKey),
    isNotNull(userExerciseHistory.score),
    isNotNull(userExerciseHistory.evaluatedAt),
    isNotNull(userExerciseHistory.userId),
  ];
  if (userFilter) where.push(eq(userExerciseHistory.userId, userFilter));
  if (languageFilter) where.push(eq(exercises.language, languageFilter));
  if (!includeDemoted) where.push(scoringEvidenceFilter(exercises));

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
  const byUserLang = new Map<GroupKey, HistoryRow[]>();
  const langOf = new Map<GroupKey, string>();
  for (const r of rows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    if (!isCefr(r.difficulty)) continue;
    const k: GroupKey = `${r.userId} ${r.language}`;
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

  const finalStatesByGroup = new Map<GroupKey, Map<string, MasteryState>>();
  for (const [k, history] of byUserLang) {
    finalStatesByGroup.set(k, replayHistory(history));
  }

  // Stale-row deletion candidates: pre-existing mastery rows in a
  // surviving-history group whose grammar point the replay no longer
  // produced any evidence for at all. When there's no surviving history at
  // all (`byUserLang` empty), `groupScopeCondition` returns `undefined` and
  // this query is skipped entirely — see `planStaleMasteryDeletions`.
  const scopeCondition = groupScopeCondition(byUserLang.keys());
  const existingRows: StaleMasteryRow[] = scopeCondition
    ? await db
        .select({
          userId: userGrammarMastery.userId,
          language: userGrammarMastery.language,
          grammarPointKey: userGrammarMastery.grammarPointKey,
        })
        .from(userGrammarMastery)
        .where(scopeCondition)
    : [];

  const staleRows = planStaleMasteryDeletions({
    includeDemoted,
    finalStatesByGroup,
    existingRows,
  });

  let upserts = 0;
  for (const [k, finalStates] of finalStatesByGroup) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      if (!apply) continue;
      await db
        .insert(userGrammarMastery)
        .values({
          userId: userId!,
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

  if (apply) {
    for (const row of staleRows) {
      await db
        .delete(userGrammarMastery)
        .where(
          and(
            eq(userGrammarMastery.userId, row.userId),
            eq(userGrammarMastery.language, row.language),
            eq(userGrammarMastery.grammarPointKey, row.grammarPointKey),
          ),
        );
    }
  }

  return {
    upserts,
    deletes: staleRows.length,
    groupCount: byUserLang.size,
    historyRowCount: rows.length,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const userFilter = arg('user');
  const languageFilter = arg('language');
  // Attempts on exercises later demoted for a defect are excluded by default —
  // the learner was marked down for the item's fault. `--include-demoted`
  // restores the pre-2026-08 behaviour and is the rollback path: re-running with
  // it rewrites mastery back to the unfiltered values (and never deletes).
  const includeDemoted = process.argv.includes('--include-demoted');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const result = await run(db, { apply, userFilter, languageFilter, includeDemoted });

  console.log(summarize({ apply, includeDemoted, ...result }));
  process.exit(0);
}

// Skip auto-execution when imported by tests.
const invokedDirectly = process.argv[1]
  ? import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1])
  : false;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
