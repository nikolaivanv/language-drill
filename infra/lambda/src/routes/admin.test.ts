import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  ALL_CURRICULA,
  enumerateCurriculumCells,
} from '@language-drill/db';

// ---------------------------------------------------------------------------
// DB chain mock
// ---------------------------------------------------------------------------
//
// The admin route fires three Drizzle aggregating queries per endpoint inside
// a Promise.all. The chains we need to support are:
//   pool-status Q1: select().from().where().groupBy()
//   pool-status Q2: select().from().where().groupBy()
//   pool-status Q3: select().from().innerJoin().where().groupBy()
//   generation-stats Q1: select().from()
//   generation-stats Q2: select().from().where().groupBy()
//   generation-stats Q3: select().from().where().groupBy()
//
// Each call to `db.select()` returns a fresh chain object whose intermediate
// methods (from/where/innerJoin/groupBy) all return the same chain. The chain
// is also a thenable: awaiting it shifts the next pre-queued result off the
// shared `queryQueue`. Tests stage one entry per query, in Promise.all order.
// ---------------------------------------------------------------------------

const queryQueue: unknown[] = [];

function makeChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    set: vi.fn(() => chain),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const next = queryQueue.shift() ?? [];
      return Promise.resolve(next).then(resolve, reject);
    },
  };
  return chain;
}

// Capture the rows passed to `.values()` per insert, keyed by the table's
// `__mock` sentinel, so a test can assert what the route inserted regardless of
// other inserts (e.g. the auth middleware's user upsert) that share the mock.
const insertedValuesByTable: Record<string, unknown> = {};

const dbInsert = vi.fn((table: AnyJson) => {
  const chain = makeChain();
  const key = (table?.__mock as string) ?? 'unknown';
  chain.values = vi.fn((rows: unknown) => {
    insertedValuesByTable[key] = rows;
    return chain;
  });
  return chain;
});
const dbUpdate = vi.fn((_table: unknown) => makeChain());

vi.mock('../db', () => ({
  db: {
    select: () => makeChain(),
    insert: (table: unknown) => dbInsert(table as AnyJson),
    update: (table: unknown) => dbUpdate(table),
    execute: () =>
      Promise.resolve({ rows: queryQueue.shift() ?? [] }),
  },
}));

vi.mock('@language-drill/db', async () => {
  const actual =
    await vi.importActual<typeof import('@language-drill/db')>(
      '@language-drill/db',
    );
  return {
    ...actual,
    // Schema tables are passed straight to the mocked db.select chain — their
    // shape is irrelevant because the mock never inspects them. Keep them as
    // opaque sentinels so an accidental real-driver call would fail loudly.
    exercises: { __mock: 'exercises' },
    generationJobs: { __mock: 'generationJobs' },
    userExerciseHistory: { __mock: 'userExerciseHistory' },
    users: { __mock: 'users' },
    invitations: {
      __mock: 'invitations',
      id: { __col: 'id' },
      code: { __col: 'code' },
      usedBy: { __col: 'usedBy' },
      usedAt: { __col: 'usedAt' },
      expiresAt: { __col: 'expiresAt' },
      revokedAt: { __col: 'revokedAt' },
      note: { __col: 'note' },
      createdAt: { __col: 'createdAt' },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Auth + admin env fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin_user_001';
const NON_ADMIN_USER_ID = 'user_999';

const adminEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: ADMIN_USER_ID } } },
    },
  },
};

const nonAdminEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: NON_ADMIN_USER_ID } } },
    },
  },
};

const unauthEnv = {
  event: { requestContext: {} },
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let app: Hono;
const previousAdminUserIds = process.env.ADMIN_USER_IDS;

beforeEach(async () => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  for (const k of Object.keys(insertedValuesByTable)) {
    delete insertedValuesByTable[k];
  }
  process.env.ADMIN_USER_IDS = ADMIN_USER_ID;
  const mod = await import('./admin');
  app = new Hono();
  app.route('/', mod.default);
});

afterEach(() => {
  if (previousAdminUserIds === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = previousAdminUserIds;
  }
});

// ---------------------------------------------------------------------------
// GET /admin/pool-status
// ---------------------------------------------------------------------------

