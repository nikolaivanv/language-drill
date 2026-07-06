import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  ALL_CURRICULA,
  CURRICULUM_VERSION_ES,
  enumerateCurriculumCells,
} from '@language-drill/db';

const sqsSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SQSClient: vi.fn(function (this: any) { this.send = sqsSend; }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SendMessageCommand: vi.fn(function (this: any, input: unknown) { this.input = input; }),
}));

// `validateDraft` is the only AI call the revalidate endpoint makes — stub it
// per-test via `mockValidateDraft`. The pure cost helpers (estimateCostUsd,
// addUsage, ZERO_USAGE) stay REAL so the endpoint's cost accounting is exercised.
const mockValidateDraft = vi.fn();
vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>('@language-drill/ai');
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({})),
    validateDraft: (...args: unknown[]) => mockValidateDraft(...args),
  };
});

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
    leftJoin: vi.fn(() => chain),
    as: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    having: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    set: vi.fn(() => chain),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const next = queryQueue.shift() ?? [];
      if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
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
    theoryTopics: { __mock: 'theoryTopics' },
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
    adminAuditLog: { __mock: 'adminAuditLog' },
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
  sqsSend.mockClear();
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
    // Both db.execute-based queries (recentJobs loader, then coverage) shift
    // synchronously at Promise.all build; the two selects (counts, depletion)
    // drain lazily in array order. All empty here, so order is moot.
    queryQueue.push([], [], [], []); // recentJobs, coverage, counts, depletion — all empty

    const res = await app.request('/admin/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson[];
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item.approved).toBe(0);
      expect(item.flagged).toBe(0);
      expect(item.rejected).toBe(0);
      expect(item.lastRefilledAt).toBeNull();
      // No succeeded job → no last-run evidence; scheduler would enqueue.
      expect(item.lastJob).toBeNull();
      expect(item.status).toBe('never-run');
      expect(item.depletionRate7d).toBe(0);
      // Idle cells (0 depletion) floor at the demand tier of 50...
      expect(item.targetSize).toBe(50);
      // ...but the generation target is the per-cell R3 value (cloze/translation
      // /sentence_construction 20/30 at A1/A2 → 50 at B1/B2; vocab_recall capped
      // at 10 every level; dictation A1=6, A2=10, B1/B2 = 15; free_writing
      // all levels = 5 (2026-06-17)). Cells with a coverageSpec are raised to the
      // largest single-axis floor sum (Phase 2): ES A1/A2 person = 5×5 = 25, TR A1
      // person = 6×5 = 30, TR A2 person = 6×8 = 48, ES B1/B2 person = 5×15 = 75.
      // Assert it resolved to a known target.
      expect([5, 6, 10, 15, 20, 25, 30, 48, 50, 75]).toContain(item.generationTarget);
      expect(['ES', 'DE', 'TR']).toContain(item.language);
      expect(['A1', 'A2', 'B1', 'B2']).toContain(item.level);
      expect(['cloze', 'translation', 'vocab_recall', 'sentence_construction', 'dictation', 'free_writing', 'conjugation']).toContain(item.type);
      expect(item.coverageDistribution).toBeNull();
    }
  });

  it('filters to only ES cells when ?language=ES', async () => {
    queryQueue.push([], [], [], []); // recentJobs, coverage, counts, depletion

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

  it('derives lastRefilledAt, lastJob, and status from the most recent succeeded job', async () => {
    // `lastRefilledAt` now comes from the shared recent-job loader's
    // `finished_at` (a Date) rather than a MAX() aggregate; the loader also
    // feeds `decideEnqueue` so each cell carries its scheduler status + the
    // last run's metrics. Regression guard: production once crashed with
    // `lastRefilledAt.toISOString is not a function` — pushing a Date confirms
    // the consumption path surfaces it as an ISO string.
    const refilledAt = new Date('2026-05-12T04:01:17.491Z');
    // Both db.execute queries shift synchronously at Promise.all build, in
    // array order: recentJobs (loader) first, coverage second. The two selects
    // (counts, depletion) drain lazily after, in array order.
    queryQueue.push(
      [     // recentJobs (db.execute via loader — shifts first, synchronously)
        {
          cell_key: 'es:b1:cloze:es-b1-present-subjunctive',
          approved_count: 40,
          requested_count: 20,
          dedup_given_up_count: 1,
          curriculum_version: CURRICULUM_VERSION_ES,
          coverage_outcome: null,
          finished_at: refilledAt,
        },
      ],
      [],   // coverage (db.execute — shifts second, synchronously)
      [],   // counts (select — pool approved stays 0 for this cell)
      [],   // depletion (select)
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
    expect(match?.lastJob).toEqual({
      approvedCount: 40,
      requestedCount: 20,
      dedupGivenUpCount: 1,
      curriculumVersion: CURRICULUM_VERSION_ES,
    });
    // Pool approved=0 < target, recent job productive (40 ≥ 3) + low dedup, and
    // curriculum version matches → scheduler would enqueue → 'active'.
    expect(match?.status).toBe('active');

    // Cells without a matching successful job: null evidence, never-run.
    const unmatched = body.find(
      (item) =>
        item.language !== 'ES' ||
        item.level !== 'B1' ||
        item.type !== 'cloze' ||
        item.grammarPointKey !== 'es-b1-present-subjunctive',
    );
    expect(unmatched?.lastRefilledAt).toBeNull();
    expect(unmatched?.lastJob).toBeNull();
    expect(unmatched?.status).toBe('never-run');
  });

  it('includes cells with zero approved exercises (the urgent-refill set)', async () => {
    // DB returns counts for ONE arbitrary cell only — every other cell must
    // still appear in the response with zeroed counts.
    // The two db.execute queries (recentJobs, coverage) shift synchronously
    // first in array order; the selects drain lazily after.
    queryQueue.push(
      [],   // recentJobs (db.execute via loader)
      [],   // coverage (db.execute)
      [     // counts (select)
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
      [],   // depletion (select)
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

    // The two db.execute queries shift synchronously at Promise.all build, in
    // array order: recentJobs (loader) first, coverage second — so the coverage
    // rows are the SECOND queue entry. The mock rows simulate the SQL aggregate
    // output (the SQL itself is not run against Postgres in this mocked test).
    //
    // Two tagged approved exercises for the same cell produce 3 aggregate rows:
    //   exercise 1: person=3sg, polarity=affirmative
    //   exercise 2: person=3sg, polarity=negative
    // → {axis: "person",   value: "3sg",         n: 2}
    //   {axis: "polarity", value: "affirmative",  n: 1}
    //   {axis: "polarity", value: "negative",     n: 1}
    queryQueue.push(
      [], // recentJobs (db.execute via loader — shifts first, synchronously)
      [   // coverage (db.execute — shifts second, synchronously)
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'person',   value: '3sg',         n: 2 },
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'polarity', value: 'affirmative',  n: 1 },
        { language: 'TR', difficulty: 'A1', type: 'cloze', grammarPointKey: GRAMMAR_KEY, axis: 'polarity', value: 'negative',     n: 1 },
      ],
      [], // counts (select)
      [], // depletion (select)
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

// ---------------------------------------------------------------------------
// GET /admin/flagged/exercises
// ---------------------------------------------------------------------------

describe('GET /admin/flagged/exercises', () => {
  it('returns flagged exercises with total, strips _dedupKey, normalises flaggedReasons', async () => {
    queryQueue.push([
      {
        id: 'ex-1',
        language: 'ES',
        difficulty: 'A2',
        type: 'cloze',
        grammarPointKey: 'obj-pronoun',
        contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se', _dedupKey: 'k1' },
        qualityScore: 0.62,
        flaggedReasons: [{ code: 'ambiguous' }],
        generatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 5 }]);

    const res = await app.request('/admin/flagged/exercises?language=ES', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].level).toBe('A2');
    expect(body.items[0].contentJson._dedupKey).toBeUndefined();
    expect(body.items[0].flaggedReasons).toEqual([{ code: 'ambiguous' }]);
    expect(body.items[0].generatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns 400 with VALIDATION_ERROR for an unrecognised language', async () => {
    const res = await app.request('/admin/flagged/exercises?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/flagged/theory
// ---------------------------------------------------------------------------

describe('GET /admin/flagged/theory', () => {
  it('returns flagged theory items with total, level, and topicId', async () => {
    queryQueue.push([
      {
        id: 'th-1',
        language: 'DE',
        cefrLevel: 'B1',
        grammarPointKey: 'dative',
        topicId: 'de-b1-dative',
        contentJson: { id: 't', title: 'Dative', subtitle: 's', cefr: 'B1', sections: [] },
        qualityScore: 0.55,
        flaggedReasons: [{ code: 'level-mismatch' }],
        generatedAt: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 1 }]);

    const res = await app.request('/admin/flagged/theory', undefined, adminEnv);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].level).toBe('B1');
    expect(body.items[0].topicId).toBe('de-b1-dative');
  });

  it('returns 400 with VALIDATION_ERROR for an unrecognised language', async () => {
    const res = await app.request('/admin/flagged/theory?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/invites/:id/revoke
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST /admin/flagged/exercises/:id/approve
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

describe('POST /admin/flagged/exercises/:id/approve', () => {
  it('returns { outcome: "approved" } when the UPDATE returns a row', async () => {
    queryQueue.push([{ id: VALID_UUID }]); // UPDATE...returning → 1 row

    const res = await app.request(
      `/admin/flagged/exercises/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('approved');
  });

  it('demotes on unique violation (23505) and returns { outcome: "demoted" }', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(err);  // UPDATE throws unique-violation
    queryQueue.push([]);   // fallback demote UPDATE has no .returning(); value is just drained

    const res = await app.request(
      `/admin/flagged/exercises/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('demoted');
  });

  it('returns { outcome: "already_resolved" } when UPDATE returns 0 rows and row exists', async () => {
    queryQueue.push([]);                              // UPDATE → 0 rows
    queryQueue.push([{ reviewStatus: 'manual-approved' }]); // re-read → exists

    const res = await app.request(
      `/admin/flagged/exercises/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('already_resolved');
  });

  it('returns { outcome: "not_found" } when UPDATE returns 0 rows and no row exists', async () => {
    queryQueue.push([]); // UPDATE → 0 rows
    queryQueue.push([]); // re-read → no row

    const res = await app.request(
      `/admin/flagged/exercises/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('not_found');
  });

  it('returns 400 for a non-uuid id', async () => {
    const res = await app.request(
      '/admin/flagged/exercises/not-a-uuid/approve',
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/flagged/exercises/:id/reject
// ---------------------------------------------------------------------------

describe('POST /admin/flagged/exercises/:id/reject', () => {
  it('returns { outcome: "rejected" } when the UPDATE returns a row', async () => {
    queryQueue.push([{ id: VALID_UUID }]); // UPDATE...returning → 1 row

    const res = await app.request(
      `/admin/flagged/exercises/${VALID_UUID}/reject`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/flagged/theory/:id/approve
// ---------------------------------------------------------------------------

describe('POST /admin/flagged/theory/:id/approve', () => {
  it('returns { outcome: "approved" } when the UPDATE returns a row', async () => {
    queryQueue.push([{ id: VALID_UUID }]); // UPDATE...returning → 1 row

    const res = await app.request(
      `/admin/flagged/theory/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('approved');
  });

  it('demotes on unique violation (23505) and returns { outcome: "demoted" }', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(err);  // UPDATE throws unique-violation
    queryQueue.push([]);   // fallback demote UPDATE has no .returning(); value is just drained

    const res = await app.request(
      `/admin/flagged/theory/${VALID_UUID}/approve`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('demoted');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/flagged/theory/:id/reject
// ---------------------------------------------------------------------------

describe('POST /admin/flagged/theory/:id/reject', () => {
  it('returns { outcome: "rejected" } when the UPDATE returns a row', async () => {
    queryQueue.push([{ id: VALID_UUID }]); // UPDATE...returning → 1 row

    const res = await app.request(
      `/admin/flagged/theory/${VALID_UUID}/reject`,
      { method: 'POST' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.outcome).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/content/exercises
// ---------------------------------------------------------------------------

describe('GET /admin/content/exercises', () => {
  it('returns approved items (metadata + _dedupKey stripped) + total', async () => {
    queryQueue.push([
      {
        id: 'ex-1', language: 'ES', difficulty: 'A2', type: 'cloze', grammarPointKey: 'obj-pronoun',
        contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se', _dedupKey: 'k1' },
        coverageTags: { person: '3sg' }, qualityScore: 0.91, generationSource: 'claude-batch',
        modelId: 'claude-sonnet-4-6', reviewStatus: 'auto-approved', generatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]); // items
    queryQueue.push([{ count: 42 }]); // total
    const res = await app.request('/admin/content/exercises?language=ES&q=lo&limit=10&offset=0', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(42);
    expect(body.items[0].level).toBe('A2');
    expect(body.items[0].contentJson._dedupKey).toBeUndefined();
    expect(body.items[0].generationSource).toBe('claude-batch');
    expect(body.items[0].reviewStatus).toBe('auto-approved');
    expect(body.items[0].coverageTags).toEqual({ person: '3sg' });
    expect(body.items[0].generatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rejects an invalid language with 400', async () => {
    const res = await app.request('/admin/content/exercises?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/content/theory
// ---------------------------------------------------------------------------

describe('GET /admin/content/theory', () => {
  it('returns approved theory items + total (no type/coverageTags)', async () => {
    queryQueue.push([
      {
        id: 'th-1', language: 'DE', cefrLevel: 'B1', grammarPointKey: 'dative', topicId: 'de-b1-dative',
        contentJson: { id: 't', title: 'Dative', subtitle: 's', cefr: 'B1', sections: [] },
        qualityScore: 0.8, generationSource: 'claude-batch', modelId: 'claude-sonnet-4-6',
        reviewStatus: 'manual-approved', generatedAt: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 3 }]);
    const res = await app.request('/admin/content/theory', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(3);
    expect(body.items[0].level).toBe('B1');
    expect(body.items[0].topicId).toBe('de-b1-dative');
    expect(body.items[0].reviewStatus).toBe('manual-approved');
  });

  it('accepts q + pagination params and returns correct total and item level', async () => {
    queryQueue.push([
      {
        id: 'th-2', language: 'DE', cefrLevel: 'B1', grammarPointKey: 'dative', topicId: 'de-b1-dative',
        contentJson: { id: 't', title: 'Der Dativ', subtitle: 's', cefr: 'B1', sections: [] },
        qualityScore: 0.75, generationSource: 'claude-batch', modelId: 'claude-sonnet-4-6',
        reviewStatus: 'auto-approved', generatedAt: new Date('2026-06-03T00:00:00Z'),
      },
    ]); // items
    queryQueue.push([{ count: 7 }]); // total
    const res = await app.request(
      '/admin/content/theory?language=DE&q=dativ&limit=10&offset=10',
      undefined,
      adminEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(7);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].level).toBe('B1');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/content/exercises/:id/demote
// ---------------------------------------------------------------------------

describe('POST /admin/content/exercises/:id/demote', () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  it('demotes an approved row (outcome=demoted)', async () => {
    queryQueue.push([{ id }]);
    const res = await app.request(`/admin/content/exercises/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'demoted' });
  });
  it('already_resolved when 0 rows match but the row exists', async () => {
    queryQueue.push([]); queryQueue.push([{ reviewStatus: 'flagged' }]);
    const res = await app.request(`/admin/content/exercises/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(await res.json()).toEqual({ outcome: 'already_resolved' });
  });
  it('not_found when the row does not exist', async () => {
    queryQueue.push([]); queryQueue.push([]);
    const res = await app.request(`/admin/content/exercises/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(await res.json()).toEqual({ outcome: 'not_found' });
  });
  it('rejects a non-uuid id with 400', async () => {
    const res = await app.request('/admin/content/exercises/not-a-uuid/demote', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/content/exercises/:id/reject
// ---------------------------------------------------------------------------

describe('POST /admin/content/exercises/:id/reject', () => {
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  it('rejects an approved row (outcome=rejected)', async () => {
    queryQueue.push([{ id }]);
    const res = await app.request(`/admin/content/exercises/${id}/reject`, { method: 'POST' }, adminEnv);
    expect(await res.json()).toEqual({ outcome: 'rejected' });
  });
});

// ---------------------------------------------------------------------------
// POST /admin/content/theory/:id/demote + reject
// ---------------------------------------------------------------------------

describe('POST /admin/content/theory/:id/demote', () => {
  const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  it('demotes an approved theory row', async () => {
    queryQueue.push([{ id }]);
    const res = await app.request(`/admin/content/theory/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(await res.json()).toEqual({ outcome: 'demoted' });
  });
  it('rejects an approved theory row', async () => {
    queryQueue.push([{ id }]);
    const res = await app.request(`/admin/content/theory/${id}/reject`, { method: 'POST' }, adminEnv);
    expect(await res.json()).toEqual({ outcome: 'rejected' });
  });
});

// ---------------------------------------------------------------------------
// GET /admin/pool-cell
// ---------------------------------------------------------------------------

describe('GET /admin/pool-cell', () => {
  it('returns curriculum floors for a cell that has a coverageSpec', async () => {
    queryQueue.push([]);
    const res = await app.request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.floors).toEqual({ person: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } });
    expect(body.rejectionReasonCounts).toEqual({});
  });

  it('returns empty floors for an unknown grammar point', async () => {
    queryQueue.push([]);
    const res = await app.request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=does-not-exist', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect((await res.json() as AnyJson).floors).toEqual({});
  });

  it('sums rejectionReasonCounts across the cell\'s jobs', async () => {
    queryQueue.push([
      { rejectionReasonCounts: { 'low-quality-reject': 3 } },
      { rejectionReasonCounts: { 'low-quality-reject': 2, ambiguous: 1 } },
      { rejectionReasonCounts: null },
    ]);
    const res = await app.request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive', undefined, adminEnv);
    expect((await res.json() as AnyJson).rejectionReasonCounts).toEqual({ 'low-quality-reject': 5, ambiguous: 1 });
  });

  it('rejects a request missing grammarPoint with 400', async () => {
    const res = await app.request('/admin/pool-cell?language=ES&level=B1&type=cloze', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect((await res.json() as AnyJson).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/generate
// ---------------------------------------------------------------------------

describe('POST /admin/generate', () => {
  let prevRegion: string | undefined;
  let prevQueueUrl: string | undefined;
  beforeAll(() => {
    prevRegion = process.env.AWS_REGION;
    prevQueueUrl = process.env.GENERATION_QUEUE_URL;
    process.env.AWS_REGION = 'us-east-1';
    process.env.GENERATION_QUEUE_URL = 'https://sqs.test/queue';
  });
  afterAll(() => {
    if (prevRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = prevRegion;
    if (prevQueueUrl === undefined) delete process.env.GENERATION_QUEUE_URL; else process.env.GENERATION_QUEUE_URL = prevQueueUrl;
  });

  it('enqueues an admin generation job for a valid cell', async () => {
    queryQueue.push([]); // in-flight check: no queued/running job
    const res = await app.request('/admin/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 18 }),
    }, adminEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.status).toBe('queued');
    expect(typeof body.jobId).toBe('string');
    expect(sqsSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sqsSend.mock.calls[0][0].input.MessageBody);
    expect(sent.trigger).toBe('admin');
    expect(sent.spec.count).toBe(18);
    expect(sent.spec.exerciseType).toBe('cloze');
    expect(sent.spec.grammarPointKey).toBe('es-b1-present-subjunctive');
    expect(sent.spec.batchSeed).toMatch(/^admin-/);
    expect(sent.maxCostUsd).toBe(2.0);
    expect(sent.jobId).toBe(body.jobId);
  });

  it('rejects count over 50 with 400', async () => {
    const res = await app.request('/admin/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 51 }),
    }, adminEnv);
    expect(res.status).toBe(400);
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('rejects an unknown cell with 400 INVALID_CELL', async () => {
    const res = await app.request('/admin/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'does-not-exist', count: 5 }),
    }, adminEnv);
    expect(res.status).toBe(400);
    expect((await res.json() as AnyJson).code).toBe('INVALID_CELL');
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('returns 409 when a job for the cell is already queued/running', async () => {
    queryQueue.push([{ id: 'existing-job' }]);
    const res = await app.request('/admin/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    }, adminEnv);
    expect(res.status).toBe(409);
    expect((await res.json() as AnyJson).code).toBe('GENERATION_IN_PROGRESS');
    expect(sqsSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /admin/revalidate
// ---------------------------------------------------------------------------

describe('POST /admin/revalidate', () => {
  let prevApiKey: string | undefined;
  beforeAll(() => {
    prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterAll(() => {
    if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevApiKey;
  });

  // Real cloze cell resolvable in ALL_CURRICULA (TR A1, no clozeUnsuitable).
  const CELL = {
    language: 'TR' as const,
    level: 'A1' as const,
    type: 'cloze' as const,
    grammarPoint: 'tr-a1-vowel-harmony',
  };

  // Valid cloze content for a candidate row. The blank stands alone (no
  // suffixal stem), so the deterministic Turkish checker returns
  // `not-applicable` and routing is driven purely by the LLM verdict below.
  function clozeContent() {
    return {
      type: 'cloze',
      instructions: 'Boşluğu doldurun.',
      sentence: 'Sınıfta sekiz ___ var.',
      correctAnswer: 'öğrenci',
    };
  }

  function candidateRow(id: string, reviewStatus: string) {
    return {
      id,
      type: 'cloze',
      language: 'TR',
      difficulty: 'A1',
      contentJson: clozeContent(),
      grammarPointKey: 'tr-a1-vowel-harmony',
      topicDomain: null,
      modelId: 'claude-sonnet-4-6',
      reviewStatus,
    };
  }

  // ValidationResult fixtures (read routeValidationResult thresholds):
  //   auto-approved: high score, all booleans clean.
  //   flagged: clean score band but ambiguous=true → routes to 'flagged'.
  const AUTO_APPROVED_RESULT = {
    qualityScore: 0.95,
    ambiguous: false,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
    coverage: {},
  };
  const FLAGGED_RESULT = {
    qualityScore: 0.95,
    ambiguous: true,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
    coverage: {},
  };

  const ZERO_TOKENS = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  function body(apply: boolean, overrides: Record<string, unknown> = {}) {
    return JSON.stringify({ ...CELL, apply, ...overrides });
  }

  function post(payload: string) {
    return app.request(
      '/admin/revalidate',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload },
      adminEnv,
    );
  }

  it('returns 400 VALIDATION_ERROR on an invalid body', async () => {
    const res = await post(JSON.stringify({ language: 'TR' })); // missing fields
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 INVALID_CELL for an unknown cell', async () => {
    const res = await post(body(false, { grammarPoint: 'tr-a1-nonexistent' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('INVALID_CELL');
  });

  it('dry-run: demotes an auto-approved row to flagged without writing or auditing', async () => {
    delete insertedValuesByTable.adminAuditLog;
    mockValidateDraft.mockResolvedValue({ result: FLAGGED_RESULT, tokenUsage: ZERO_TOKENS });
    // (1) count, (2) candidate rows — no update/insert in dry-run.
    queryQueue.push([{ count: 1 }]);
    queryQueue.push([candidateRow('row-1', 'auto-approved')]);

    const res = await post(body(false));
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.apply).toBe(false);
    expect(json.scanned).toBe(1);
    expect(json.demotedToFlagged).toBe(1);
    expect(json.demotions[0]).toMatchObject({ from: 'auto-approved', to: 'flagged' });
    // No write, no audit.
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });

  it('apply: writes one update and records a revalidate.apply audit row', async () => {
    delete insertedValuesByTable.adminAuditLog;
    mockValidateDraft.mockResolvedValue({ result: FLAGGED_RESULT, tokenUsage: ZERO_TOKENS });
    // (1) count, (2) candidates, (3) update, (4) audit insert.
    queryQueue.push([{ count: 1 }]);
    queryQueue.push([candidateRow('row-1', 'auto-approved')]);
    queryQueue.push([]); // update
    queryQueue.push([]); // audit insert

    const res = await post(body(true));
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.apply).toBe(true);
    expect(json.demotedToFlagged).toBe(1);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'revalidate.apply',
      targetType: 'cell',
    });
  });

  it('truncated: caps the scan at 25 and reports the full candidate count', async () => {
    mockValidateDraft.mockResolvedValue({ result: AUTO_APPROVED_RESULT, tokenUsage: ZERO_TOKENS });
    queryQueue.push([{ count: 99 }]);
    queryQueue.push(
      Array.from({ length: 25 }, (_, i) => candidateRow(`row-${i}`, 'auto-approved')),
    );

    const res = await post(body(false));
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.truncated).toBe(true);
    expect(json.totalCandidates).toBe(99);
    expect(json.scanned).toBe(25);
  });

  it('never promotes: a flagged row with an auto-approved verdict is a no-change, no audit', async () => {
    delete insertedValuesByTable.adminAuditLog;
    mockValidateDraft.mockResolvedValue({ result: AUTO_APPROVED_RESULT, tokenUsage: ZERO_TOKENS });
    queryQueue.push([{ count: 1 }]);
    queryQueue.push([candidateRow('row-1', 'flagged')]);

    const res = await post(body(true));
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.noChange).toBe(1);
    expect(json.demotedToFlagged + json.demotedToRejected).toBe(0);
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Audit log — flagged + content
// ---------------------------------------------------------------------------

describe('audit log — flagged + content', () => {
  it('records flagged.approve on an effective approve (exercise)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'ex-1' }]); // UPDATE ... returning → approved
    const id = '11111111-1111-1111-1111-111111111111';
    await app.request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'flagged.approve', targetType: 'exercise', targetId: id, metadata: { outcome: 'approved' },
    });
  });

  it('does NOT record when the flagged approve is already_resolved', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([]); // UPDATE → 0 rows
    queryQueue.push([{ reviewStatus: 'manual-approved' }]); // re-read
    const id = '22222222-2222-2222-2222-222222222222';
    await app.request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });

  it('records content.demote on an effective demote (theory)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'th-1' }]); // UPDATE → demoted
    const id = '33333333-3333-3333-3333-333333333333';
    await app.request(`/admin/content/theory/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'content.demote', targetType: 'theory_topic', targetId: id, metadata: { outcome: 'demoted' },
    });
  });

  it('records flagged.reject on an effective reject (exercise)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'ex-9' }]); // UPDATE...returning → rejected
    const id = '44444444-4444-4444-4444-444444444444';
    await app.request(`/admin/flagged/exercises/${id}/reject`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'flagged.reject', targetType: 'exercise', targetId: id, metadata: { outcome: 'rejected' },
    });
  });

  it('records content.reject on an effective reject (exercise)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'ex-9' }]); // UPDATE...returning → rejected
    const id = '55555555-5555-5555-5555-555555555555';
    await app.request(`/admin/content/exercises/${id}/reject`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'content.reject', targetType: 'exercise', targetId: id, metadata: { outcome: 'rejected' },
    });
  });

  it('does NOT record content.demote when outcome is not_found (exercise)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([]); // UPDATE → 0 rows matched
    queryQueue.push([]); // re-read → no row → not_found
    const id = '66666666-6666-6666-6666-666666666666';
    await app.request(`/admin/content/exercises/${id}/demote`, { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Audit log — generate + invites
// ---------------------------------------------------------------------------

describe('audit log — generate + invites', () => {
  let prevRegion: string | undefined;
  let prevQueueUrl: string | undefined;
  beforeAll(() => {
    prevRegion = process.env.AWS_REGION;
    prevQueueUrl = process.env.GENERATION_QUEUE_URL;
    process.env.AWS_REGION = 'us-east-1';
    process.env.GENERATION_QUEUE_URL = 'https://sqs.test/queue';
  });
  afterAll(() => {
    if (prevRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = prevRegion;
    if (prevQueueUrl === undefined) delete process.env.GENERATION_QUEUE_URL; else process.env.GENERATION_QUEUE_URL = prevQueueUrl;
  });

  it('records generation.trigger after a successful enqueue', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([]); // in-flight check → none
    const res = await app.request('/admin/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 7 }),
    }, adminEnv);
    const body = await res.json() as AnyJson;
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'generation.trigger', targetType: 'cell', metadata: { count: 7, jobId: body.jobId },
    });
  });

  it('does NOT record generation.trigger on a 409 in-flight', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'existing' }]); // in-flight → 409
    await app.request('/admin/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });

  it('records invite.create after generating codes', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'i1', code: 'AAAAAAAA', expiresAt: null, note: null }]); // invites insert .returning
    await app.request('/admin/invites', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 1 }),
    }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'invite.create', targetType: 'invite', targetId: null, metadata: { count: 1 },
    });
  });

  it('records invite.revoke only when actually revoked', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'inv-1', usedBy: null, revokedAt: null }]); // select → revocable
    await app.request('/admin/invites/inv-1/revoke', { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'invite.revoke', targetType: 'invite', targetId: 'inv-1',
    });
  });

  it('does NOT record invite.revoke when already used (409)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'inv-2', usedBy: 'user-x', revokedAt: null }]); // select → used
    await app.request('/admin/invites/inv-2/revoke', { method: 'POST' }, adminEnv);
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/audit
// ---------------------------------------------------------------------------

describe('GET /admin/audit', () => {
  it('returns mapped items + total, newest-first', async () => {
    queryQueue.push([
      {
        id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
        targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: new Date('2026-06-17T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 12 }]);
    const res = await app.request('/admin/audit?limit=50&offset=0', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(12);
    expect(body.items[0]).toMatchObject({
      id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: '2026-06-17T00:00:00.000Z',
    });
  });

  it('accepts action/targetType/adminUserId filters', async () => {
    queryQueue.push([]);
    queryQueue.push([{ count: 0 }]);
    const res = await app.request('/admin/audit?action=invite.revoke&targetType=invite&adminUserId=admin-1', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).items).toEqual([]);
  });

  it('rejects limit over 200 with 400', async () => {
    const res = await app.request('/admin/audit?limit=201', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });

  it('returns empty result on an empty log', async () => {
    queryQueue.push([]);
    queryQueue.push([{ count: 0 }]);
    const res = await app.request('/admin/audit', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ items: [], total: 0 });
  });

  it('rejects a negative offset with 400', async () => {
    const res = await app.request('/admin/audit?offset=-1', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/capacity
// ---------------------------------------------------------------------------

describe('GET /admin/capacity', () => {
  let prevKill: string | undefined;
  let prevCap: string | undefined;
  beforeAll(() => { prevKill = process.env.AI_KILL_SWITCH; prevCap = process.env.AI_GLOBAL_DAILY_CAP; });
  afterAll(() => {
    if (prevKill === undefined) delete process.env.AI_KILL_SWITCH; else process.env.AI_KILL_SWITCH = prevKill;
    if (prevCap === undefined) delete process.env.AI_GLOBAL_DAILY_CAP; else process.env.AI_GLOBAL_DAILY_CAP = prevCap;
  });

  it('reports kill-switch on + cap + 24h usage breakdown + top consumers', async () => {
    process.env.AI_KILL_SWITCH = 'on';
    process.env.AI_GLOBAL_DAILY_CAP = '5000';
    queryQueue.push([
      { eventType: 'read_annotation', count: 380 },
      { eventType: 'ai_evaluation', count: 612 },
    ]); // byEventType (unsorted)
    queryQueue.push([
      { userId: 'u2', count: 95 },
      { userId: 'u1', count: 210 },
    ]); // topConsumers (unsorted)
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.killSwitch).toBe(true);
    expect(body.globalDailyCap).toBe(5000);
    expect(body.usage24h.total).toBe(992);
    expect(body.usage24h.byEventType[0]).toEqual({ eventType: 'ai_evaluation', count: 612 }); // sorted desc
    expect(body.topConsumers[0]).toEqual({ userId: 'u1', count: 210 }); // sorted desc
  });

  it('reports kill-switch off + no cap when env is unset', async () => {
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
    queryQueue.push([]); // byEventType
    queryQueue.push([]); // topConsumers
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.killSwitch).toBe(false);
    expect(body.globalDailyCap).toBeNull();
    expect(body.usage24h).toEqual({ total: 0, byEventType: [] });
    expect(body.topConsumers).toEqual([]);
  });

  it('treats a non-positive cap as no cap', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '0';
    queryQueue.push([]); queryQueue.push([]);
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect(((await res.json()) as AnyJson).globalDailyCap).toBeNull();
  });

  it('caps top consumers at 10', async () => {
    delete process.env.AI_GLOBAL_DAILY_CAP;
    queryQueue.push([]); // byEventType
    queryQueue.push(Array.from({ length: 15 }, (_, i) => ({ userId: `u${i}`, count: i }))); // 15 consumers
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect(((await res.json()) as AnyJson).topConsumers).toHaveLength(10);
  });
});

describe('GET /admin/curriculum', () => {
  it('rejects a bad enum with 400 VALIDATION_ERROR', async () => {
    const res = await app.request('/admin/curriculum?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });

  it('returns the full curriculum with versions when unfiltered', async () => {
    const res = await app.request('/admin/curriculum', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(ALL_CURRICULA.length);
    expect(body.items).toHaveLength(ALL_CURRICULA.length);
    expect(body.curriculumVersionByLanguage).toHaveProperty('ES');
    expect(body.curriculumVersionByLanguage).toHaveProperty('DE');
    expect(body.curriculumVersionByLanguage).toHaveProperty('TR');
  });

  it('filters by language', async () => {
    const res = await app.request('/admin/curriculum?language=TR', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(ALL_CURRICULA.filter((e) => e.language === 'TR').length);
    expect(body.items.every((i: AnyJson) => i.language === 'TR')).toBe(true);
  });

  it('filters by kind', async () => {
    const res = await app.request('/admin/curriculum?kind=grammar', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.items.every((i: AnyJson) => i.kind === 'grammar')).toBe(true);
    expect(body.total).toBe(ALL_CURRICULA.filter((e) => e.kind === 'grammar').length);
  });

  it('sorts ES then DE then TR', async () => {
    const res = await app.request('/admin/curriculum', undefined, adminEnv);
    const langs: string[] = ((await res.json()) as AnyJson).items.map((i: AnyJson) => i.language);
    const order = { ES: 0, DE: 1, TR: 2 } as Record<string, number>;
    for (let i = 1; i < langs.length; i++) {
      expect(order[langs[i]]).toBeGreaterThanOrEqual(order[langs[i - 1]]);
    }
  });

  it('serializes the full entry shape with normalized flags and derived exerciseTypes', async () => {
    const res = await app.request('/admin/curriculum?kind=grammar', undefined, adminEnv);
    const item = ((await res.json()) as AnyJson).items[0];
    expect(typeof item.clozeUnsuitable).toBe('boolean');
    expect(typeof item.sentenceConstructionSuitable).toBe('boolean');
    expect(typeof item.conjugationSuitable).toBe('boolean');
    expect(Array.isArray(item.prerequisiteKeys)).toBe(true);
    expect(item.targetOverride === null || typeof item.targetOverride === 'number').toBe(true);
    expect(item.coverageSpec === null || Array.isArray(item.coverageSpec.axes)).toBe(true);
    const expectedTypes = [
      ...new Set(
        enumerateCurriculumCells(ALL_CURRICULA)
          .filter((cc) => cc.grammarPoint.key === item.key)
          .map((cc) => cc.exerciseType),
      ),
    ].sort();
    expect([...item.exerciseTypes].sort()).toEqual(expectedTypes);
  });

  it('requires admin (non-admin is rejected)', async () => {
    const res = await app.request('/admin/curriculum', undefined, nonAdminEnv);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/theory/pool-status
// ---------------------------------------------------------------------------

describe('GET /admin/theory/pool-status', () => {
  it('returns one row per grammar curriculum point, marking missing/flagged/approved', async () => {
    const grammarPoints = ALL_CURRICULA.filter((gp) => gp.kind === 'grammar');
    const approvedPt = grammarPoints[0];
    const flaggedPt = grammarPoints[1];

    // One aggregated query: per (language, grammarPointKey) → hasApproved + flaggedCount + lastGeneratedAt.
    queryQueue.push([
      { language: approvedPt.language, grammarPointKey: approvedPt.key, hasApproved: true, flaggedCount: 0, lastGeneratedAt: '2026-06-01T00:00:00.000Z' },
      { language: flaggedPt.language, grammarPointKey: flaggedPt.key, hasApproved: false, flaggedCount: 2, lastGeneratedAt: null },
    ]);

    const res = await app.request('/admin/theory/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      language: string; level: string; grammarPointKey: string; name: string;
      hasApprovedPage: boolean; flaggedCount: number; lastGeneratedAt: string | null;
    }>;

    // Every grammar-kind curriculum point appears exactly once.
    expect(body).toHaveLength(grammarPoints.length);

    const byKey = new Map(body.map((r) => [`${r.language}:${r.grammarPointKey}`, r]));
    expect(byKey.get(`${approvedPt.language}:${approvedPt.key}`)?.hasApprovedPage).toBe(true);
    expect(byKey.get(`${flaggedPt.language}:${flaggedPt.key}`)?.hasApprovedPage).toBe(false);
    expect(byKey.get(`${flaggedPt.language}:${flaggedPt.key}`)?.flaggedCount).toBe(2);

    // A point with no DB row is "missing": not approved, zero flagged, name from the curriculum.
    const missing = grammarPoints.find((gp) => gp.key !== approvedPt.key && gp.key !== flaggedPt.key)!;
    const missingRow = byKey.get(`${missing.language}:${missing.key}`);
    expect(missingRow?.hasApprovedPage).toBe(false);
    expect(missingRow?.flaggedCount).toBe(0);
    expect(missingRow?.name).toBe(missing.name);
  });

  it('filters by language', async () => {
    queryQueue.push([]);
    const res = await app.request('/admin/theory/pool-status?language=ES', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ language: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.language === 'ES')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/activity/sessions (legacy tests — kept for regression coverage)
// ---------------------------------------------------------------------------

describe('GET /admin/activity/sessions (legacy)', () => {
  it('returns { items, total } with signals derived from flags', async () => {
    // Two queries via Promise.all: rows then count.
    queryQueue.push([
      { sessionId: 's-low', userId: 'u1', firstName: null, lastName: null, email: null,
        language: 'TR', difficulty: 'A2',
        exerciseCount: 8, correctCount: 2, completedAt: '2026-06-22T10:00:00Z',
        startedAt: '2026-06-22T09:50:00Z', hasOpenFlag: false, isAbandoned: false, isLowScore: true },
      { sessionId: 's-flag', userId: 'u2', firstName: null, lastName: null, email: null,
        language: 'ES', difficulty: 'B1',
        exerciseCount: 5, correctCount: 4, completedAt: '2026-06-22T11:00:00Z',
        startedAt: '2026-06-22T10:55:00Z', hasOpenFlag: true, isAbandoned: false, isLowScore: false },
    ], [{ total: 2 }]);
    const res = await app.request('/admin/activity/sessions', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ sessionId: string; signals: string[] }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items[0].signals).toContain('low_score');
    expect(body.items[1].signals).toContain('flagged');
  });

  it('returns 403 for a non-admin', async () => {
    const res = await app.request('/admin/activity/sessions', undefined,
      { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'nope' } } } } } });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/activity/sessions/:id
// ---------------------------------------------------------------------------

describe('GET /admin/activity/sessions/:id', () => {
  const SID = '11111111-1111-1111-1111-111111111111';
  it('assembles ordered exercises with errors and flags', async () => {
    queryQueue.push(
      [{ sessionId: SID, userId: 'u1', language: 'TR', difficulty: 'A2', exerciseCount: 2,
         correctCount: 1, startedAt: '2026-06-22T09:00:00Z', completedAt: '2026-06-22T09:10:00Z',
         exerciseIds: ['ex-b', 'ex-a'] }],                       // (1) session
      [{ exerciseId: 'ex-a', type: 'cloze', content: { p: 'a' }, score: 0.2,
         response: { answer: 'x' }, evaluatedAt: '2026-06-22T09:05:00Z' },
       { exerciseId: 'ex-b', type: 'cloze', content: { p: 'b' }, score: 1,
         response: { answer: 'y' }, evaluatedAt: '2026-06-22T09:02:00Z',
         historyId: 'h-b' }],                                     // (2) history
      [{ exerciseId: 'ex-a', errorType: 'grammar', severity: 'major',
         wrongText: 'x', correction: 'X', errorGrammarPointKey: null }], // (3) errors
      [{ exerciseId: 'ex-b', category: 'wrong_answer', note: null,
         status: 'open', createdAt: '2026-06-22T09:03:00Z' }],    // (4) flags
    );
    const res = await app.request(`/admin/activity/sessions/${SID}`, undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exercises: Array<{ exerciseId: string; errors: unknown[]; flag: unknown }> };
    // exerciseIds order is ['ex-b','ex-a'] → preserved
    expect(body.exercises.map((e) => e.exerciseId)).toEqual(['ex-b', 'ex-a']);
    expect(body.exercises[0].flag).not.toBeNull();      // ex-b has the flag
    expect(body.exercises[1].errors).toHaveLength(1);   // ex-a has the error
  });

  it('exposes historyId (evaluation id) per exercise, null when unattempted', async () => {
    queryQueue.push(
      [{ sessionId: SID, userId: 'u1', language: 'TR', difficulty: 'A2', exerciseCount: 2,
         correctCount: 1, startedAt: '2026-06-22T09:00:00Z', completedAt: '2026-06-22T09:10:00Z',
         exerciseIds: ['ex-b', 'ex-unattempted'] }],               // (1) session
      [{ exerciseId: 'ex-b', type: 'cloze', content: { p: 'b' }, score: 1,
         response: { answer: 'y' }, evaluatedAt: '2026-06-22T09:02:00Z',
         historyId: 'h-b' }],                                      // (2) history
      [],                                                          // (3) errors
      [],                                                          // (4) flags
    );
    const res = await app.request(`/admin/activity/sessions/${SID}`, undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exercises: Array<{ exerciseId: string; historyId: string | null }> };
    expect(body.exercises[0].historyId).toBe('h-b');
    expect(body.exercises[1].historyId).toBeNull();
  });

  it('returns 404 for an unknown session', async () => {
    queryQueue.push([]); // (1) session → empty
    const res = await app.request(`/admin/activity/sessions/${SID}`, undefined, adminEnv);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/activity/failures
// ---------------------------------------------------------------------------

describe('GET /admin/activity/failures', () => {
  it('returns per-exercise failure aggregates', async () => {
    queryQueue.push([
      { exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
        attempts: 10, distinctUsers: 6, failCount: 7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1 },
    ]);
    const res = await app.request('/admin/activity/failures', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ exerciseId: string; failRate: number; distinctUsers: number }>;
    expect(body[0].exerciseId).toBe('e1');
    expect(body[0].failRate).toBeCloseTo(0.7);
    expect(body[0].distinctUsers).toBe(6);
  });

  it('rejects minAttempts below 1 with 400', async () => {
    const res = await app.request('/admin/activity/failures?minAttempts=0', undefined, adminEnv);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/activity/roster
// ---------------------------------------------------------------------------

describe('GET /admin/activity/roster', () => {
  it('returns per-user activity aggregates ordered by last active', async () => {
    queryQueue.push([
      { userId: 'u1', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
        drills7d: 20, drills30d: 75, languages: ['TR', 'ES'], avgScore30d: 0.62, aiEvents7d: 21 },
    ]);
    const res = await app.request('/admin/activity/roster', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ userId: string; drills7d: number; languages: string[] }>;
    expect(body[0].userId).toBe('u1');
    expect(body[0].drills7d).toBe(20);
    expect(body[0].languages).toEqual(['TR', 'ES']);
  });

  it('rejects an invalid limit with 400', async () => {
    const res = await app.request('/admin/activity/roster?limit=0', undefined, adminEnv);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Regression: the sessions feed's open-flag EXISTS is the one remaining
// correlated subquery in a /admin/activity/* SELECT projection (failures/roster
// were moved to pre-aggregated joins). Its outer reference MUST be a QUALIFIED
// literal (`practice_sessions.id`), NOT an interpolated `${table.column}`:
// Drizzle renders an interpolated column object UNQUALIFIED inside a
// SELECT-projection subquery, so a bare `"id"` is ambiguous (exercise_flags and
// user_exercise_history both have one) — this shipped to prod and 500'd the feed
// with "column reference id is ambiguous". The fragment below MIRRORS admin.ts —
// keep it in sync.
// ---------------------------------------------------------------------------
describe('activity correlated-subquery qualification (regression)', () => {
  it('renders a qualified, unambiguous outer correlation in the sessions projection', async () => {
    const { QueryBuilder } = await import('drizzle-orm/pg-core');
    const { sql } = await import('drizzle-orm');
    const { practiceSessions, exerciseFlags, userExerciseHistory } =
      await import('@language-drill/db');
    const qb = new QueryBuilder();

    // sessions: open-flag EXISTS correlates on practice_sessions.id
    const hasOpenFlag = sql`EXISTS (SELECT 1 FROM ${exerciseFlags} ef JOIN ${userExerciseHistory} ueh ON ueh.id = ef.history_id WHERE ueh.session_id = practice_sessions.id AND ef.status = 'open')`;
    const sProj = qb.select({ x: hasOpenFlag }).from(practiceSessions).toSQL().sql;
    expect(sProj).toContain('practice_sessions.id');
    expect(sProj).not.toMatch(/session_id = "id"/);

    // guard the guard: the interpolated anti-pattern DOES render unqualified
    const broken = sql`EXISTS (SELECT 1 FROM ${exerciseFlags} ef JOIN ${userExerciseHistory} ueh ON ueh.id = ef.history_id WHERE ueh.session_id = ${practiceSessions.id} AND ef.status = 'open')`;
    expect(qb.select({ x: broken }).from(practiceSessions).toSQL().sql).toMatch(/session_id = "id"/);

    // hasIncorrect filter: same correlation class (WHERE-clause EXISTS on
    // user_exercise_history) — MIRRORS admin.ts, keep in sync.
    const hasIncorrect = sql`EXISTS (SELECT 1 FROM ${userExerciseHistory} ueh WHERE ueh.session_id = practice_sessions.id AND ueh.score IS NOT NULL AND ueh.score < 1.0)`;
    const hProj = qb.select({ x: hasIncorrect }).from(practiceSessions).toSQL().sql;
    expect(hProj).toContain('practice_sessions.id');
    expect(hProj).not.toMatch(/session_id = "id"/);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/activity/sessions — new paginated DataTable endpoint (Task 3)
// ---------------------------------------------------------------------------

describe('GET /admin/activity/sessions', () => {
  const sessionRow = {
    sessionId: 's1', userId: 'user_aaaa', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com',
    language: 'TR', difficulty: 'A2', exerciseCount: 8, correctCount: 2,
    completedAt: '2026-06-22T10:00:00Z', startedAt: '2026-06-22T09:50:00Z',
    hasOpenFlag: false, isAbandoned: false, isLowScore: true,
  };

  it('returns { items, total } with names and signals', async () => {
    queryQueue.push([sessionRow], [{ total: 1 }]);
    const res = await app.request('/admin/activity/sessions', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ sessionId: string; firstName: string; signals: string[] }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].sessionId).toBe('s1');
    expect(body.items[0].firstName).toBe('Ada');
    expect(body.items[0].signals).toContain('low_score');
  });

  it('accepts risk + date + user filters', async () => {
    queryQueue.push([], [{ total: 0 }]);
    const res = await app.request('/admin/activity/sessions?risk=abandoned&risk=flagged&from=2026-06-01&to=2026-06-22&user=ada', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });

  it('rejects an invalid risk value with 400', async () => {
    const res = await app.request('/admin/activity/sessions?risk=nope', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('accepts hasIncorrect=true (AND-composed with other filters)', async () => {
    queryQueue.push([], [{ total: 0 }]);
    const res = await app.request('/admin/activity/sessions?hasIncorrect=true&risk=flagged', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });

  it('rejects an invalid hasIncorrect value with 400', async () => {
    const res = await app.request('/admin/activity/sessions?hasIncorrect=nope', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-date from/to value with 400', async () => {
    const res = await app.request('/admin/activity/sessions?from=abc', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a non-admin', async () => {
    const res = await app.request('/admin/activity/sessions', undefined,
      { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'nope' } } } } } });
    expect(res.status).toBe(403);
  });
});
