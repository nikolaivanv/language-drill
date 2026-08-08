/**
 * Tests for `pnpm backfill:mastery`, focused on the stale-mastery-row
 * deletion added alongside the scoring-evidence filter (Task 5 fix round),
 * and rewritten for the final-review Critical-1 fix (2026-08-09): the old
 * rule flagged a row stale whenever the SURVIVING (filtered) replay produced
 * no entry for it — but absence from a filtered replay has causes other than
 * demotion, chiefly `incidentalObservations()`
 * (infra/lambda/src/lib/mastery/incidental-fold.ts), which writes a
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
import { CefrLevel } from '@language-drill/shared';
import type { Db } from '../src/client';
import { userExerciseHistory, userGrammarMastery } from '../src/schema';
import type { MasteryState } from '../src/mastery/update';
import {
  findStaleMasteryRows,
  planStaleMasteryDeletions,
  summarize,
  run,
  type StaleMasteryRow,
} from './backfill-mastery';

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
  // (infra/lambda/src/lib/mastery/incidental-fold.ts writes mastery for
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
      // names 'tr-a1-possessive' directly, so it never appears in either
      // replay map above.
      { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive' },
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

describe('run — the existing-mastery snapshot is taken before the history query (Important-2 TOCTOU fix)', () => {
  it('queries user_grammar_mastery before user_exercise_history', async () => {
    const fake = makeFakeDb({
      historyRows: [historyRow()],
      existingMasteryRows: [],
    });
    await run(fake.db, { apply: false, includeDemoted: false });
    expect(fake.fromCallOrder).toEqual(['mastery', 'history']);
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
      // anywhere names 'tr-a1-possessive' — it only exists in
      // user_grammar_mastery because incidentalObservations() wrote it
      // directly from an evaluator error on an unrelated submission.
      historyRows: [
        historyRow({ userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' }),
      ],
      existingMasteryRows: [
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-locative' },
        { userId: 'user-1', language: 'TR', grammarPointKey: 'tr-a1-possessive' },
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