describe('GET /admin/pool-status', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/admin/pool-status', undefined, unauthEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });

  it('returns 403 for an authenticated non-admin', async () => {
    const res = await app.request(
      '/admin/pool-status',
      undefined,
      nonAdminEnv,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 200 with all-zero counts for every curriculum cell on an empty DB', async () => {
    queryQueue.push([], [], [], []); // coverage (db.execute shifts first), counts, lastRefilled, depletion — all empty

    const res = await app.request('/admin/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item.approved).toBe(0);
      expect(item.flagged).toBe(0);
      expect(item.rejected).toBe(0);
      expect(item.lastRefilledAt).toBeNull();
      expect(item.depletionRate7d).toBe(0);
      // Idle cells (0 depletion) floor at the demand tier of 50...
      expect(item.targetSize).toBe(50);
      // ...but the generation target is the per-cell R3 value (cloze/translation
      // /sentence_construction 20/30 at A1/A2 → 50 at B1/B2; vocab_recall capped
      // at 10 every level). Cells with a coverageSpec are raised to the largest
      // single-axis floor sum (Phase 2): TR A1 person = 6×5 = 30, TR A2 person =
      // 6×8 = 48, ES B1/B2 person = 5×15 = 75. Assert it resolved to a known target.
      expect([10, 20, 30, 48, 50, 75]).toContain(item.generationTarget);
      expect(['ES', 'DE', 'TR']).toContain(item.language);
      expect(['A1', 'A2', 'B1', 'B2']).toContain(item.level);
      expect(['cloze', 'translation', 'vocab_recall', 'sentence_construction']).toContain(item.type);
      expect(item.coverageDistribution).toBeNull();
    }
  });

  it('filters to only ES cells when ?language=ES', async () => {
    queryQueue.push([], [], [], []); // coverage (db.execute), counts, lastRefilled, depletion

    const res = await app.request(
      '/admin/pool-status?language=ES',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item.language).toBe('ES');
    }
  });

  it('returns 400 with VALIDATION_ERROR for an unrecognised language', async () => {
    const res = await app.request(
      '/admin/pool-status?language=INVALID',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('serialises lastRefilledAt as an ISO string when a cell has a successful job', async () => {
    // Regression: production crashed with `lastRefilledAt.toISOString is not
    // a function` once the first successful generation job populated
    // `finished_at`. The route now relies on Drizzle to decode the
    // MAX(timestamptz) aggregate to a Date (via `.mapWith(...)` on the
    // query); this test pushes a Date to confirm the consumption path
    // surfaces it as an ISO string in the response.
    const refilledAt = new Date('2026-05-12T04:01:17.491Z');
    // db.execute (coverage) shifts synchronously when Promise.all is built, so
    // coverage comes first in the queue; the three selects drain in array order.
    queryQueue.push(
      [],   // Q4 coverage (db.execute — shifts first, synchronously)
      [],   // Q1 counts
      [     // Q2 lastRefilled
        {
          cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
          lastRefilledAt: refilledAt,
        },
      ],
      [],   // Q3 depletion
    );

    const res = await app.request('/admin/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    const match = body.find(
      (item) =>
        item.language === 'ES' &&
        item.level === 'B1' &&
        item.type === 'cloze' &&
        item.grammarPointKey === 'es-b1-present-subjunctive',
    );
    expect(match).toBeDefined();
    expect(match?.lastRefilledAt).toBe(refilledAt.toISOString());

    // Cells without a matching successful job still serialise null.
    const unmatched = body.find(
      (item) =>
        item.language !== 'ES' ||
        item.level !== 'B1' ||
        item.type !== 'cloze' ||
        item.grammarPointKey !== 'es-b1-present-subjunctive',
    );
    expect(unmatched?.lastRefilledAt).toBeNull();
  });

  it('includes cells with zero approved exercises (the urgent-refill set)', async () => {
    // DB returns counts for ONE arbitrary cell only — every other cell must
    // still appear in the response with zeroed counts.
    // db.execute (coverage) shifts synchronously first; selects drain in array order.
    queryQueue.push(
      [],   // Q4 coverage (db.execute — shifts first, synchronously)
      [     // Q1 counts
        {
          language: 'ES',
          difficulty: 'A1',
          type: 'cloze',
          grammarPointKey: 'es-a1-ser-vs-estar',
          approved: 5,
          flagged: 0,
          rejected: 0,
        },
      ],
      [],   // Q2 lastRefilled
      [],   // Q3 depletion
    );

    const res = await app.request('/admin/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    const zeroApprovedItems = body.filter((item) => item.approved === 0);
    expect(zeroApprovedItems.length).toBeGreaterThan(0);
  });

  it('returns per-cell coverageDistribution for approved tagged rows', async () => {
    // Grammar point: tr-a1-personal-suffixes (TR A1, coverageSpec person axis,
    // kind: grammar, no clozeUnsuitable) → produces a cloze cell in the
    // curriculum cross-product.
    const GRAMMAR_KEY = 'tr-a1-personal-suffixes';

    // db.execute (coverage) shifts synchronously when Promise.all is built, before
    // any select chains' .then() fires — so coverage rows go first in the queue.
    // The mock rows simulate the SQL aggregate output (the SQL itself is not run
    // against Postgres in this mocked test).
    //
    // Two tagged approved exercises for the same cell produce 3 aggregate rows:
    //   exercise 1: person=3sg, polarity=affirmative
    //   exercise 2: person=3sg, polarity=negative
    // → {axis: "person",   value: "3sg",         n: 2}
    //   {axis: "polarity", value: "affirmative",  n: 1}
    //   {axis: "polarity", value: "negative",     n: 1}
    queryQueue.push(
      [   // Q4 coverage (db.execute — shifts first, synchronously)
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'person',   value: '3sg',         n: 2 },
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'polarity', value: 'affirmative',  n: 1 },
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'polarity', value: 'negative',     n: 1 },
      ],
      [], // Q1 counts
      [], // Q2 lastRefilled
      [], // Q3 depletion
    );

    const res = await app.request('/admin/pool-status?language=TR&level=A1', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    const item = body.find(
      (i: AnyJson) => i.grammarPointKey === GRAMMAR_KEY && i.type === 'cloze',
    );
    expect(item, `cloze cell for ${GRAMMAR_KEY} not found in response`).toBeDefined();
    expect(item!.coverageDistribution).toEqual({
      person:   { '3sg': 2 },
      polarity: { affirmative: 1, negative: 1 },
    });

    // Only the seeded cell should have non-null distribution.
    expect(
      body.filter((i: AnyJson) => i.coverageDistribution !== null),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/generation-stats
// ---------------------------------------------------------------------------

describe('GET /admin/generation-stats', () => {
  it('returns zeroed defaults for an empty DB', async () => {
    queryQueue.push(
      [{ weekCost: '0', monthCost: '0' }], // Q1 — single-row aggregate
      [], // Q2 — no jobs grouped by status
      [], // Q3 — no approval rows
    );

    const res = await app.request(
      '/admin/generation-stats',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.costThisWeekUsd).toBe(0);
    expect(body.costThisMonthUsd).toBe(0);
    expect(body.jobsThisWeek).toEqual({
      succeeded: 0,
      failed: 0,
      running: 0,
      queued: 0,
    });
    expect(body.approvalRates).toEqual([]);
  });

  it('parses cellKey into language/level/type and rounds approvalRate to 3 decimal places', async () => {
    queryQueue.push(
      [{ weekCost: '1.2345', monthCost: '5.6789' }],
      [
        { status: 'succeeded', cnt: 4 },
        { status: 'failed', cnt: 1 },
      ],
      [
        {
          // 7 approved + 2 flagged + 1 rejected (no dedup) → rate = 0.7 exactly
          cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
          approved: 7,
          flagged: 2,
          rejected: 1,
          dedupGivenUp: 0,
        },
      ],
    );

    const res = await app.request(
      '/admin/generation-stats',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.costThisWeekUsd).toBeCloseTo(1.2345);
    expect(body.costThisMonthUsd).toBeCloseTo(5.6789);
    expect(body.jobsThisWeek).toEqual({
      succeeded: 4,
      failed: 1,
      running: 0,
      queued: 0,
    });
    expect(body.approvalRates).toHaveLength(1);
    const row = body.approvalRates[0];
    expect(row.language).toBe('ES');
    expect(row.level).toBe('B1');
    expect(row.type).toBe('cloze');
    expect(row.approvedCount).toBe(7);
    expect(row.flaggedCount).toBe(2);
    expect(row.rejectedCount).toBe(1);
    expect(row.dedupGivenUpCount).toBe(0);
    expect(row.approvalRate).toBe(0.7);
    // Rate is rounded to 3 decimal places — the truncation happens in the
    // route, so the JSON value must not carry more precision.
    expect(Math.round(row.approvalRate * 1000)).toBe(700);
  });

  it('excludes dedup-given-up from the approval-rate denominator', async () => {
    queryQueue.push(
      [{ weekCost: '0', monthCost: '0' }],
      [],
      [
        {
          // 7 approved + 0 flagged + 13 rejected (10 of which were dedup).
          // Old formula: 7 / (7+0+13) = 0.35
          // New formula (dedup backed out): 7 / (7+0+3) = 0.7
          cellKey: 'tr:a2:vocab_recall:tr-a2-vocab-city-shopping',
          approved: 7,
          flagged: 0,
          rejected: 13,
          dedupGivenUp: 10,
        },
      ],
    );

    const res = await app.request(
      '/admin/generation-stats',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.approvalRates).toHaveLength(1);
    const row = body.approvalRates[0];
    expect(row.type).toBe('vocab_recall');
    expect(row.rejectedCount).toBe(13);
    expect(row.dedupGivenUpCount).toBe(10);
    expect(row.approvalRate).toBe(0.7);
  });

  it('clamps the dedup back-out at zero when dedupGivenUp > rejected (legacy rows)', async () => {
    // Pre-column rows could in theory present dedup > rejected if someone
    // backfilled. Defend against negative denominators rather than dividing
    // by a negative count.
    queryQueue.push(
      [{ weekCost: '0', monthCost: '0' }],
      [],
      [
        {
          cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
          approved: 5,
          flagged: 0,
          rejected: 2,
          dedupGivenUp: 7,
        },
      ],
    );

    const res = await app.request(
      '/admin/generation-stats',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.approvalRates).toHaveLength(1);
    const row = body.approvalRates[0];
    // Math.max(0, 2-7)=0; denominator = 5+0+0 = 5; rate = 5/5 = 1.0
    expect(row.approvalRate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/theory/coverage
// ---------------------------------------------------------------------------

/**
 * Recreate the route's curriculum-denominator computation so the test can
 * assert per-cell totals without hardcoding curriculum-specific counts. The
 * route iterates the same way: distinct grammar-point keys per (lang, level).
 */
function expectedCurriculumTotals(): Map<string, number> {
  const buckets = new Map<string, Set<string>>();
  for (const cell of enumerateCurriculumCells(ALL_CURRICULA)) {
    if (cell.grammarPoint.kind !== 'grammar') continue;
    const key = `${cell.language}:${cell.cefrLevel}`;
    let set = buckets.get(key);
    if (!set) {
      set = new Set<string>();
      buckets.set(key, set);
    }
    set.add(cell.grammarPoint.key);
  }
  const result = new Map<string, number>();
  for (const [key, set] of buckets) {
    result.set(key, set.size);
  }
  return result;
}

describe('GET /admin/theory/coverage', () => {
  it('returns 403 for a non-admin user (admin middleware inheritance)', async () => {
    const res = await app.request(
      '/admin/theory/coverage',
      undefined,
      nonAdminEnv,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 12 rows joining the DB aggregate against curriculum totals', async () => {
    // Seed: two approved ES B1 rows, one flagged ES B2 row.
    queryQueue.push([
      { language: 'ES', level: 'B1', approved: 2, flagged: 0 },
      { language: 'ES', level: 'B2', approved: 0, flagged: 1 },
    ]);

    const res = await app.request(
      '/admin/theory/coverage',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.rows).toHaveLength(12);

    const totals = expectedCurriculumTotals();
    const byKey = new Map<string, AnyJson>();
    for (const row of body.rows as AnyJson[]) {
      byKey.set(`${row.language}:${row.level}`, row);
    }

    // Sanity: every (language × level) combination is present.
    for (const language of ['ES', 'DE', 'TR'] as const) {
      for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
        const row = byKey.get(`${language}:${level}`);
        expect(row, `missing row ${language}/${level}`).toBeDefined();
        expect(row?.total).toBe(totals.get(`${language}:${level}`) ?? 0);
      }
    }

    const esB1 = byKey.get('ES:B1');
    expect(esB1?.approved).toBe(2);
    expect(esB1?.flagged).toBe(0);

    const esB2 = byKey.get('ES:B2');
    expect(esB2?.approved).toBe(0);
    expect(esB2?.flagged).toBe(1);

    // All other cells must have zero counts.
    for (const [key, row] of byKey) {
      if (key === 'ES:B1' || key === 'ES:B2') continue;
      expect(row.approved).toBe(0);
      expect(row.flagged).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Invite code admin endpoints
// ---------------------------------------------------------------------------

describe('POST /admin/invites', () => {
  it('generates `count` codes, each an 8-char A-Z0-9 string', async () => {
    // The route generates the codes; `.returning()` echoes rows back. The auth
    // middleware also inserts a `users` row, so we assert on the invitations
    // insert specifically via the per-table capture.
    queryQueue.push([
      { id: 'i1', code: 'AAAAAAAA', expiresAt: null, note: null },
      { id: 'i2', code: 'BBBBBBBB', expiresAt: null, note: null },
      { id: 'i3', code: 'CCCCCCCC', expiresAt: null, note: null },
    ]);

    const res = await app.request(
      '/admin/invites',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 3 }),
      },
      adminEnv,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.codes).toHaveLength(3);

    // The codes generated by the route (captured at `.values()`).
    const insertedRows = insertedValuesByTable.invitations as AnyJson[];
    expect(insertedRows).toHaveLength(3);
    for (const row of insertedRows) {
      expect(row.code).toHaveLength(8);
      expect(row.code).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  it('returns 400 for an invalid count', async () => {
    const res = await app.request(
      '/admin/invites',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 0 }),
      },
      adminEnv,
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-admin', async () => {
    const res = await app.request(
      '/admin/invites',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 3 }),
      },
      nonAdminEnv,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('FORBIDDEN');
  });
});

describe('GET /admin/invites', () => {
  it('derives status (unused / redeemed) per row', async () => {
    queryQueue.push([
      {
        id: 'i1',
        code: 'AAAAAAAA',
        usedBy: null,
        usedAt: null,
        expiresAt: null,
        revokedAt: null,
        note: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        id: 'i2',
        code: 'BBBBBBBB',
        usedBy: 'u2',
        usedAt: new Date('2026-05-02T00:00:00Z'),
        expiresAt: null,
        revokedAt: null,
        note: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]);

    const res = await app.request('/admin/invites', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.items).toHaveLength(2);
    const byId = new Map<string, AnyJson>(
      (body.items as AnyJson[]).map((r) => [r.id, r]),
    );
    expect(byId.get('i1')?.status).toBe('unused');
    expect(byId.get('i2')?.status).toBe('redeemed');
  });
});

describe('POST /admin/invites/:id/revoke', () => {
  it('revokes an unused code (200, db.update called)', async () => {
    queryQueue.push([{ id: 'i1', usedBy: null, revokedAt: null }]); // lookup

    const res = await app.request(
      '/admin/invites/i1/revoke',
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.ok).toBe(true);
    expect(dbUpdate).toHaveBeenCalled();
  });

  it('returns 409 for an already-used code', async () => {
    queryQueue.push([{ id: 'i2', usedBy: 'u2', revokedAt: null }]); // lookup

    const res = await app.request(
      '/admin/invites/i2/revoke',
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(409);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-revoked code (200, no update)', async () => {
    queryQueue.push([{ id: 'i3', usedBy: null, revokedAt: new Date() }]); // lookup

    const res = await app.request(
      '/admin/invites/i3/revoke',
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).ok).toBe(true);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the code does not exist', async () => {
    queryQueue.push([]); // lookup → no row

    const res = await app.request(
      '/admin/invites/nope/revoke',
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(404);
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
