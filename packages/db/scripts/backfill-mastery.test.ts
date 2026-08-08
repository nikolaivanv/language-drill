/**
 * Tests for `pnpm backfill:mastery`, focused on the stale-mastery-row
 * deletion added alongside the scoring-evidence filter (Task 5 fix round).
 *
 * When filtering removes *all* of a user's surviving evidence for a
 * `(user, language, grammarPointKey)` triple, `replayHistory` produces no
 * entry for that point, so the pre-existing `user_grammar_mastery` row —
 * written by the live submit path, which never checks `demotionReason` — is
 * left stale unless the backfill deletes it explicitly.
 *
 * Layered like `review-flagged.test.ts` / `backfill-demotion-reason.test.ts`:
 *   - Pure unit tests for `findStaleMasteryRows` / `planStaleMasteryDeletions`
 *     / `groupScopeCondition` / `summarize` — no DB.
 *   - Integration tests for `run()` against a fake `Db` (no real Postgres
 *     connection), mirroring `tryApprove`'s fake-`Db` pattern in
 *     `review-flagged.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CefrLevel } from '@language-drill/shared';
import type { Db } from '../src/client';
import { userExerciseHistory, userGrammarMastery } from '../src/schema';
import type { MasteryState } from '../src/mastery/update';
import {
  findStaleMasteryRows,
  planStaleMasteryDeletions,
  groupScopeCondition,
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
  it('flags an existing row whose group replayed with zero evidence for that point', () => {
    const finalStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])],
    ]);
    const existingRows: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' }, // still has evidence
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' }, // zero surviving evidence
    ];

    const stale = findStaleMasteryRows(finalStatesByGroup, existingRows);

    expect(stale).toEqual([
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
    ]);
  });

  it('returns an empty array when every existing row still has surviving evidence', () => {
    const finalStatesByGroup = new Map<string, Map<string, MasteryState>>([
      ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])],
    ]);
    const existingRows: StaleMasteryRow[] = [
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
    ];

    expect(findStaleMasteryRows(finalStatesByGroup, existingRows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// planStaleMasteryDeletions — the two required guards
// ---------------------------------------------------------------------------

describe('planStaleMasteryDeletions', () => {
  const finalStatesByGroup = new Map<string, Map<string, MasteryState>>([
    ['user-1 ES', new Map([['es-a1-ser-estar', STATE]])],
  ]);
  const existingRows: StaleMasteryRow[] = [
    { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-ser-estar' },
    { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' }, // would be stale
  ];

  it('deletes nothing when --include-demoted is set — the rollback path never deletes', () => {
    const plan = planStaleMasteryDeletions({
      includeDemoted: true,
      finalStatesByGroup,
      existingRows,
    });
    expect(plan).toEqual([]);
  });

  it('skips a run with zero surviving-history groups instead of treating it as "delete everything"', () => {
    // Simulates the evidence query coming back empty for an unrelated reason
    // (e.g. an overly narrow --user/--language filter, or a transient
    // upstream issue) — finalStatesByGroup is empty even though existingRows
    // (from an unscoped caller) is not.
    const plan = planStaleMasteryDeletions({
      includeDemoted: false,
      finalStatesByGroup: new Map(),
      existingRows,
    });
    expect(plan).toEqual([]);
  });

  it('deletes the zero-evidence row when a group has some surviving history and include-demoted is off', () => {
    const plan = planStaleMasteryDeletions({
      includeDemoted: false,
      finalStatesByGroup,
      existingRows,
    });
    expect(plan).toEqual([
      { userId: 'user-1', language: 'ES', grammarPointKey: 'es-a1-preterite' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// groupScopeCondition
// ---------------------------------------------------------------------------

describe('groupScopeCondition', () => {
  it('returns undefined for an empty group set — so callers can skip the query entirely', () => {
    expect(groupScopeCondition([])).toBeUndefined();
  });

  it('renders a condition that references both the user and language columns', () => {
    const cond = groupScopeCondition(['user-1 ES', 'user-2 DE']);
    expect(cond).toBeDefined();
    const { sql, params } = new PgDialect().sqlToQuery(cond!);
    expect(sql.toLowerCase()).toContain('user_id');
    expect(sql.toLowerCase()).toContain('language');
    expect(params).toEqual(['user-1', 'ES', 'user-2', 'DE']);
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
};

function makeFakeDb(params: {
  historyRows: unknown[];
  existingMasteryRows: unknown[];
}): FakeRunResult {
  const inserts: unknown[] = [];
  let deleteCalls = 0;
  let masteryQueried = false;

  const db = {
    select: (_proj: unknown) => ({
      from: (table: unknown) => {
        if (table === userExerciseHistory) {
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: (_o: unknown) => Promise.resolve(params.historyRows),
              }),
            }),
          };
        }
        if (table === userGrammarMastery) {
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
    ...overrides,
  };
}

describe('run — zero-evidence stale-row deletion, end to end against a fake Db', () => {
  it('deletes the stale row and reports upserts/deletes separately when --apply is set', async () => {
    // user-1/ES has surviving evidence for es-a1-ser-estar only. The
    // pre-existing mastery table (per the fake) also has a row for
    // es-a1-preterite, which no longer has any surviving evidence — it must
    // be deleted, not silently left stale.
    const fake = makeFakeDb({
      historyRows: [historyRow()],
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

  it('computes but does not write in dry-run mode (apply: false)', async () => {
    const fake = makeFakeDb({
      historyRows: [historyRow()],
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
      historyRows: [historyRow()],
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
    // Upserts still happen — include-demoted only changes which evidence
    // feeds the replay and disables deletion, it doesn't skip writing.
    expect(result.upserts).toBe(1);
  });

  it('skips the mastery lookup entirely — and deletes nothing — when history comes back empty', async () => {
    // Guards against mass deletion when the evidence query returns empty for
    // an unrelated reason (e.g. a too-narrow --user/--language filter): with
    // zero surviving history overall, the existing-mastery-row query must
    // never even run, let alone delete anything.
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
    expect(fake.masteryQueried).toBe(false);
  });
});
