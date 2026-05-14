import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

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

vi.mock('../db', () => ({
  db: {
    select: () => makeChain(),
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
    queryQueue.push([], [], []); // counts, lastRefilled, depletion all empty

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
      expect(item.targetSize).toBe(50);
      expect(['ES', 'DE', 'TR']).toContain(item.language);
      expect(['A1', 'A2', 'B1', 'B2']).toContain(item.level);
      expect(['cloze', 'translation', 'vocab_recall']).toContain(item.type);
    }
  });

  it('filters to only ES cells when ?language=ES', async () => {
    queryQueue.push([], [], []);

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
    queryQueue.push(
      [],
      [
        {
          cellKey: 'es:b1:cloze:es-b1-present-subjunctive',
          lastRefilledAt: refilledAt,
        },
      ],
      [],
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
    queryQueue.push(
      [
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
      [],
      [],
    );

    const res = await app.request('/admin/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    const zeroApprovedItems = body.filter((item) => item.approved === 0);
    expect(zeroApprovedItems.length).toBeGreaterThan(0);
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
          cellKey: 'tr:a2:vocab_recall:tr-a2-everyday-vocab',
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
