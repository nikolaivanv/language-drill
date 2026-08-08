// One-off: rebuild user_grammar_mastery from existing user_exercise_history by
// replaying each user's attempts (per grammar point) through the same update
// rule the live submit path uses. Idempotent — recomputes each row from
// scratch. Dry-run by default; pass --apply to write.
//
//   pnpm backfill:mastery [--apply] [--user=<id>] [--language=ES|DE|TR|EN] [--include-demoted]
import { and, asc, eq, isNotNull, type SQL } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import { createDb, type Db } from '../src/client';
import { exercises, userExerciseHistory, userGrammarMastery } from '../src/schema';
import { replayHistory, type HistoryRow, type MasteryState } from '../src/mastery/update';
import { NON_EVIDENCE_DEMOTION_REASONS } from '../src/lib/evidence';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

const isCefr = (v: string | null): v is CefrLevel =>
  v != null && (Object.values(CefrLevel) as string[]).includes(v);

const isNonEvidenceReason = (r: string | null): boolean =>
  r != null && (NON_EVIDENCE_DEMOTION_REASONS as readonly string[]).includes(r);

// `${userId} ${language}` — a group key shared between the history replay and
// the stale-row lookup below. Safe only because Clerk user ids never contain
// a space; if that ever changes (or this key starts scoping anything wider
// than these two backfill helpers), switch the delimiter to something that
// provably can't appear in an id — this key scopes a DELETE.
export type GroupKey = string;

export type StaleMasteryRow = {
  userId: string;
  language: string;
  grammarPointKey: string;
};

/**
 * A pre-existing `user_grammar_mastery` row is stale when BOTH:
 *
 *   1. the UNFILTERED replay — every replay-eligible `user_exercise_history`
 *      row, regardless of `demotionReason` — produced an entry for its
 *      `(user, language, grammarPointKey)` triple. This proves real history
 *      rows once named the point directly (as opposed to the point only ever
 *      having received *incidental* mastery folds — see
 *      `infra/lambda/src/lib/mastery/incidental-fold.ts` — which write a
 *      `user_grammar_mastery` row from an evaluator error attributed to a
 *      point OTHER than the submission's host exercise, with zero history
 *      rows naming that point at all. Such a row is absent from the
 *      unfiltered replay too, so this check correctly never touches it).
 *   2. the SURVIVING replay — only rows whose exercise's `demotionReason`
 *      isn't in `NON_EVIDENCE_DEMOTION_REASONS` — produced NO entry for the
 *      same triple. Every real history row that named this point has since
 *      been demotion-filtered out.
 *
 * That conjunction is exactly "every attempt that ever fed this row has
 * since been filtered out" — the contract this backfill promises. Checking
 * only "absent from the surviving replay" (the pre-2026-08 bug) is NOT
 * sufficient: a point can be absent from a filtered replay for reasons that
 * have nothing to do with demotion — incidental-fold-only points chief among
 * them — and deleting on that weaker signal destroys real evidence.
 *
 * The live submit path never checks `demotionReason`, so nothing else
 * corrects these rows; the backfill must delete them explicitly or they sit
 * stale forever, exactly where the injustice is largest (every surviving
 * attempt was on a broken exercise).
 */
export function findStaleMasteryRows(
  unfilteredStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>,
  survivingStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>,
  existingRows: readonly StaleMasteryRow[],
): StaleMasteryRow[] {
  const stale: StaleMasteryRow[] = [];
  for (const row of existingRows) {
    const k: GroupKey = `${row.userId} ${row.language}`;
    const wasEverReplayed = unfilteredStatesByGroup.get(k)?.has(row.grammarPointKey) ?? false;
    const stillSurvives = survivingStatesByGroup.get(k)?.has(row.grammarPointKey) ?? false;
    if (wasEverReplayed && !stillSurvives) stale.push(row);
  }
  return stale;
}

/**
 * Decides whether stale-row deletion should run at all, before touching the
 * DB. Two independent guards:
 *
 *   1. `--include-demoted` is the rollback path — it must restore
 *      pre-2026-08 behaviour exactly, so it must never delete anything.
 *   2. A run whose surviving replay produced zero groups (e.g.
 *      `--user`/`--language` matched nothing, or the evidence query came
 *      back empty for some unrelated reason) must not be treated as "every
 *      existing mastery row is now stale" — it's skipped instead. Deletion
 *      is only ever scoped to groups that have *some* surviving history; a
 *      group with none is never considered a deletion candidate, mass or
 *      otherwise.
 */
