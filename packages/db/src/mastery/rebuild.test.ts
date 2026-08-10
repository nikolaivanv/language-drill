/**
 * Tests for `pnpm backfill:mastery`, focused on the stale-mastery-row
 * deletion added alongside the scoring-evidence filter (Task 5 fix round),
 * and rewritten for the final-review Critical-1 fix (2026-08-09): the old
 * rule flagged a row stale whenever the SURVIVING (filtered) replay produced
 * no entry for it — but absence from a filtered replay has causes other than
 * demotion, chiefly `incidentalObservations()`
 * (packages/db/src/mastery/incidental-fold.ts), which writes a
 * `user_grammar_mastery` row for a grammar point that has ZERO
 * `user_exercise_history` rows naming it at all. The old rule deleted those
 * rows unconditionally; this suite pins the fix (diff the UNFILTERED replay
 * against the SURVIVING replay — only delete a row that appears in the
 * former and not the latter).
 *
 * Layered like `review-flagged.test.ts` / `backfill-demotion-reason.test.ts`:
 *   - Pure unit tests for `findStaleMasteryRows` / `planStaleMasteryDeletions`
 *     / `summarize` — no DB.
 *   - Integration tests for `run()` against a fake `Db` (no real Postgres
 *     connection), mirroring `tryApprove`'s fake-`Db` pattern in
 *     `review-flagged.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { and } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import type { Db } from '../client';
import { errorObservations, userExerciseHistory, userGrammarMastery } from '../schema';
import { updateMastery, replayHistory, type MasteryState, type HistoryRow } from './update';
import { SEVERITY_SCORE } from './incidental-fold';
import {
  findStaleMasteryRows,
  planStaleMasteryDeletions,
  summarize,
  formatDiffReport,
  pointKey,
  run,
  incidentalObservationsWhere,
  hostHistoryWhere,
  type StaleMasteryRow,
  type MasteryShift,
} from './rebuild';

const STATE: MasteryState = {
  masteryScore: 0.8,
  confidence: 0.6,
  evidenceCount: 3,
  lastPracticedAt: new Date('2026-07-01T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// findStaleMasteryRows
// ---------------------------------------------------------------------------

describe('findStaleMasteryRows', () => {
  it('flags a row present in the unfiltered replay but absent from the surviving one (every attempt demoted)', () => {
    const unfilteredStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 ES', new Map([
        ['es-a1-ser-estar', STATE],
        ['es-a1-preterite', STATE], // was replayed unfiltered...
      ])],
    ]);
    const survivingStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])], // ...but filtered out entirely
    ]);
    const existingRows: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' }, // still has evidence
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' }, // all evidence demoted
    ];

    const stale = findStaleMasteryRows(unfilteredStatesByGroup, survivingStatesByGroup, existingRows);

    expect(stale).toEqual([
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
    ]);
  });

  it('returns an empty array when every existing row still has surviving evidence', () => {
    const states = new Map<string, Map<string, MasteryState>>([
      ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])],
    ]);
    const existingRows: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
    ];

    expect(findStaleMasteryRows(states, states, existingRows)).toEqual([]);
  });

  // The Critical-1 regression case: a mastery row for a grammar point with NO
  // history rows naming it at all — the incidental-fold shape
  // (packages/db/src/mastery/incidental-fold.ts writes mastery for
  // errors attributed to a point OTHER than the submission's host exercise,
  // with zero `user_exercise_history` rows for that point). The OLD rule
  // ("stale iff absent from the surviving/filtered replay") deleted this row,
  // because it's absent from every replay, filtered or not. The fix requires
  // the row to have been produced by the UNFILTERED replay first — which an
  // incidental-only point never is — so it must survive untouched.
  it('does NOT flag an incidental-fold-style row (absent from BOTH the unfiltered and surviving replay)', () => {
    const unfilteredStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 TR', new Map([['tr-a1-locative', STATE]])], // only the host point was ever replayed
    ]);
    const survivingStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 TR', new Map([['tr-a1-locative', STATE]])],
    ]);
    const existingRows: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' },
      // Written by incidentalObservations() from an error attributed to a
      // DIFFERENT point than the host exercise — no history row anywhere
      // names 'tr-a1-possessive-suffixes' directly, so it never appears in either
      // replay map above.
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive-suffixes' },
    ];

    const stale = findStaleMasteryRows(unfilteredStatesByGroup, survivingStatesByGroup, existingRows);

    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// planStaleMasteryDeletions — the two required guards
// ---------------------------------------------------------------------------

describe('planStaleMasteryDeletions', () => {
  const unfilteredStatesByGroup = new Map<string, Map<string, MasteryState>>([
    ['user-1 ES', new Map([
      ['es-a1-ser-estar', STATE],
      ['es-a1-preterite', STATE],
    ])],
  ]);
  const survivingStatesByGroup = new Map<string, Map<string, MasteryState>>([
    ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])],
  ]);
  const existingRows: StaleMasteryRow[] = [
    { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
    { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' }, // would be stale
  ];

  it('deletes nothing when --include-demoted is set — the rollback path never deletes', () => {
    const plan = planStaleMasteryDeletions({
      includeDemoted: true,
      unfilteredStatesByGroup,
      survivingStatesByGroup,
      existingRows,
    });
    expect(plan).toEqual([]);
  });

  it('skips a run with zero surviving-history groups instead of treating it as "delete everything"', () => {
    // Simulates the evidence query coming back empty for an unrelated reason
    // (e.g. an overly narrow --user/--language filter, or a transient
    // upstream issue) — survivingStatesByGroup is empty even though
    // existingRows (from an unscoped caller) is not.
    const plan = planStaleMasteryDeletions({
      includeDemoted: false,
      unfilteredStatesByGroup,
      survivingStatesByGroup: new Map(),
      existingRows,
    });
    expect(plan).toEqual([]);
  });

  it('deletes the zero-evidence row when a group has some surviving history and include-demoted is off', () => {
    const plan = planStaleMasteryDeletions({
      includeDemoted: false,
      unfilteredStatesByGroup,
      survivingStatesByGroup,
      existingRows,
    });
    expect(plan).toEqual([
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// summarize — dry-run reports the delete count separately from the upsert count
// ---------------------------------------------------------------------------

describe('summarize', () => {
  it('reports upserts and deletes as separate counts in dry-run mode', () => {
    const msg = summarize({
      apply: false,
      upserts: 4,
      deletes: 2,
      groupCount: 3,
      historyRowCount: 10,
      includeDemoted: false,
    });
    expect(msg).toContain('Would write 4 mastery rows');
    expect(msg).toContain('Would delete 2 stale mastery');
    // The two counts must not be conflatable — a reader scanning for a
    // single combined number should not find one.
    expect(msg).not.toMatch(/\b6\b/);
  });

  it('omits the delete clause entirely when --include-demoted is set', () => {
    const msg = summarize({
      apply: false,
      upserts: 4,
      deletes: 0,
      groupCount: 3,
      historyRowCount: 10,
      includeDemoted: true,
    });
    expect(msg).not.toContain('delete');
    expect(msg).not.toContain('Delete');
  });
});

// ---------------------------------------------------------------------------
// formatDiffReport — every pre-existing row lands in exactly ONE of
// rebuilt / deleted / stale (the invariant the --apply review gate relies
// on; see the doc comment on formatDiffReport for why `stale` must be a set
// difference against BOTH other buckets, not just `rebuiltKeys`).
// ---------------------------------------------------------------------------

describe('formatDiffReport — the three-way partition invariant', () => {
  // "rebuilt" has no standalone printed count in the report — its size is
  // the number of `shifts` fed in with a non-null `from`, which each test
  // below constructs explicitly and asserts against directly (`knownRebuiltCount`).

  const deletedCount = (report: string): number => {
    const m = report.match(/deleted — existing rows removed outright[^:]*:\s*(\d+)/);
    if (!m) throw new Error(`no 'deleted' line found in report:\n${report}`);
    return Number(m[1]);
  };

  const staleCount = (report: string): number => {
    const m = report.match(/stale \(neither rebuilt nor deleted\)[^:]*:\s*(\d+)/);
    if (!m) throw new Error(`no 'stale' line found in report:\n${report}`);
    return Number(m[1]);
  };

  it('partitions every pre-existing row into exactly one of rebuilt / deleted / stale', () => {
    // Three pre-existing rows, one per bucket, each on a distinct grammar
    // point so the buckets can't accidentally collide by construction:
    //   - es-a1-preterite   → REBUILT (appears in `shifts` with from !== null)
    //   - es-a1-imperfect   → DELETED (appears in `deleted`)
    //   - es-a1-subjunctive → STALE   (appears in neither)
    const rebuiltShift: MasteryShift = {
      userId: 'user-1',
      grammarPointKey: 'es-a1-preterite',
      from: 0.5,
      fromConfidence: 0.4,
      to: 0.6,
    };
    const deletedRow: StaleMasteryRow = {
      userId: 'user-1',
      language: 'ES',
      grammarPointKey: 'es-a1-imperfect',
    };
    const existingKeys = new Set([
      pointKey('user-1', 'es-a1-preterite'),
      pointKey('user-1', 'es-a1-imperfect'),
      pointKey('user-1', 'es-a1-subjunctive'),
    ]);

    const report = formatDiffReport({
      shifts: [rebuiltShift],
      existingKeys,
      deleted: [deletedRow],
    });

    // Known by construction: exactly one row was fed into `shifts`.
    const knownRebuiltCount = 1;
    const deleted = deletedCount(report);
    const stale = staleCount(report);

    // The invariant: the three bucket sizes sum to the input size. If a row
    // were double-counted into two buckets (the bug this suite pins), this
    // sum would exceed existingKeys.size.
    expect(knownRebuiltCount + deleted + stale).toBe(existingKeys.size);
    expect(deleted).toBe(1);
    expect(stale).toBe(1);
  });

  it('does not report a deleted row as stale (the specific miscount the 2026-08-09 fix corrected)', () => {
    // A single pre-existing row that is deleted and NOT rebuilt. The pre-fix
    // rule computed `stale` as "absent from `rebuiltKeys`" alone, so a
    // deleted-but-never-rebuilt row was ALSO counted as stale — double
    // counting the same row into both the "deleted" and "stale" lines.
    const deletedRow: StaleMasteryRow = {
      userId: 'user-1',
      language: 'ES',
      grammarPointKey: 'es-a1-imperfect',
    };
    const existingKeys = new Set([pointKey('user-1', 'es-a1-imperfect')]);

    const report = formatDiffReport({
      shifts: [],
      existingKeys,
      deleted: [deletedRow],
    });

    expect(deletedCount(report)).toBe(1);
    expect(staleCount(report)).toBe(0);
  });

  it('reports a row that is neither rebuilt nor deleted as stale, so the bucket is not silently empty', () => {
    const existingKeys = new Set([pointKey('user-1', 'es-a1-subjunctive')]);

    const report = formatDiffReport({
      shifts: [],
      existingKeys,
      deleted: [],
    });

    expect(staleCount(report)).toBe(1);
    expect(deletedCount(report)).toBe(0);
  });

  it('names all three buckets and lists deleted rows individually, since deletion is irreversible', () => {
    const deleted: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-imperfect' },
      { userId: 'user-2', language: 'TR', grammarPointKey: 'tr-a1-possessive-suffixes' },
    ];
    const existingKeys = new Set([
      pointKey('user-1', 'es-a1-imperfect'),
      pointKey('user-2', 'tr-a1-possessive-suffixes'),
      pointKey('user-1', 'es-a1-subjunctive'), // stale
    ]);

    const report = formatDiffReport({
      shifts: [],
      existingKeys,
      deleted,
    });

    // All three buckets are named in the report...
    expect(report).toMatch(/deleted — existing rows removed outright/);
    expect(report).toMatch(/stale \(neither rebuilt nor deleted\)/);
    // ...and the deleted rows are listed individually, not just counted —
    // an operator reviewing an --apply run needs to see exactly which rows
    // are about to be removed.
    expect(report).toContain('Deleted rows (2)');
    expect(report).toContain('es-a1-imperfect');
    expect(report).toContain('ES');
    expect(report).toContain('user-1');
    expect(report).toContain('tr-a1-possessive-suffixes');
    expect(report).toContain('TR');
    expect(report).toContain('user-2');
  });
});

// ---------------------------------------------------------------------------
// incidentalObservationsWhere — SQL-render tests
// ---------------------------------------------------------------------------
//
// `run()`'s error_observations query is exercised elsewhere in this file
// against a mocked `Db`, which cannot execute a real WHERE predicate — the
// `fakeDb()` helper below performs the host-match and null-attribution
// exclusions itself in JS (see its doc comment), so a test that only goes
// through `run()` + `fakeDb()` can pass or fail independent of whether
// `incidentalObservationsWhere` actually builds those predicates: deleting
// one of the three conditions from the source would not fail any test that
// only touches the mock. These tests render the builder's REAL SQL instead —
// the same pattern `evidence.test.ts` uses to pin `scoringEvidenceFilter`.
describe('incidentalObservationsWhere', () => {
  it('excludes host-attributed errors via a host-vs-error <> comparison', () => {
    const { sql } = new PgDialect().sqlToQuery(and(...incidentalObservationsWhere({}))!);
    const lower = sql.toLowerCase();
    expect(lower).toContain('error_grammar_point_key');
    expect(lower).toContain('host_grammar_point_key');
    // Both columns appear on either side of a <>, not just present somewhere
    // in the rendered SQL — pins the actual comparison, not just column
    // presence (e.g. from the isNotNull predicate alone).
    expect(lower).toMatch(/error_grammar_point_key"\s*<>\s*"error_observations"\."host_grammar_point_key"/);
  });

  it('requires the violated point to be attributed (IS NOT NULL)', () => {
    const { sql } = new PgDialect().sqlToQuery(and(...incidentalObservationsWhere({}))!);
    expect(sql.toLowerCase()).toContain('is not null');
  });

  it('excludes free-writing observations by binding the exercise-type value as a bound param', () => {
    // error_observations.exercise_type is `.notNull()` in the schema (see
    // packages/db/src/schema/progress.ts), so this `<>` has no NULL-semantics
    // hole the way the host-vs-error `<>` deliberately does (see the doc
    // comment on `incidentalObservationsWhere` in rebuild.ts) — every row has
    // a real exercise_type value to compare against.
    const { sql, params } = new PgDialect().sqlToQuery(and(...incidentalObservationsWhere({}))!);
    expect(sql.toLowerCase()).toContain('exercise_type');
    expect(params).toContain(ExerciseType.FREE_WRITING);
  });
});

// ---------------------------------------------------------------------------
// hostHistoryWhere — SQL-render tests
// ---------------------------------------------------------------------------
//
// Extracted (2026-08-10) so the host query's free-writing exclusion is pinned
// the same way `incidentalObservationsWhere` already is above. Before this,
// `run()` built its `where` array inline, and the free-writing tests in the
// `run()` suite below only ever exercised it through `fakeDb()`'s hand-rolled
// JS emulation of the predicate (see that helper's doc comment) — a test
// suite that would stay green even if the real predicate here named the
// wrong column or the wrong value. These tests render the builder's REAL SQL
// instead.
describe('hostHistoryWhere', () => {
  it('excludes free-writing rows by binding the exercise-type value as a bound param', () => {
    // exercises.type is nullable — unlike error_observations.exercise_type,
    // which is `.notNull()` (see the `incidentalObservationsWhere` free-writing
    // test above) — so this `<>` also excludes any row whose exercise has a
    // NULL type. See the doc comment on `hostHistoryWhere` in rebuild.ts for
    // why that's theoretical (no insert path produces one today) and why the
    // consequence, if one ever did, is score drift rather than a spurious
    // deletion.
    const { sql, params } = new PgDialect().sqlToQuery(and(...hostHistoryWhere({}))!);
    expect(sql.toLowerCase()).toContain('"type"');
    expect(params).toContain(ExerciseType.FREE_WRITING);
  });

  it('requires the host grammar point, score, and evaluatedAt to be attributed (IS NOT NULL)', () => {
    const { sql } = new PgDialect().sqlToQuery(and(...hostHistoryWhere({}))!);
    const lower = sql.toLowerCase();
    expect(lower).toContain('grammar_point_key');
    expect(lower).toContain('is not null');
  });
});

// ---------------------------------------------------------------------------
// run() — full orchestration against a fake Db (no real Postgres connection)
// ---------------------------------------------------------------------------

type FakeRunResult = {
  db: Db;
  inserts: unknown[];
  deleteCalls: number;
  masteryQueried: boolean;
  /** Call order of the two tables' first `.from()` — proves the Important-2
   *  reordering (mastery snapshot before history query). */
  fromCallOrder: string[];
};

