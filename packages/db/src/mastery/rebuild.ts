import { and, asc, eq, isNotNull, type SQL } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import { type Db } from '../client';
import { exercises, userExerciseHistory, userGrammarMastery } from '../schema';
import { replayHistory, type HistoryRow, type MasteryState } from './update';
import { NON_EVIDENCE_DEMOTION_REASONS } from '../lib/evidence';

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
 * A pre-existing `user_grammar_mastery` row, as snapshotted before the
 * rebuild. Widens `StaleMasteryRow` with the stored values the old→new diff
 * report needs; `confidence` travels alongside the score because `solid` is a
 * TWO-condition predicate (see `formatDiffReport`) and the score alone cannot
 * tell whether a point was ever solid to begin with.
 */
export type ExistingMasteryRow = StaleMasteryRow & {
  masteryScore: number | null;
  confidence: number | null;
};

/**
 * `${userId}:${grammarPointKey}` — keyed exactly like the upsert's conflict
 * target, so a shift, a stored row, and a deletion for the same point all
 * collapse to one identity. Deliberately NOT `GroupKey`: that one is
 * `(user, language)` and scopes the replay, this one scopes a single point.
 */
export type PointKey = string;

export const pointKey = (userId: string, grammarPointKey: string): PointKey =>
  `${userId}:${grammarPointKey}`;

/** One rebuilt point: its stored value before this run, and the replayed one. */
export type MasteryShift = {
  userId: string;
  grammarPointKey: string;
  /** `null` when no `user_grammar_mastery` row existed for this point yet. */
  from: number | null;
  fromConfidence: number | null;
  to: number;
};

/**
 * A pre-existing `user_grammar_mastery` row is stale when BOTH:
 *
 *   1. the UNFILTERED replay — every replay-eligible `user_exercise_history`
 *      row, regardless of `demotionReason` — produced an entry for its
 *      `(user, language, grammarPointKey)` triple. This proves real history
 *      rows once named the point directly (as opposed to the point only ever
 *      having received *incidental* mastery folds — see
 *      `packages/db/src/mastery/incidental-fold.ts` — which write a
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
 *   2. A run whose surviving replay produced zero groups *globally* (e.g.
 *      `--user`/`--language` matched nothing, or the evidence query came
 *      back empty for some unrelated reason) must not be treated as "every
 *      existing mastery row is now stale" — the whole deletion pass is
 *      skipped instead.
 *
 *      This is a RUN-LEVEL circuit breaker on empty input, not a per-group
 *      scope. Once any group anywhere in the run has surviving history,
 *      `findStaleMasteryRows` evaluates every row in `existingRows`,
 *      including rows in a `(user, language)` group whose own history is
 *      *entirely* defect-demoted: `stillSurvives` is false for those, and if
 *      the unfiltered replay produced the point they ARE deleted. That is
 *      the intended semantics — a group every one of whose attempts was on a
 *      broken exercise is precisely the case this backfill exists to
 *      correct, and leaving it alone would preserve the injustice. What the
 *      guard rules out is only the degenerate *empty-input* failure mode,
 *      where an unrelated query problem would otherwise present as a mass
 *      deletion.
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

/**
 * Everything `formatDiffReport` needs, gathered by `run()`. Kept as data on
 * `RunResult` rather than printed from inside `run()` so the orchestration
 * stays testable against a fake `Db` with no console noise.
 */
export type DiffReportInput = {
  /** One entry per upserted point, in upsert order. */
  shifts: readonly MasteryShift[];
  /**
   * Every pre-existing `user_grammar_mastery` row in scope that carried a
   * stored `masteryScore`. The denominator for the three-way accounting
   * below.
   */
  existingKeys: ReadonlySet<PointKey>;
  /** Rows this run removes outright. Always empty under `--include-demoted`. */
  deleted: readonly StaleMasteryRow[];
};

/**
 * The old→new diff the rollout gates `--apply` on: a human has to be able to
 * see what moves, by how much, and what disappears, before authorising the
 * write. A bare row count makes that gate unenforceable.
 *
 * Every pre-existing row lands in exactly ONE of three buckets, and the
 * report names all three so a reader is never left guessing which happened
 * to a given row:
 *
 *   - REBUILT  — the replay produced a value for it; it appears in `shifts`
 *                with a non-null `from`, and is counted in `moved` (or is
 *                unchanged). Its stored value is overwritten.
 *   - DELETED  — every attempt that ever fed it was on a defect-demoted
 *                exercise, so it is removed rather than rewritten. Reported
 *                on its own line, and listed, because it is the only
 *                destructive action this script takes.
 *   - STALE    — neither rebuilt nor deleted: the run never saw the point at
 *                all (grammar-point rename, nulled/re-keyed exercise). These
 *                keep their stored value indefinitely.
 *
 * "Stale" and "deleted" would otherwise overlap — a deleted row is also, in
 * the literal sense, a row the rebuild did not rebuild — so `stale` is
 * computed as a set difference against BOTH the rebuilt and the deleted
 * keys. The three counts therefore partition `existingKeys` and cannot
 * double-count a row.
 */
