import { and, asc, eq, isNotNull, ne, type SQL } from 'drizzle-orm';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import { type Db } from '../client';
import { errorObservations, exercises, userExerciseHistory, userGrammarMastery } from '../schema';
import { replayHistory, type HistoryRow, type MasteryState } from './update';
import { SEVERITY_SCORE } from './incidental-fold';
import { NON_EVIDENCE_DEMOTION_REASONS } from '../lib/evidence';
import { getGrammarPoint } from '../curriculum';

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
 *      row AND every replay-eligible `error_observations` row (Task 4),
 *      regardless of `demotionReason` — produced an entry for its
 *      `(user, language, grammarPointKey)` triple.
 *
 *      Before Task 4, a point that only ever received *incidental* mastery
 *      folds (see `packages/db/src/mastery/incidental-fold.ts` — an
 *      evaluator error attributed to a point OTHER than the submission's
 *      host exercise, writing a `user_grammar_mastery` row with ZERO
 *      `user_exercise_history` rows naming that point) was absent from the
 *      unfiltered replay too, so this check never touched it — it looked
 *      like a point this backfill script couldn't see at all.
 *
 *      That is no longer true. Task 4 reconstructs incidental observations
 *      from `error_observations` and folds them into BOTH replay lists, so
 *      an incidental-only point now DOES appear in the unfiltered replay
 *      whenever its backing `error_observations` rows survived (i.e. weren't
 *      lost to a pre-Task-4 submission or a `recordErrorObservations`
 *      failure — see that function's "best-effort" comment). Consequence: a
 *      point whose only evidence is incidental observations, all recorded
 *      against exercises later demoted for a defect, now satisfies BOTH
 *      conditions below and IS deleted — where before Task 4 it silently
 *      survived. This is intended: an incidental error observed only on a
 *      defect-demoted exercise is exactly as untrustworthy as an incidental
 *      error on a defect-demoted exercise's own host score. A point with
 *      genuinely zero `error_observations` rows backing it (the pre-Task-4
 *      case, or a `recordErrorObservations` failure) is still absent from
 *      both replays and still left untouched by this check.
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
  /** See `RunResult.historyRowCount` — merges host history rows and folded
   *  incidental observations, so "history rows" below is a slight misnomer
   *  kept for output stability; the doc comment on `RunResult` is the source
   *  of truth for what this number actually counts. */
  historyRowCount: number;
  includeDemoted: boolean;
}): string {
  const { apply, upserts, deletes, groupCount, historyRowCount, includeDemoted } = params;
  const base =
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
    `across ${groupCount} (user,language) groups from ${historyRowCount} evidence rows ` +
    `(host history + folded incidental observations; ` +
    `${includeDemoted ? 'including' : 'excluding'} attempts on defect-demoted exercises).`;
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
  /**
   * Abort the run if it would delete more than this many mastery rows. `null`
   * or absent means unbounded. The scheduled Lambda sets it; the CLI leaves it
   * null because a human reads its dry-run first. Deletion is the only
   * irreversible thing this does, so an unattended run stops rather than
   * guessing when the count looks systemic.
   */
  maxDeletes?: number | null;
};

export type RunResult = {
  upserts: number;
  deletes: number;
  groupCount: number;
  /**
   * Total evidence rows folded into the upserted (surviving, or unfiltered
   * under `--include-demoted`) replay — the sum of `user_exercise_history`
   * host rows AND merged incidental observations reconstructed from
   * `error_observations` (Task 4). Despite the name, this is not purely a
   * `user_exercise_history` row count; see `summarize()`, which renders it.
   */
  historyRowCount: number;
  /** Old→new movement, for `formatDiffReport`. */
  diff: DiffReportInput;
  /**
   * True when the delete-count circuit breaker tripped: `apply` was set,
   * `maxDeletes` was a number, and the computed deletions exceeded it. When
   * `aborted` is true, NOTHING was written — not the deletes, and not the
   * upserts either, so the run can never partially apply. `upserts`,
   * `deletes`, and `diff` are still the real computed values, so the caller
   * can log exactly what it refused. Always `false` when `apply` is false —
   * a dry-run never writes regardless of the computed delete count, so
   * reporting it as aborted would misrepresent a normal preview as a refusal.
   */
  aborted: boolean;
};

