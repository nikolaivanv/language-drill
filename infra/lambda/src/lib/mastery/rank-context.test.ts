import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @language-drill/db so the test can run without the compiled db package.
// getGrammarPoint returns undefined for unknown keys (mirrors prod for unmapped
// points) and returns a stub with prerequisiteKeys for a known key.
// ---------------------------------------------------------------------------
vi.mock('@language-drill/db', () => ({
  userGrammarMastery: {
    userId: 'user_id',
    language: 'language',
    grammarPointKey: 'grammar_point_key',
    masteryScore: 'mastery_score',
    lastPracticedAt: 'last_practiced_at',
  },
  errorObservations: {
    userId: 'user_id',
    language: 'language',
    errorGrammarPointKey: 'error_grammar_point_key',
    hostGrammarPointKey: 'host_grammar_point_key',
    occurredAt: 'occurred_at',
  },
  getGrammarPoint: (key: string) => {
    if (key === 'es-b1-subjunctive') {
      return { prerequisiteKeys: ['es-a2-present-indicative'] };
    }
    return undefined;
  },
}));

// drizzle-orm helpers are used as tag/sentinel values in the queries — mock
// them as identity functions so the query builder calls succeed without a
// real DB connection.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  gte: (col: unknown, val: unknown) => ({ __gte: [col, val] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sql: { strings, values } }),
    { join: () => ({ __sqlJoin: true }) },
  ),
}));

import { buildRankContext } from './rank-context';

// ---------------------------------------------------------------------------
// Minimal mock db factory
// ---------------------------------------------------------------------------
function makeMockDb(
  masteryRows: Array<{ grammarPointKey: string; masteryScore: number; lastPracticedAt: string }>,
  errorRows: Array<{ key: string | null; n: number }>,
) {
  // The builder chains: db.select().from().where() → masteryRows (Promise)
  // and db.select().from().where().groupBy() → errorRows (Promise).
  // We intercept by tracking call order: first select call → mastery chain,
  // second select call → error chain.
  let callCount = 0;

  const mockGroupBy = vi.fn(() => Promise.resolve(errorRows));
  const mockWhere = vi.fn(() => ({
    groupBy: mockGroupBy,
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      // first select().from().where() that is awaited directly = mastery query
      return Promise.resolve(masteryRows).then(resolve, reject);
    },
  }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => {
    callCount++;
    return { from: mockFrom };
  });

  return { db: { select: mockSelect }, mockSelect, mockWhere, mockGroupBy, callCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRankContext', () => {
  it('builds masteryByPoint from mastery rows', async () => {
    const lastPracticedAt = new Date('2026-05-01T00:00:00Z').toISOString();
    const { db } = makeMockDb(
      [{ grammarPointKey: 'es-b1-present', masteryScore: 0.75, lastPracticedAt }],
      [],
    );

    const now = new Date('2026-06-01T00:00:00Z');
    const ctx = await buildRankContext(db, 'user_1', 'ES', now);

    expect(ctx.masteryByPoint.size).toBe(1);
    const m = ctx.masteryByPoint.get('es-b1-present');
    expect(m).toBeDefined();
    expect(m?.masteryScore).toBe(0.75);
    expect(m?.lastPracticedAt).toEqual(new Date(lastPracticedAt));
  });

  it('builds errorCountByPoint from error rows, skipping null keys', async () => {
    const { db } = makeMockDb(
      [],
      [
        { key: 'es-b1-subjunctive', n: 3 },
        { key: null, n: 5 }, // null key should be skipped
        { key: 'es-a2-past', n: 1 },
      ],
    );

    const now = new Date('2026-06-01T00:00:00Z');
    const ctx = await buildRankContext(db, 'user_1', 'ES', now);

    expect(ctx.errorCountByPoint.size).toBe(2);
    expect(ctx.errorCountByPoint.get('es-b1-subjunctive')).toBe(3);
    expect(ctx.errorCountByPoint.get('es-a2-past')).toBe(1);
    expect(ctx.errorCountByPoint.has('null')).toBe(false);
  });

  it('returns prereqsOf that resolves known grammar point prerequisiteKeys', async () => {
    const { db } = makeMockDb([], []);
    const ctx = await buildRankContext(db, 'user_1', 'ES', new Date());

    // Known key with a stub entry
    expect(ctx.prereqsOf('es-b1-subjunctive')).toEqual(['es-a2-present-indicative']);
    // Unknown key → empty array (no crash, no penalty)
    expect(ctx.prereqsOf('nonexistent-key')).toEqual([]);
  });

  it('sets now on the returned context', async () => {
    const { db } = makeMockDb([], []);
    const now = new Date('2026-06-15T12:00:00Z');
    const ctx = await buildRankContext(db, 'user_1', 'ES', now);

    expect(ctx.now).toEqual(now);
  });

  it('runs the mastery and error queries in parallel (both selects called before either resolves)', async () => {
    // Track which selects were called
    const selectCalls: string[] = [];
    let masteryResolve!: (v: unknown) => void;
    let errorResolve!: (v: unknown) => void;

    const masteryPromise = new Promise((res) => { masteryResolve = res; });
    const errorPromise = new Promise((res) => { errorResolve = res; });
    let errorGroupByResolve!: (v: unknown) => void;
    const errorGroupByPromise = new Promise((res) => { errorGroupByResolve = res; });

    let selectCallCount = 0;
    const db = {
      select: () => {
        selectCallCount++;
        const callNum = selectCallCount;
        return {
          from: () => ({
            where: () => ({
              groupBy: () => {
                selectCalls.push(`error-${callNum}`);
                errorGroupByResolve([]);
                return errorGroupByPromise;
              },
              then(resolve: (v: unknown) => void, _reject: (e: unknown) => void) {
                selectCalls.push(`mastery-${callNum}`);
                masteryResolve([]);
                return masteryPromise.then(resolve, _reject);
              },
            }),
          }),
        };
      },
    };

    await buildRankContext(db, 'user_1', 'ES', new Date());

    // Both selects were called (parallel Promise.all)
    expect(selectCallCount).toBe(2);
  });

  it('coerces error row n values via Number() so string bigints from pg are handled', async () => {
    // Postgres COUNT() may return string bigints via the driver; simulate that.
    const { db } = makeMockDb(
      [],
      [{ key: 'es-a1-copula', n: '7' as unknown as number }],
    );

    const ctx = await buildRankContext(db, 'user_1', 'ES', new Date());
    expect(ctx.errorCountByPoint.get('es-a1-copula')).toBe(7);
  });
});