function makeFakeDb(params: {
  historyRows: unknown[];
  existingMasteryRows: unknown[];
  observationRows?: unknown[];
}): FakeRunResult {
  const inserts: unknown[] = [];
  let deleteCalls = 0;
  let masteryQueried = false;
  const fromCallOrder: string[] = [];

  const db = {
    select: (_proj: unknown) => ({
      from: (table: unknown) => {
        if (table === userExerciseHistory) {
          fromCallOrder.push('history');
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: (_o: unknown) => Promise.resolve(params.historyRows),
              }),
            }),
          };
        }
        if (table === errorObservations) {
          fromCallOrder.push('observations');
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: (_o: unknown) => Promise.resolve(params.observationRows ?? []),
              }),
            }),
          };
        }
        if (table === userGrammarMastery) {
          fromCallOrder.push('mastery');
          masteryQueried = true;
          return {
            where: (_w: unknown) => Promise.resolve(params.existingMasteryRows),
          };
        }
        throw new Error(`unexpected table in fake db.select().from(): ${String(table)}`);
      },
    }),
    insert: (_table: unknown) => ({
      values: (v: unknown) => {
        inserts.push(v);
        return { onConflictDoUpdate: (_o: unknown) => Promise.resolve() };
      },
    }),
    delete: (_table: unknown) => ({
      where: (_w: unknown) => {
        deleteCalls += 1;
        return Promise.resolve();
      },
    }),
  } as unknown as Db;

  return {
    db,
    inserts,
    get deleteCalls() {
      return deleteCalls;
    },
    get masteryQueried() {
      return masteryQueried;
    },
    fromCallOrder,
  };
}

function historyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    language: 'ES',
    grammarPointKey: 'es-a1-ser-estar',
    score: 0.9,
    difficulty: CefrLevel.A1,
    evaluatedAt: new Date('2026-07-01T00:00:00Z'),
    evidenceWeight: null,
    demotionReason: null,
    ...overrides,
  };
}

/**
 * Minimal fake `Db` answering the three `select().from()` shapes `run()`
 * issues (mastery snapshot, history query, error-observations query) plus
 * the insert/delete calls, for the incidental-observation-focused tests
 * below. Simpler than `makeFakeDb`'s `FakeRunResult` wrapper — these tests
 * only care about `run()`'s return value, not call counts.
 *
 * The observations AND history branches emulate what the REAL queries in
 * `run()` return from Postgres — not a raw pass-through of the fixtures.
 * Things a raw pass-through would get wrong:
 *   1. The `.select({ grammarPointKey: errorObservations.errorGrammarPointKey, ... })`
 *      projection renames the column on the way out, so callers here supply
 *      fixtures shaped like the raw row (`errorGrammarPointKey`,
 *      `hostGrammarPointKey`) and this helper performs the same rename.
 *   2. `incidentalObservationsWhere`'s three predicates (host-match,
 *      null-attribution, free-writing) are evaluated by Postgres before any
 *      row reaches `run()` — including the NULL-yields-not-true behaviour of
 *      `<>` — so they're applied here too. Without this, tests asserting an
 *      exclusion (host-attributed error, null-attributed error,
 *      free-writing) would pass or fail for the wrong reason depending on
 *      unrelated code, since `run()` itself has no JS-level re-check (it
 *      trusts the query). The `incidentalObservationsWhere` suite above pins
 *      the real predicates' rendered SQL directly; this emulation exists so
 *      `run()`-level tests aren't silently fooled by a mock that lets
 *      everything through.
 *   3. Symmetrically, the host-history query's `ne(exercises.type,
 *      ExerciseType.FREE_WRITING)` predicate (added alongside the
 *      observations one — see `run()`'s history `where` array in
 *      `rebuild.ts`) is emulated here too: `history` fixtures may carry an
 *      `exerciseType` field (defaulting to non-free-writing) that this
 *      helper filters on and then strips, exactly like `observations`.
 */