export function planStaleMasteryDeletions(params: {
  includeDemoted: boolean;
  unfilteredStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>;
  survivingStatesByGroup: ReadonlyMap<GroupKey, ReadonlyMap<string, MasteryState>>;
  existingRows: readonly StaleMasteryRow[];
}): StaleMasteryRow[] {
  if (params.includeDemoted) return [];
  if (params.survivingStatesByGroup.size === 0) return [];
  return findStaleMasteryRows(
    params.unfilteredStatesByGroup,
    params.survivingStatesByGroup,
    params.existingRows,
  );
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

function pushToGroup<T>(map: Map<GroupKey, T[]>, key: GroupKey, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Orchestrates one backfill pass: replay surviving history into mastery
 * upserts, then (unless `includeDemoted`) delete any pre-existing mastery row
 * whose grammar point the (unfiltered) replay once produced but the
 * (surviving) replay no longer does. Pure orchestration over an injected
 * `Db` so it's testable without a real Postgres connection — see
 * `backfill-mastery.test.ts`.
 */
export async function run(db: Db, opts: RunOptions): Promise<RunResult> {
  const { apply, userFilter, languageFilter, includeDemoted } = opts;

  // --- Snapshot existing mastery rows FIRST -------------------------------
  // Runs before the history query and before the (potentially long,
  // hundreds-of-rows) upsert loop below, narrowing the TOCTOU window: a
  // submission that writes a mastery row for a never-before-practiced point
  // at ANY point after this snapshot — during the history query, during the
  // upserts, right up until the delete loop — simply isn't in `existingRows`
  // and can therefore never become a deletion candidate. Scoped only by the
  // optional --user/--language filters; it can't be scoped to "groups with
  // surviving history" the way the old query was, because those group keys
  // are derived from history, which hasn't been read yet at this point.
  const masteryWhere: SQL[] = [];
  if (userFilter) masteryWhere.push(eq(userGrammarMastery.userId, userFilter));
  if (languageFilter) masteryWhere.push(eq(userGrammarMastery.language, languageFilter));
  const existingRows: StaleMasteryRow[] = await db
    .select({
      userId: userGrammarMastery.userId,
      language: userGrammarMastery.language,
      grammarPointKey: userGrammarMastery.grammarPointKey,
    })
    .from(userGrammarMastery)
    .where(masteryWhere.length ? and(...masteryWhere) : undefined);

  // --- History, always fetched WITHOUT the demotion filter ----------------
  // We need to replay BOTH "every replay-eligible row" and "only surviving
  // evidence" and diff them in memory (see `findStaleMasteryRows`), so the
  // demotion reason travels along as data instead of being applied as a SQL
  // predicate the way the pre-2026-08 query did it.
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
      demotionReason: exercises.demotionReason,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(and(...where))
    .orderBy(asc(userExerciseHistory.evaluatedAt));

  // Group into per-(user,language) history lists — twice: every
  // replay-eligible row ("unfiltered"), and only the subset whose exercise
  // wasn't demoted for a defect ("surviving"). Eligibility rules (user,
  // language, grammar point present; difficulty a real CEFR level — the two
  // other replay skips the design doc calls out) apply identically to both
  // lists, so a row that's eligibility-excluded is absent from BOTH replays,
  // and `findStaleMasteryRows` never flags an absent-from-both point as
  // stale.
  const langOf = new Map<GroupKey, string>();
  const unfilteredByGroup = new Map<GroupKey, HistoryRow[]>();
  const survivingByGroup = new Map<GroupKey, HistoryRow[]>();
  for (const r of rows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    if (!isCefr(r.difficulty)) continue;
    const k: GroupKey = `${r.userId} ${r.language}`;
    langOf.set(k, r.language);
    const entry: HistoryRow = {
      grammarPointKey: r.grammarPointKey,
      score: r.score as number,
      difficulty: r.difficulty,
      evaluatedAt: new Date(r.evaluatedAt as Date),
      evidenceWeight: r.evidenceWeight ?? undefined,
    };
    pushToGroup(unfilteredByGroup, k, entry);
    if (!isNonEvidenceReason(r.demotionReason)) pushToGroup(survivingByGroup, k, entry);
  }

  const unfilteredStatesByGroup = new Map<GroupKey, Map<string, MasteryState>>();
  for (const [k, history] of unfilteredByGroup) unfilteredStatesByGroup.set(k, replayHistory(history));

  const survivingStatesByGroup = new Map<GroupKey, Map<string, MasteryState>>();
  for (const [k, history] of survivingByGroup) survivingStatesByGroup.set(k, replayHistory(history));

  // `--include-demoted` upserts from the FULL (unfiltered) replay — the
  // rollback path; otherwise upsert from the surviving replay only. Stale-row
  // detection below always diffs unfiltered-vs-surviving regardless of this
  // flag; `planStaleMasteryDeletions` is what makes `--include-demoted`
  // delete nothing.
  const upsertStatesByGroup = includeDemoted ? unfilteredStatesByGroup : survivingStatesByGroup;
  const upsertByGroup = includeDemoted ? unfilteredByGroup : survivingByGroup;

  const staleRows = planStaleMasteryDeletions({
    includeDemoted,
    unfilteredStatesByGroup,
    survivingStatesByGroup,
    existingRows,
  });

  let upserts = 0;
  for (const [k, finalStates] of upsertStatesByGroup) {
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

  let historyRowCount = 0;
  for (const list of upsertByGroup.values()) historyRowCount += list.length;

  return {
    upserts,
    deletes: staleRows.length,
    groupCount: upsertStatesByGroup.size,
    historyRowCount,
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
  // It does NOT retroactively restore a `user_grammar_mastery` row that a
  // PRIOR (buggy) run already deleted for an incidental-fold-only grammar
  // point — the replay still can't see incidental observations at all (they
  // have no `user_exercise_history` row to replay from), so the upsert loop
  // never recreates them regardless of this flag. That kind of row can only
  // come back by re-running the live submit path (the learner practicing
  // again) or a manual insert.
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