function pushToGroup<T>(map: Map<GroupKey, T[]>, key: GroupKey, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * The `error_observations` WHERE clause `run()` uses to reconstruct
 * incidental observations, extracted so it can be unit-tested against its
 * rendered SQL (a mocked `Db` cannot execute a real predicate — see
 * `rebuild.test.ts`'s `incidentalObservationsWhere` suite, which pins this
 * exact text/param shape the way `evidence.test.ts` pins
 * `scoringEvidenceFilter`).
 *
 * Three predicates, always present:
 *   1. `IS NOT NULL` on the violated point — an observation with no
 *      attribution carries no evidence to fold.
 *   2. `<>` excluding host-attributed errors — already reflected in the
 *      submission's own score; folding them again would double-penalize.
 *      SQL `<>` yields NULL (not true) when either side is NULL, so this
 *      predicate ALSO excludes any row whose `host_grammar_point_key` is
 *      NULL — matching the live `incidentalObservations()`, which returns
 *      `[]` outright when `hostGrammarPointKey === null`. This is load-
 *      bearing, not an oversight: do not add an explicit null guard here,
 *      it would be redundant with what `<>` already does.
 *   3. `<>` excluding free-writing observations — the free-writing branch of
 *      `POST /exercises/:id/submit` calls `recordErrorObservations` and then
 *      `return`s; it never calls `incidentalObservations`, so free-writing
 *      errors have NEVER contributed to mastery live. Folding them here
 *      would inject a penalty the live path never applied and the nightly
 *      diff would never settle to zero on an account with free-writing
 *      history. Whether free-writing errors *should* count is a real
 *      product question — but it is a change to the LIVE path, deliberately
 *      out of scope for this replay-fidelity fix.
 */
export function incidentalObservationsWhere(params: {
  userFilter?: string;
  languageFilter?: string;
}): SQL[] {
  const where: SQL[] = [
    isNotNull(errorObservations.errorGrammarPointKey),
    ne(errorObservations.errorGrammarPointKey, errorObservations.hostGrammarPointKey),
    ne(errorObservations.exerciseType, ExerciseType.FREE_WRITING),
  ];
  if (params.userFilter) where.push(eq(errorObservations.userId, params.userFilter));
  if (params.languageFilter) where.push(eq(errorObservations.language, params.languageFilter));
  return where;
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
    // The free-writing branch of `POST /exercises/:id/submit` writes this
    // history row and then returns WITHOUT ever calling
    // `applyGrammarMastery` — not for the host point, not for incidentals
    // (see the `incidentalObservationsWhere` comment above for the
    // incidental half of this same fact). So although a free-writing row
    // carries a non-null `grammar_point_key` (the free-writing umbrella
    // point) and would otherwise look fully eligible here, replaying it
    // would MINT a `user_grammar_mastery` row the live app has never
    // written, and keep moving it after every subsequent free-writing
    // submission — the nightly diff would never settle to zero on an
    // account with free-writing history. Whether free-writing should count
    // toward mastery is a real product question, deliberately deferred; this
    // is a replay-fidelity exclusion only, not a change to the live path.
    ne(exercises.type, ExerciseType.FREE_WRITING),
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

  // --- Incidental observations --------------------------------------------
  // The live submit path folds evaluator errors attributed to points OTHER
  // than the exercise's own into mastery (see incidentalObservations). Those
  // produce NO user_exercise_history row, so a history-only replay silently
  // discards them. error_observations persists the same errors, so the replay
  // reconstructs them here. Demotion reason travels as data, exactly as the
  // history query does, so both replays can be diffed.
  //
  // Note: no `exercises.difficulty` in this projection. Unlike the host
  // fold above, the live incidental fold
  // (`infra/lambda/src/routes/exercises.ts`, the `incidentalObservations`
  // loop) scores each observation at the VIOLATED point's own
  // `getGrammarPoint(...).cefrLevel`, not the host exercise's difficulty —
  // see the grouping loop below, which performs the same curriculum lookup.
  const obsWhere = incidentalObservationsWhere({ userFilter, languageFilter });

  const observationRows = await db
    .select({
      userId: errorObservations.userId,
      // exercises.language, not errorObservations.language: both are the
      // same denormalized value today, but selecting the joined table's
      // column keeps this symmetric with the host-history query above,
      // which groups by exercises.language. A future divergence between the
      // two columns (e.g. a casing bug on one write path) would otherwise
      // silently split one (user, point) into two group keys and race two
      // upserts on the same onConflict target.
      language: exercises.language,
      grammarPointKey: errorObservations.errorGrammarPointKey,
      severity: errorObservations.severity,
      occurredAt: errorObservations.occurredAt,
      exerciseHistoryId: errorObservations.exerciseHistoryId,
      demotionReason: exercises.demotionReason,
    })
    .from(errorObservations)
    .innerJoin(exercises, eq(errorObservations.exerciseId, exercises.id))
    .where(and(...obsWhere))
    .orderBy(asc(errorObservations.occurredAt));

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

  // Collapse to one observation per (submission, point), worst score wins —
  // mirroring incidentalObservations(), which folds a submission's errors on
  // the same point into a single worst-severity observation. Without this a
  // submission flagging three errors on one point would fold three penalties.
  //
  // Difficulty: the VIOLATED point's own `cefrLevel`, via the same
  // `getGrammarPoint` lookup the live fold performs — NOT the host
  // exercise's difficulty. `updateMastery` weights a losing observation by
  // `DW_PIVOT - dw`, so this is load-bearing: a major error on a fresh point
  // folds to 0.1250 at A1 but 0.1786 at B2, and attribution keys always come
  // from `grammarPointsAtOrBelow(language, exercise.difficulty)`, so an
  // incidental point is always at or below the host's difficulty — using
  // the host's difficulty here would systematically under-penalize on every
  // non-A1 exercise. A point missing from the curriculum (renamed/removed
  // key) is skipped entirely, matching the live loop's `continue`, so it
  // cannot mint a mastery row the live path would never write.
  const worstPerSubmission = new Map<string, {
    userId: string; language: string; grammarPointKey: string;
    score: number; difficulty: CefrLevel; occurredAt: Date; demotionReason: string | null;
  }>();
  for (const r of observationRows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    const point = getGrammarPoint(r.grammarPointKey);
    if (!point) continue;
    const severity = r.severity as 'major' | 'minor';
    const score = SEVERITY_SCORE[severity];
    if (score === undefined) continue;
    const key = `${r.exerciseHistoryId} ${r.grammarPointKey}`;
    const prev = worstPerSubmission.get(key);
    if (prev === undefined || score < prev.score) {
      worstPerSubmission.set(key, {
        userId: r.userId, language: r.language, grammarPointKey: r.grammarPointKey,
        score, difficulty: point.cefrLevel as CefrLevel, occurredAt: new Date(r.occurredAt as Date),
        demotionReason: r.demotionReason,
      });
    }
  }

  for (const o of worstPerSubmission.values()) {
    const k: GroupKey = `${o.userId} ${o.language}`;
    langOf.set(k, o.language);
    // sourceRank: 1 marks this as an incidental entry for replayHistory's
    // (timestamp, sourceRank) tie-break — host defaults to 0. This does NOT
    // mirror the live submit path, which folds incidental first and host
    // last (`infra/lambda/src/routes/exercises.ts`); that live order has no
    // numeric effect because `incidentalObservations` already excludes any
    // error attributed to the host point, so the host point and incidental
    // points in one submission are disjoint and replayHistory folds per
    // grammar point — the two orders can never touch the same point at the
    // same instant. sourceRank is defence in depth against that invariant
    // changing, not a replay of live ordering.
    const entry: HistoryRow = {
      grammarPointKey: o.grammarPointKey,
      score: o.score,
      difficulty: o.difficulty,
      evaluatedAt: o.occurredAt,
      sourceRank: 1,
    };
    pushToGroup(unfilteredByGroup, k, entry);
    if (!isNonEvidenceReason(o.demotionReason)) pushToGroup(survivingByGroup, k, entry);
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

  // --- Delete-count circuit breaker ---------------------------------------
  // `null`/absent maxDeletes is unbounded (current behaviour). When set and
  // exceeded on an --apply run, the WHOLE run writes nothing — not the
  // deletes, and not the upserts either — so a tripped breaker can never
  // leave a partial apply behind. Computed here, before either write loop,
  // so both can be guarded on it; the counts and diff below are still the
  // real computed values regardless, so the caller can log what was refused.
  const maxDeletes = opts.maxDeletes ?? null;
  const aborted = apply && maxDeletes !== null && staleRows.length > maxDeletes;

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
      if (!apply || aborted) continue;
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

  if (apply && !aborted) {
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
    aborted,
  };
}