function fakeDb(params: {
  /**
   * Raw history fixtures. An optional `exerciseType` field (defaulting to a
   * non-free-writing type, matching the `observations` fixtures below) drives
   * the same free-writing exclusion the real host-history query now applies
   * via `ne(exercises.type, ExerciseType.FREE_WRITING)` — this fake emulates
   * that predicate in JS the same way it already does for `observations`,
   * then strips the field before returning (the real projection never
   * selects `exercises.type` either).
   */
  history: Array<Record<string, unknown> & { exerciseType?: string }>;
  observations: Array<{
    userId: string;
    language: string;
    hostGrammarPointKey: string | null;
    errorGrammarPointKey: string | null;
    severity: string;
    occurredAt: Date;
    exerciseHistoryId: string;
    difficulty: string;
    demotionReason: string | null;
    /** Defaults to a non-free-writing type when omitted. */
    exerciseType?: string;
  }>;
  existing: unknown[];
}): Db & { insertCalls: number; deleteCalls: number } {
  const historyRows = params.history
    .filter((r) => (r.exerciseType ?? ExerciseType.CLOZE) !== ExerciseType.FREE_WRITING)
    .map((r) => {
      const { exerciseType: _exerciseType, ...rest } = r;
      return rest;
    });

  const observationRows = params.observations
    .filter(
      (o) =>
        o.errorGrammarPointKey != null &&
        o.errorGrammarPointKey !== o.hostGrammarPointKey &&
        (o.exerciseType ?? ExerciseType.CLOZE) !== ExerciseType.FREE_WRITING,
    )
    .map((o) => ({
      userId: o.userId,
      language: o.language,
      grammarPointKey: o.errorGrammarPointKey,
      severity: o.severity,
      occurredAt: o.occurredAt,
      exerciseHistoryId: o.exerciseHistoryId,
      difficulty: o.difficulty,
      demotionReason: o.demotionReason,
    }));

  let insertCalls = 0;
  let deleteCalls = 0;

  return {
    select: (_proj: unknown) => ({
      from: (table: unknown) => {
        if (table === userExerciseHistory) {
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: (_o: unknown) => Promise.resolve(historyRows),
              }),
            }),
          };
        }
        if (table === errorObservations) {
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: (_o: unknown) => Promise.resolve(observationRows),
              }),
            }),
          };
        }
        if (table === userGrammarMastery) {
          return {
            where: (_w: unknown) => Promise.resolve(params.existing),
          };
        }
        throw new Error(`unexpected table in fake db.select().from(): ${String(table)}`);
      },
    }),
    insert: (_table: unknown) => ({
      values: (_v: unknown) => {
        insertCalls += 1;
        return { onConflictDoUpdate: (_o: unknown) => Promise.resolve() };
      },
    }),
    delete: (_table: unknown) => ({
      where: (_w: unknown) => {
        deleteCalls += 1;
        return Promise.resolve();
      },
    }),
    get insertCalls() {
      return insertCalls;
    },
    get deleteCalls() {
      return deleteCalls;
    },
  } as unknown as Db & { insertCalls: number; deleteCalls: number };
}

describe('run — the existing-mastery snapshot is taken before the history query (Important-2 TOCTOU fix)', () => {
  it('queries user_grammar_mastery before user_exercise_history', async () => {
    const fake = makeFakeDb({
      historyRows: [historyRow()],
      existingMasteryRows: [],
    });
    await run(fake.db, { apply: false, includeDemoted: false });
    // A third query (error_observations, Task 4) now runs right after
    // history — same TOCTOU-narrowing rationale doesn't apply to it (it
    // reconstructs a DIFFERENT source of evidence, not a re-read of mastery),
    // so it's fine for it to land after both.
    expect(fake.fromCallOrder).toEqual(['mastery', 'history', 'observations']);
  });
});