export function formatDiffReport(input: DiffReportInput): string {
  const { shifts, existingKeys, deleted } = input;

  const rebuiltKeys = new Set<PointKey>(
    shifts.filter((s) => s.from !== null).map((s) => pointKey(s.userId, s.grammarPointKey)),
  );
  const deletedKeys = new Set<PointKey>(
    deleted.map((r) => pointKey(r.userId, r.grammarPointKey)),
  );

  const changed = shifts.filter(
    (s) => s.from !== null && Math.abs(s.to - s.from) > 1e-6,
  ) as Array<MasteryShift & { from: number }>;
  const absDelta = (s: { from: number; to: number }) => Math.abs(s.to - s.from);
  const mean =
    changed.length === 0 ? 0 : changed.reduce((acc, s) => acc + absDelta(s), 0) / changed.length;
  const max = changed.reduce((acc, s) => Math.max(acc, absDelta(s)), 0);
  const brandNew = shifts.filter((s) => s.from === null).length;

  // `solid` (curriculum-map.ts SOLID_MASTERY=0.8, SOLID_CONFIDENCE=0.6) drives
  // map cell color, solidCount, the readyToAdvance banner, and prereqUnmet on
  // downstream points.
  // Both conditions matter: a point scoring >=0.8 with confidence <0.6 was
  // never `solid`, so dropping below 0.8 costs nothing. Counting on score
  // alone over-reports — and it over-reports exactly where the neutral-prior
  // seeding bites, since confidence >=0.6 needs ~5+ observations while the
  // points that move most are the thin, low-confidence ones. `confidence`
  // only ever grows with evidenceCount, so a point that was solid can lose it
  // only via the score.
  const lostSolid = changed.filter(
    (s) => s.from >= 0.8 && (s.fromConfidence ?? 0) >= 0.6 && s.to < 0.8,
  ).length;
  // rank.ts PREREQ_THRESHOLD=0.3 gates whether a point counts as satisfied
  // prerequisite evidence for downstream points.
  const crossedPrereq = changed.filter((s) => (s.from >= 0.3) !== (s.to >= 0.3)).length;

  let staleNotRebuilt = 0;
  for (const k of existingKeys) {
    if (!rebuiltKeys.has(k) && !deletedKeys.has(k)) staleNotRebuilt += 1;
  }

  const fmt = (s: MasteryShift) =>
    `  ${s.grammarPointKey.padEnd(38)} ${(s.from ?? 0).toFixed(3)} → ${s.to.toFixed(3)}` +
    `  (${s.from === null ? 'new' : (s.to - s.from >= 0 ? '+' : '') + (s.to - s.from).toFixed(3)})`;

  const out: string[] = [];
  out.push(
    `Diff: ${changed.length} moved, ${brandNew} new, ` +
      `mean |Δ| ${mean.toFixed(4)}, max |Δ| ${max.toFixed(4)}.`,
  );
  out.push(
    `  lost 'solid' (masteryScore>=0.8 && confidence>=0.6, drives map color / ` +
      `solidCount / readyToAdvance / downstream prereqUnmet): ${lostSolid}`,
  );
  out.push(
    `  crossed the prereq threshold (masteryScore>=0.3, gates downstream ` +
      `prerequisite evidence in rank.ts): ${crossedPrereq}`,
  );
  out.push(
    `  deleted — existing rows removed outright because every attempt behind ` +
      `them was on a defect-demoted exercise: ${deletedKeys.size}`,
  );
  out.push(
    `  stale (neither rebuilt nor deleted) — existing rows this run never saw ` +
      `at all, e.g. from a grammar-point rename or a nulled/re-keyed ` +
      `exercise; they keep their stored value: ${staleNotRebuilt}`,
  );

  out.push('\nTop 20 largest shifts:');
  for (const s of [...changed].sort((a, b) => absDelta(b) - absDelta(a)).slice(0, 20)) {
    out.push(fmt(s));
  }

  // This is a PROXY for served order, not the served order itself: rank.ts
  // priority is `gap * prereqPenalty + errorTerm`, and it adds a GROWTH_BOOST
  // when effective mastery falls inside a middle band (0.3-0.7), so priority
  // is non-monotonic in masteryScore. Because neutral-prior seeding pushes
  // thin points toward 0.5 — i.e. into that band — a point moving e.g.
  // 0.75 -> 0.70 can gain priority discontinuously. Compare the two orderings
  // as a sanity check, not as the decisive signal. Deleted points leave the
  // ranking entirely and so appear in neither list; the `deleted` line above
  // is where they are accounted for.
  out.push('\nWeakest 20 BEFORE:');
  for (const s of changed.slice().sort((a, b) => a.from - b.from).slice(0, 20)) {
    out.push(fmt(s));
  }
  out.push('\nWeakest 20 AFTER:');
  for (const s of changed.slice().sort((a, b) => a.to - b.to).slice(0, 20)) {
    out.push(fmt(s));
  }

  // Listed, not just counted: deletion is the one irreversible thing an
  // `--apply` run does, so the review gate needs the actual keys.
  if (deleted.length > 0) {
    out.push(`\nDeleted rows (${deleted.length}) — zero surviving evidence:`);
    for (const r of deleted.slice(0, 20)) {
      out.push(`  ${r.grammarPointKey.padEnd(38)} ${r.language}  ${r.userId}`);
    }
    if (deleted.length > 20) out.push(`  …and ${deleted.length - 20} more`);
  }

  return out.join('\n');
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
  /** Old→new movement, for `formatDiffReport`. */
  diff: DiffReportInput;
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
 *
 * Returns counts plus the old→new movement (`diff`) that `formatDiffReport`
 * renders for the `--apply` review gate. Nothing is printed from here.
 */
export async function run(db: Db, opts: RunOptions): Promise<RunResult> {
  const { apply, userFilter, languageFilter, includeDemoted } = opts;

  // --- Snapshot existing mastery rows FIRST -------------------------------
  // ONE query serving two consumers: the stale-row deletion below needs the
  // row identities, and the old→new diff needs the stored values. Reading it
  // twice would let the two disagree — the diff could report a "before" the
  // deletion decision never saw.
  //
  // Runs before the history query and before the (potentially long,
  // hundreds-of-rows) upsert loop below, narrowing the TOCTOU window: a
  // submission that writes a mastery row for a never-before-practiced point
  // at ANY point after this snapshot — during the history query, during the
  // upserts, right up until the delete loop — simply isn't in `existingRows`
  // and can therefore never become a deletion candidate. Scoped only by the
  // optional --user/--language filters; it can't be scoped to "groups with
  // surviving history" the way the old query was, because those group keys
  // are derived from history, which hasn't been read yet at this point. The
  // diff inherits that same scope, so a filtered run reports only on the rows
  // it could actually have touched.
  const masteryWhere: SQL[] = [];
  if (userFilter) masteryWhere.push(eq(userGrammarMastery.userId, userFilter));
  if (languageFilter) masteryWhere.push(eq(userGrammarMastery.language, languageFilter));
  const existingRows: ExistingMasteryRow[] = await db
    .select({
      userId: userGrammarMastery.userId,
      language: userGrammarMastery.language,
      grammarPointKey: userGrammarMastery.grammarPointKey,
      masteryScore: userGrammarMastery.masteryScore,
      confidence: userGrammarMastery.confidence,
    })
    .from(userGrammarMastery)
    .where(masteryWhere.length ? and(...masteryWhere) : undefined);

  // Stored values, keyed by the upsert's conflict target. Rows with no stored
  // score have no "before" to diff against, so they're left out here — they
  // still participate in deletion via `existingRows`.
  const existingByKey = new Map<PointKey, { masteryScore: number; confidence: number }>();
  for (const r of existingRows) {
    if (r.userId && r.grammarPointKey && r.masteryScore != null) {
      existingByKey.set(pointKey(r.userId, r.grammarPointKey), {
        masteryScore: r.masteryScore,
        confidence: r.confidence ?? 0,
      });
    }
  }

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
  // wasn't demoted for a defect ("surviving"). `replayHistory` then folds
  // each list per grammar point. Eligibility rules (user, language, grammar
  // point present; difficulty a real CEFR level — the two other replay skips
  // the design doc calls out) apply identically to both lists, so a row
  // that's eligibility-excluded is absent from BOTH replays, and
  // `findStaleMasteryRows` never flags an absent-from-both point as stale.
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
  // One shift per upserted point — recorded even in dry-run mode, since the
  // dry-run diff is the whole point of the review gate.
  const shifts: MasteryShift[] = [];
  for (const [k, finalStates] of upsertStatesByGroup) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      const prior = existingByKey.get(pointKey(userId!, grammarPointKey)) ?? null;
      shifts.push({
        userId: userId!,
        grammarPointKey,
        from: prior ? prior.masteryScore : null,
        fromConfidence: prior ? prior.confidence : null,
        to: s.masteryScore,
      });
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
    diff: {
      shifts,
      existingKeys: new Set(existingByKey.keys()),
      deleted: staleRows,
    },
  };
}