describe('run — zero-evidence stale-row deletion, end to end against a fake Db', () => {
  it('deletes the stale row and reports upserts/deletes separately when --apply is set', async () => {
    // user-1/ES has surviving evidence for es-a1-ser-estar only. The
    // pre-existing mastery table (per the fake) also has a row for
    // es-a1-preterite, which HAD a history row (demoted) but no surviving
    // evidence — it must be deleted, not silently left stale.
    const fake = makeFakeDb({
      historyRows: [
        historyRow(),
        historyRow({
          grammarPointKey: 'es-a1-preterite',
          demotionReason: 'quality',
        }),
      ],
      existingMasteryRows: [
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
      ],
    });

    const result = await run(fake.db, {
      apply: true,
      includeDemoted: false,
    });

    expect(result.upserts).toBe(1);
    expect(result.deletes).toBe(1);
    expect(fake.inserts).toHaveLength(1);
    expect(fake.deleteCalls).toBe(1);
  });

  // The Critical-1 regression, exercised through the full run() orchestration
  // (not just the pure findStaleMasteryRows unit): a mastery row for a
  // grammar point with NO history rows at all — the incidental-fold shape —
  // must survive a full apply pass untouched. This test FAILS against the
  // pre-fix implementation, which deleted any row absent from the (filtered)
  // replay regardless of whether it ever had history to begin with.
  it('does NOT delete an incidental-fold-style mastery row that has zero history rows', async () => {
    const fake = makeFakeDb({
      // Only the host point (tr-a1-locative) has ANY history row. No row
      // anywhere names 'tr-a1-possessive-suffixes' — it only exists in
      // user_grammar_mastery because incidentalObservations() wrote it
      // directly from an evaluator error on an unrelated submission.
      historyRows: [
        historyRow({ userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' }),
      ],
      existingMasteryRows: [
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' },
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive-suffixes' },
      ],
    });

    const result = await run(fake.db, {
      apply: true,
      includeDemoted: false,
    });

    expect(result.deletes).toBe(0);
    expect(fake.deleteCalls).toBe(0);
  });

  it('computes but does not write in dry-run mode (apply: false)', async () => {
    const fake = makeFakeDb({
      historyRows: [
        historyRow(),
        historyRow({
          grammarPointKey: 'es-a1-preterite',
          demotionReason: 'quality',
        }),
      ],
      existingMasteryRows: [
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
      ],
    });

    const result = await run(fake.db, {
      apply: false,
      includeDemoted: false,
    });

    // Counts are still computed for visibility...
    expect(result.upserts).toBe(1);
    expect(result.deletes).toBe(1);
    // ...but nothing was actually written.
    expect(fake.inserts).toHaveLength(0);
    expect(fake.deleteCalls).toBe(0);
  });

  it('never deletes when --include-demoted is set, even with a stale-looking row present', async () => {
    const fake = makeFakeDb({
      historyRows: [
        historyRow(),
        historyRow({
          grammarPointKey: 'es-a1-preterite',
          demotionReason: 'quality',
        }),
      ],
      existingMasteryRows: [
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
      ],
    });

    const result = await run(fake.db, {
      apply: true,
      includeDemoted: true,
    });

    expect(result.deletes).toBe(0);
    expect(fake.deleteCalls).toBe(0);
    // Upserts still happen, from the FULL (unfiltered) replay — this time
    // covering both points, since --include-demoted feeds the demoted row
    // back into scoring too.
    expect(result.upserts).toBe(2);
  });

  it('runs the mastery lookup even when history comes back empty, but deletes nothing (guarded by planStaleMasteryDeletions)', async () => {
    // The mastery snapshot is now taken UNCONDITIONALLY, before history is
    // even read (Important-2 fix) — so it can no longer be gated on history
    // being non-empty. Correctness still holds: with zero surviving history,
    // `planStaleMasteryDeletions`'s empty-groups guard means nothing gets
    // deleted regardless of what the mastery snapshot contains.
    const fake = makeFakeDb({
      historyRows: [],
      existingMasteryRows: [
        { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
        { userId: 'user-2', language: 'DE', grammarPointKey: 'de-a1-cases' },
      ],
    });

    const result = await run(fake.db, {
      apply: true,
      includeDemoted: false,
    });

    expect(result.upserts).toBe(0);
    expect(result.deletes).toBe(0);
    expect(fake.deleteCalls).toBe(0);
    expect(fake.masteryQueried).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Incidental observations folded into the replay (Task 4) — the fidelity
// fix: `error_observations` reconstructs the incidental fold the live submit
// path applies but `user_exercise_history` alone cannot replay, since
// incidental observations leave no history row naming the point they hit.
// ---------------------------------------------------------------------------

describe('incidental observations in the replay', () => {
  it('folds an incidental observation for a point with no host history', async () => {
    // The point exists only because an evaluator error was attributed to it.
    // Before this change the replay never saw it and the row looked stale.
    // 'tr-a1-locative' — a real curriculum key — is required here: the
    // grouping loop calls `getGrammarPoint(r.grammarPointKey)` and `continue`s
    // on a miss, so a fixture using a fake key like 'p' silently drops the
    // observation and this test fails for the wrong reason.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'tr-a1-locative',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'tr-a1-locative');
    expect(shift).toBeDefined();
    expect(result.deletes).toBe(0);
  });

  it('collapses multiple errors on one point within a submission to the worst score', async () => {
    // incidentalObservations() takes the worst severity per (submission, point).
    // Folding three observations instead of one would triple-count the penalty.
    //
    // Asserting only `historyRowCount === 1` is too weak: flipping the
    // source's `score < prev.score` to `score > prev.score` still collapses
    // three observations to one row either way (the dedup key is the same
    // regardless of which severity wins) — it would just silently pick the
    // BEST severity (minor, 0.4) instead of the worst (major, 0.0), turning a
    // major error into a 0.4 minor penalty while staying green. Pin the
    // actual folded value too, against a live-fold simulation using the
    // violated point's own level (SEVERITY_SCORE.major @ A1).
    const at = new Date('2026-01-01');
    const obs = (severity: 'major' | 'minor') => ({
      userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'tr-a1-locative',
      severity, occurredAt: at, exerciseHistoryId: 'h1',
      difficulty: 'A1', demotionReason: null,
    });
    const result = await run(fakeDb({
      history: [], observations: [obs('minor'), obs('major'), obs('minor')], existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(1);
    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'tr-a1-locative')!;
    expect(shift.to).toBeCloseTo(
      updateMastery(null, { score: SEVERITY_SCORE.major, difficulty: CefrLevel.A1, at }).masteryScore,
      10,
    );
  });

  it('ignores an error attributed to the host point itself', async () => {
    // Already reflected in the submission score; folding it again double-penalizes.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'p', errorGrammarPointKey: 'p',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  it('excludes an observation recorded against a defect-demoted exercise', async () => {
    // Must use a real curriculum key here, per the trap the test above this
    // one warns about: `getGrammarPoint()` is consulted and `continue`s on a
    // miss BEFORE `demotionReason` is ever examined, so a fake key like 'p'
    // would make `historyRowCount === 0` regardless of whether the demotion
    // filter exists at all — the test would pass even if this filter were
    // deleted.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'tr-a1-locative',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: 'quality' },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  it('ignores an observation with no attributed grammar point', async () => {
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: null,
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  it('excludes an observation recorded on a free-writing exercise', async () => {
    // POST /exercises/:id/submit's free-writing branch calls
    // recordErrorObservations and then returns — it never reaches
    // incidentalObservations(), so free-writing errors have NEVER folded
    // into mastery on the live path. Replaying these rows here would inject
    // a penalty the live path never applied, and the nightly diff would
    // never settle to zero on an account with free-writing history.
    const result = await run(fakeDb({
      history: [],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'tr-a1-locative',
          severity: 'major', occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null, exerciseType: ExerciseType.FREE_WRITING },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
  });

  // What this pins, precisely: `run()` is a pure function of the rows a fake
  // `Db` hands it, and each call below builds a FRESH `fakeDb()` from the
  // same plain-object `inputs` — so this only catches nondeterminism
  // internal to a single replay (Map iteration order, `Array#sort` producing
  // different orderings across runs, floating-point order-of-operations
  // drift). It is NOT a test of the operationally meaningful claim the name
  // suggests — "rebuild the DB, then rebuild it again against what was just
  // written, and confirm the second pass is a no-op" — because that requires
  // the SECOND `run()` to read back the mastery rows the FIRST `run()`
  // wrote, and `fakeDb()`'s `insert().values().onConflictDoUpdate()` is a
  // no-op stub that never feeds written rows back into a subsequent
  // `select().from(userGrammarMastery)` (see its definition above: `where`
  // always resolves `params.existing`, fixed at construction). Reaching the
  // real claim would need a stateful fake that captures inserts and serves
  // them back out, which is out of scope here — this test is a narrower,
  // honest sibling of it.
  it('is deterministic — replaying identical inputs twice against independent fakes yields identical shifts', async () => {
    const inputs = {
      history: [
        { userId: 'u1', language: 'TR', grammarPointKey: 'p', score: 0.9, difficulty: 'A1',
          evaluatedAt: new Date('2026-01-01'), evidenceWeight: null, demotionReason: null },
      ],
      observations: [
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'p', errorGrammarPointKey: 'q',
          severity: 'minor' as const, occurredAt: new Date('2026-01-01'), exerciseHistoryId: 'h1',
          difficulty: 'A1', demotionReason: null },
      ],
      existing: [],
    };
    const a = await run(fakeDb(inputs), { apply: false, includeDemoted: false });
    const b = await run(fakeDb(inputs), { apply: false, includeDemoted: false });
    expect(a.diff.shifts).toEqual(b.diff.shifts);
    expect(a.deletes).toBe(b.deletes);
  });

  it('matches what the live submit path folds call-by-call', async () => {
    // Within a single submission, live actually folds incidental first and
    // host last (`incidentalObservations` loop, then the trailing
    // `applyGrammarMastery(host)` call, in
    // `infra/lambda/src/routes/exercises.ts`) — but that order never matters:
    // `incidentalObservations` excludes any error attributed to the host
    // point, so the host point and a submission's incidental points are
    // disjoint, and folding is per grammar point.
    //
    // This fixture is a different case: the host history below comes from
    // one exercise (`tr-a1-locative`, via `user_exercise_history`) and the
    // incidental observation below comes from a SEPARATE exercise (whose own
    // host point is `host`, unrelated) that happens to violate the same
    // `tr-a1-locative` point at the identical timestamp. Two different
    // submissions CAN land evidence on the same point at the same instant, so
    // fold order here is real and is settled by `sourceRank`'s tie-break
    // (host rank 0 sorts before incidental rank 1) — hence `live` below
    // applies the host observation first, then the incidental one, matching
    // `replayHistory`'s tie-break, not the live submit-path's own internal
    // ordering. A faithful replay of the same events must land on the same
    // number. If this drifts, every nightly rebuild silently rewrites scores.
    //
    // Host difficulty is B2 while the violated point ('tr-a1-locative') is
    // A1 — deliberately different. The incidental fold must be scored at the
    // VIOLATED point's own cefrLevel (A1), not at the host exercise's
    // difficulty column (B2): that is the exact bug this test exists to
    // catch (see the grouping loop's `point.cefrLevel` lookup in rebuild.ts).
    // Setting host === violated difficulty would make this test pass whether
    // or not the code performs that lookup at all.
    const at = new Date('2026-01-01');
    const live = updateMastery(
      updateMastery(null, { score: 0.9, difficulty: CefrLevel.B2, at }),   // host observation, host difficulty
      { score: SEVERITY_SCORE.minor, difficulty: CefrLevel.A1, at },        // incidental, VIOLATED point's level
    );

    const result = await run(fakeDb({
      history: [
        { userId: 'u1', language: 'TR', grammarPointKey: 'tr-a1-locative', score: 0.9, difficulty: 'B2',
          evaluatedAt: at, evidenceWeight: null, demotionReason: null },
      ],
      observations: [
        // hostGrammarPointKey deliberately differs from errorGrammarPointKey
        // (a different exercise's own point) so this row survives the
        // host-match exclusion. difficulty: 'B2' here is the HOST exercise's
        // column — the code must ignore it and look up tr-a1-locative's own
        // level (A1) instead.
        { userId: 'u1', language: 'TR', hostGrammarPointKey: 'host', errorGrammarPointKey: 'tr-a1-locative',
          severity: 'minor', occurredAt: at, exerciseHistoryId: 'h1',
          difficulty: 'B2', demotionReason: null },
      ],
      existing: [],
    }), { apply: false, includeDemoted: false });

    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'tr-a1-locative')!;
    expect(shift.to).toBeCloseTo(live.masteryScore, 10);
  });
});

describe('run — host history excludes free-writing (Important-2 fix, 2026-08-09)', () => {
  it('does not replay a free-writing host history row', async () => {
    // POST /exercises/:id/submit's free-writing branch writes the
    // user_exercise_history row (and records error observations, and the
    // usage event) but returns WITHOUT ever calling applyGrammarMastery —
    // not for the host point either. A free-writing history row DOES carry
    // a non-null grammar_point_key (the free-writing umbrella point), so
    // without the exclusion added to run()'s host-history `where` array,
    // this row would look fully eligible and the rebuild would mint a
    // user_grammar_mastery row the live app has never written — and keep
    // moving it after every subsequent free-writing submission, so the
    // nightly diff would never settle to zero on an account with
    // free-writing history.
    //
    // 'es-a1-fw-my-family' — a real free-writing umbrella key from the ES
    // curriculum — is used rather than a fake key like 'p', so a failure
    // here can only mean the free-writing exclusion isn't working, not that
    // the fixture's key failed some unrelated curriculum lookup.
    const result = await run(fakeDb({
      history: [
        {
          userId: 'u1',
          language: 'ES',
          grammarPointKey: 'es-a1-fw-my-family',
          score: 0.9,
          difficulty: 'A1',
          evaluatedAt: new Date('2026-01-01'),
          evidenceWeight: null,
          demotionReason: null,
          exerciseType: ExerciseType.FREE_WRITING,
        },
      ],
      observations: [],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(0);
    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'es-a1-fw-my-family');
    expect(shift).toBeUndefined();
  });

  it('DOES replay the same row when it is a non-free-writing exercise type (control)', async () => {
    const result = await run(fakeDb({
      history: [
        {
          userId: 'u1',
          language: 'ES',
          grammarPointKey: 'es-a1-fw-my-family',
          score: 0.9,
          difficulty: 'A1',
          evaluatedAt: new Date('2026-01-01'),
          evidenceWeight: null,
          demotionReason: null,
          exerciseType: ExerciseType.CLOZE,
        },
      ],
      observations: [],
      existing: [],
    }), { apply: false, includeDemoted: false });

    expect(result.historyRowCount).toBe(1);
    const shift = result.diff.shifts.find((s) => s.grammarPointKey === 'es-a1-fw-my-family');
    expect(shift).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Task 4 deletion vector — an incidental-only mastery row whose backing
// error_observations are ALL later demoted loses its only evidence and is
// now deleted, where before Task 4 it was invisible to both replays and
// survived untouched (see the doc comment on findStaleMasteryRows, the
// paragraph beginning "That is no longer true.").
// ---------------------------------------------------------------------------

describe('run — an incidental-only mastery row is deleted once every observation backing it is demoted (Task 4 deletion vector)', () => {
  // This is DELIBERATE, NEW destructive behaviour that arrived with Task 4,
  // not a pre-existing guarantee. Before incidental observations fed the
  // UNFILTERED replay too, a point with zero host history and only
  // incidental evidence was absent from BOTH replays regardless of
  // demotionReason (pinned above by 'does NOT delete an incidental-fold-
  // style mastery row that has zero history rows') and so could never be
  // flagged stale, no matter how untrustworthy its evidence was. Task 4
  // makes such a point visible to the unfiltered replay whenever its
  // error_observations rows survive at all — so once ALL of them carry a
  // NON_EVIDENCE_DEMOTION_REASON ('quality' or 'learner-flag'), the point now
  // satisfies findStaleMasteryRows's two conditions (present unfiltered,
  // absent from surviving) and is deleted, exactly as a host-only point in
  // the same situation already was. This is "intended justice" per the
  // rebuild.ts doc comment, but nothing before this test exercised it
  // end-to-end through run() — a regression here would silently resurrect
  // the pre-Task-4 blind spot.
  it('deletes a pre-existing mastery row whose only evidence is an incidental observation on a quality-demoted exercise', async () => {
    const at = new Date('2026-01-01');
    const result = await run(fakeDb({
      history: [
        // A DIFFERENT, non-demoted point in the same (user, language) group,
        // required so survivingStatesByGroup isn't empty for this group —
        // otherwise planStaleMasteryDeletions's run-level empty-input guard
        // (pinned by 'skips a run with zero surviving-history groups...'
        // above) would skip deletion for an unrelated reason and this test
        // would pass without ever reaching the deletion logic it targets.
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative', score: 0.9,
          difficulty: 'A1', evaluatedAt: at, evidenceWeight: null, demotionReason: null },
      ],
      observations: [
        // The ONLY evidence for tr-a1-possessive-suffixes anywhere: an incidental
        // observation recorded against an exercise later demoted 'quality'.
        // No user_exercise_history row anywhere names tr-a1-possessive-suffixes.
        { userId: 'user-1', language: 'TR', hostGrammarPointKey: 'host',
          errorGrammarPointKey: 'tr-a1-possessive-suffixes', severity: 'major', occurredAt: at,
          exerciseHistoryId: 'h1', difficulty: 'A1', demotionReason: 'quality' },
      ],
      existing: [
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' },
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive-suffixes' },
      ],
    }), { apply: true, includeDemoted: false });

    expect(result.diff.deleted).toContainEqual(
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive-suffixes' },
    );
    expect(result.deletes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 5 — delete-count circuit breaker. Deletion is the only irreversible
// thing run() does, and a later task runs this nightly and unattended, so a
// delete count that looks systemic must stop the whole run rather than guess.
// ---------------------------------------------------------------------------

describe('delete circuit breaker', () => {
  const at = new Date('2026-01-01');
  // Same shape as the single-deletion fixture just above (incidental-only
  // evidence, all demoted 'quality'), repeated for three points (p1/p2/p3) to
  // get three deletions out of one run. tr-a1-locative is the DIFFERENT,
  // non-demoted point carrying real host history in the same (user,
  // language) group — required so survivingStatesByGroup isn't empty for
  // this group; without it, planStaleMasteryDeletions's run-level
  // empty-surviving-group guard skips deletion for an unrelated reason and
  // these tests would pass without ever reaching the breaker logic they
  // target.
  const threeDeletable = {
    history: [
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative', score: 0.9,
        difficulty: 'A1', evaluatedAt: at, evidenceWeight: null, demotionReason: null },
    ],
    observations: [
      { userId: 'user-1', language: 'TR', hostGrammarPointKey: 'host',
        errorGrammarPointKey: 'tr-a1-negation', severity: 'major', occurredAt: at,
        exerciseHistoryId: 'h1', difficulty: 'A1', demotionReason: 'quality' },
      { userId: 'user-1', language: 'TR', hostGrammarPointKey: 'host',
        errorGrammarPointKey: 'tr-a1-questions', severity: 'major', occurredAt: at,
        exerciseHistoryId: 'h2', difficulty: 'A1', demotionReason: 'quality' },
      { userId: 'user-1', language: 'TR', hostGrammarPointKey: 'host',
        errorGrammarPointKey: 'tr-a1-imperative', severity: 'major', occurredAt: at,
        exerciseHistoryId: 'h3', difficulty: 'A1', demotionReason: 'quality' },
    ],
    existing: [
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' },
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-negation' },
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-questions' },
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-imperative' },
    ],
  };

  it('applies normally when deletions are at the threshold', async () => {
    const result = await run(fakeDb(threeDeletable), {
      apply: true,
      includeDemoted: false,
      maxDeletes: 3,
    });
    expect(result.aborted).toBe(false);
    expect(result.deletes).toBe(3);
  });

  it('writes NOTHING when deletions exceed the threshold', async () => {
    const db = fakeDb(threeDeletable);
    const result = await run(db, { apply: true, includeDemoted: false, maxDeletes: 2 });
    expect(result.aborted).toBe(true);
    // The counts and diff are still the real computed values — the caller
    // needs them to log exactly what was refused.
    expect(result.deletes).toBe(3);
    // The whole run aborts — no partial apply. Upserts must not have run
    // either, or the state left behind would be the hardest one to reason
    // about: some points rebuilt, none of the untrustworthy ones removed.
    expect(db.insertCalls).toBe(0);
    expect(db.deleteCalls).toBe(0);
  });

  it('is unbounded when maxDeletes is null', async () => {
    const result = await run(fakeDb(threeDeletable), {
      apply: true,
      includeDemoted: false,
      maxDeletes: null,
    });
    expect(result.aborted).toBe(false);
    expect(result.deletes).toBe(3);
  });

  it('is never aborted on a dry run, regardless of delete count', async () => {
    // apply: false must never report aborted: true, even with a maxDeletes
    // that the (unapplied) delete count would exceed — a dry-run computes
    // deletions but writes nothing anyway, so reporting it as aborted would
    // misrepresent an ordinary preview as a refusal, hiding the real count
    // the operator needs in order to decide.
    const result = await run(fakeDb(threeDeletable), {
      apply: false,
      includeDemoted: false,
      maxDeletes: 0,
    });
    expect(result.aborted).toBe(false);
    expect(result.deletes).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// replayHistory — direct call with the two rows fed in the OPPOSITE
// (incidental-first) array order, which run() never actually produces today.
//
// Honesty note (this test does NOT isolate rebuild.ts's `sourceRank: 1`
// stamp, despite its structure suggesting otherwise):
//   1. Every `run()`-level test in this file passes whether or not
//      `sourceRank: 1` is present on rebuild.ts's incidental HistoryRow
//      entries (line ~610), because rebuild.ts's two push loops (history
//      rows, then worstPerSubmission entries — see run()) always hand
//      replayHistory the host entry before the incidental one, and
//      Array#sort is stable — so insertion order alone already produces
//      host-first fold order, regardless of sourceRank.
//   2. This test bypasses run() entirely and constructs its own HistoryRow
//      fixtures with a literal `sourceRank: 1` baked in, so it can't detect
//      whether rebuild.ts's production code still stamps that value on
//      incidental entries. Confirmed by mutation: deleting `sourceRank: 1`
//      from packages/db/src/mastery/rebuild.ts leaves this test (and the
//      whole suite) passing.
// sourceRank is nonetheless correct and worth keeping — it defends against a
// future reordering of rebuild.ts's two push loops, a change nothing in
// this file would currently catch. It IS directly pinned at the
// replayHistory level by the ordering tests in
// packages/db/src/mastery/update.test.ts.
// ---------------------------------------------------------------------------

describe('replayHistory — sourceRank pins host-before-incidental fold order independent of array order', () => {
  it('folds a same-timestamp host/incidental pair host-first', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const host: HistoryRow = {
      grammarPointKey: 'p',
      score: 0.9,
      difficulty: CefrLevel.B2,
      evaluatedAt: at,
      // sourceRank omitted — defaults to 0, matching the host push loop in
      // run(), which never sets it.
    };
    const incidental: HistoryRow = {
      grammarPointKey: 'p',
      score: SEVERITY_SCORE.major,
      difficulty: CefrLevel.A1,
      evaluatedAt: at,
      sourceRank: 1, // the exact literal rebuild.ts's worstPerSubmission loop sets.
    };

    // Fed incidental-first: if replayHistory consulted array position instead
    // of sourceRank, this would fold incidental, then host.
    const actual = replayHistory([incidental, host]).get('p')!;

    const hostFirst = updateMastery(
      updateMastery(null, { score: host.score, difficulty: host.difficulty, at }),
      { score: incidental.score, difficulty: incidental.difficulty, at },
    );
    const incidentalFirst = updateMastery(
      updateMastery(null, { score: incidental.score, difficulty: incidental.difficulty, at }),
      { score: host.score, difficulty: host.difficulty, at },
    );

    // Sanity check: the fixture must make the two orders actually diverge,
    // or nothing below can discriminate between them.
    expect(hostFirst.masteryScore).not.toBeCloseTo(incidentalFirst.masteryScore, 6);

    expect(actual.masteryScore).toBeCloseTo(hostFirst.masteryScore, 10);
    expect(actual.masteryScore).not.toBeCloseTo(incidentalFirst.masteryScore, 6);
  });
});
