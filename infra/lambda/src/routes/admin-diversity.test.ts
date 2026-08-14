import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ALL_CURRICULA, buildCellKey } from '@language-drill/db';
import { ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock harness — copied verbatim from admin.test.ts:1-133 (the established
// pattern in this package). Diverging from it causes the auth middleware's
// user upsert to hit a real driver.
// ---------------------------------------------------------------------------

const sqsSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SQSClient: vi.fn(function (this: any) { this.send = sqsSend; }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SendMessageCommand: vi.fn(function (this: any, input: unknown) { this.input = input; }),
}));

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
// `db.execute` shifts `queryQueue` SYNCHRONOUSLY at call time (the arrow
// function body runs — and shifts — before the Promise.resolve is even
// constructed). `db.select()` chains shift LAZILY, only when awaited. Inside
// a Promise.all, every execute() call therefore claims its queue entry before
// any select() does, regardless of argument order. This endpoint uses only
// db.execute (three raw SQL aggregates), so the three queue entries drain in
// the literal array order the endpoint writes them in: tag counts, seed
// counts, per-cell totals.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

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

// ---------------------------------------------------------------------------
// Auth + admin env fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin_user_001';

const adminEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: ADMIN_USER_ID } } },
    },
  },
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
// Fixture points — picked out of the real curriculum so an edit to it can't
// silently break this test.
// ---------------------------------------------------------------------------

const variantPoint = ALL_CURRICULA.find(
  (p) => p.language === 'ES' && !p.clozeUnsuitable && (p.constructionVariants?.length ?? 0) > 0,
)!;
const VARIANT_POINT_KEY = variantPoint.key;
const VARIANT_CELL_KEY = buildCellKey({
  language: variantPoint.language,
  cefrLevel: variantPoint.cefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPointKey: variantPoint.key,
});
// Real declared variant ids for this point — a made-up id would fall into
// "unrecognized" (the unlabelledRows bucket), not the declared-variant count.
const VARIANT_ID_1 = variantPoint.constructionVariants![0].id;
const VARIANT_ID_2 = variantPoint.constructionVariants![1].id;

// A curated-seed point with no coverageSpec, so exhaustion is the only
// possible source of provenIssues on it — isolates the atTarget guard.
const curatedPoint = ALL_CURRICULA.find(
  (p) =>
    p.language === 'ES' &&
    !p.clozeUnsuitable &&
    !p.coverageSpec &&
    (p.elicitationSeedValues?.length ?? 0) > 0,
)!;
const CURATED_POINT_KEY = curatedPoint.key;
const CURATED_CELL_KEY = buildCellKey({
  language: curatedPoint.language,
  cefrLevel: curatedPoint.cefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPointKey: curatedPoint.key,
});
const CURATED_SEED_VALUES = curatedPoint.elicitationSeedValues!;

const specPoint = ALL_CURRICULA.find(
  (p) =>
    p.language === 'ES' &&
    !p.clozeUnsuitable &&
    p.coverageSpec?.axes.some((a) => a.name === 'person'),
)!;
const SPEC_POINT_KEY = specPoint.key;
const SPEC_CELL_KEY = buildCellKey({
  language: specPoint.language,
  cefrLevel: specPoint.cefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPointKey: specPoint.key,
});

describe('GET /admin/diversity', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/admin/diversity', undefined, {
      event: { requestContext: {} },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown language with 400', async () => {
    const res = await app.request('/admin/diversity?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
  });

  it('reports a declared variant at zero as a PROVEN issue when every row is labelled', async () => {
    // execute() #1: coverage-tag counts (none for this cell)
    queryQueue.push([]);
    // execute() #2: seedWord counts — all 40 rows carry a declared id
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, seed: VARIANT_ID_1, n: 31 },
      { cellKey: VARIANT_CELL_KEY, seed: VARIANT_ID_2, n: 9 },
    ]);
    // execute() #3: per-cell approved totals + untagged/unlabelled denominators
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, approved: 40, untaggedRows: 0, unlabelledRows: 0 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;

    const point = body.items.find((p: AnyJson) => p.key === VARIANT_POINT_KEY);
    expect(point).toBeDefined();
    const cell = point.cells.find((c: AnyJson) => c.cellKey === VARIANT_CELL_KEY);
    expect(cell).toBeDefined();
    if (cell.seed.kind !== 'construction-variants') throw new Error('narrowing');

    const unrealized = cell.seed.variants.filter((v: AnyJson) => v.count === 0);
    expect(unrealized.length).toBeGreaterThan(0);
    expect(cell.seed.unlabelledRows).toBe(0);
    expect(point.provenIssues).toBeGreaterThan(0);
    expect(point.unknowns).toBe(0);
  });

  it('reports the SAME zero as an UNKNOWN when unlabelled rows remain', async () => {
    queryQueue.push([]);
    queryQueue.push([{ cellKey: VARIANT_CELL_KEY, seed: VARIANT_ID_1, n: 31 }]);
    // 9 rows carry no declared variant id — the zero is unmeasured, not absent
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, approved: 40, untaggedRows: 0, unlabelledRows: 9 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const point = body.items.find((p: AnyJson) => p.key === VARIANT_POINT_KEY);
    const cell = point.cells.find((c: AnyJson) => c.cellKey === VARIANT_CELL_KEY);

    if (cell.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(cell.seed.unlabelledRows).toBe(9);
    expect(point.unknowns).toBeGreaterThan(0);
  });

  it('reports an axis zero as UNKNOWN while rows are untagged', async () => {
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, axis: 'person', value: '1sg', n: 12 },
    ]);
    queryQueue.push([]);
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, approved: 26, untaggedRows: 14, unlabelledRows: 26 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const point = body.items.find((p: AnyJson) => p.key === SPEC_POINT_KEY);
    const cell = point.cells.find((c: AnyJson) => c.cellKey === SPEC_CELL_KEY);
    const personAxis = cell.axes.find((a: AnyJson) => a.name === 'person');

    expect(personAxis.role).toBe('controlled');
    expect(personAxis.untagged).toBe(14);
    expect(point.unknowns).toBeGreaterThan(0);
  });

  it('flags an at-target cell whose floors are unmet — the scheduler never revisits it', async () => {
    // A big single-value count so the cell's approved total clears whatever
    // target this point resolves to, regardless of level.
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, axis: 'person', value: '3sg', n: 500 },
    ]);
    queryQueue.push([]);
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, approved: 500, untaggedRows: 0, unlabelledRows: 500 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const point = body.items.find((p: AnyJson) => p.key === SPEC_POINT_KEY);
    const cell = point.cells.find((c: AnyJson) => c.cellKey === SPEC_CELL_KEY);

    expect(cell.atTarget).toBe(true);
    expect(cell.shortfalls.length).toBeGreaterThan(0);
    expect(point.provenIssues).toBeGreaterThan(0);
  });

  it('restricts the response to points with problems when issuesOnly=true', async () => {
    queryQueue.push([]);
    queryQueue.push([]);
    queryQueue.push([]);

    const res = await app.request('/admin/diversity?issuesOnly=true', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(
      body.items.every((p: AnyJson) => p.provenIssues > 0 || p.unknowns > 0),
    ).toBe(true);
  });

  it('flags an exhausted curated pool as a proven issue when the cell is NOT at target', async () => {
    queryQueue.push([]); // no coverage tags
    queryQueue.push(CURATED_SEED_VALUES.map((v) => ({ cellKey: CURATED_CELL_KEY, seed: v, n: 1 })));
    // approved deliberately below whatever target this point resolves to,
    // so atTarget is false regardless of level or pool size.
    queryQueue.push([
      { cellKey: CURATED_CELL_KEY, approved: 1, untaggedRows: 0, unlabelledRows: 0 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const point = body.items.find((p: AnyJson) => p.key === CURATED_POINT_KEY);
    const cell = point.cells.find((c: AnyJson) => c.cellKey === CURATED_CELL_KEY);

    expect(cell.seed.kind).toBe('curated');
    expect(cell.seed.usedCount).toBe(cell.seed.poolSize);
    expect(cell.atTarget).toBe(false);
    expect(point.provenIssues).toBeGreaterThan(0);
  });

  // Regression: a curated pool can exhaust on a cell that's already sitting
  // at target — that cell isn't trying to generate, so exhaustion there
  // isn't a live issue and must not inflate provenIssues.
  it('does NOT flag an exhausted curated pool as a proven issue when the cell IS at target', async () => {
    queryQueue.push([]);
    queryQueue.push(CURATED_SEED_VALUES.map((v) => ({ cellKey: CURATED_CELL_KEY, seed: v, n: 1 })));
    // A big approved total so this cell clears whatever target it resolves
    // to, regardless of level — same trick as the at-target floors test.
    queryQueue.push([
      { cellKey: CURATED_CELL_KEY, approved: 500, untaggedRows: 0, unlabelledRows: 0 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const point = body.items.find((p: AnyJson) => p.key === CURATED_POINT_KEY);
    const cell = point.cells.find((c: AnyJson) => c.cellKey === CURATED_CELL_KEY);

    expect(cell.seed.kind).toBe('curated');
    expect(cell.seed.usedCount).toBe(cell.seed.poolSize);
    expect(cell.atTarget).toBe(true);
    expect(point.provenIssues).toBe(0);
    expect(point.unknowns).toBe(0);
  });

  it('reports "total" as the pre-filter point count, not the post-issuesOnly item count', async () => {
    // All-empty aggregates: cells with a coverageSpec floor > 0 report a
    // proven shortfall (approved=0 < any positive floor), so issuesOnly=true
    // trims the list while `total` (language-scoped, pre-issuesOnly) must
    // stay the same across both requests.
    queryQueue.push([]);
    queryQueue.push([]);
    queryQueue.push([]);
    const unfiltered = await app.request('/admin/diversity?language=ES', undefined, adminEnv);
    const unfilteredBody = (await unfiltered.json()) as AnyJson;
    expect(unfilteredBody.total).toBe(unfilteredBody.items.length);

    queryQueue.push([]);
    queryQueue.push([]);
    queryQueue.push([]);
    const filtered = await app.request('/admin/diversity?language=ES&issuesOnly=true', undefined, adminEnv);
    const filteredBody = (await filtered.json()) as AnyJson;

    expect(filteredBody.items.length).toBeLessThan(unfilteredBody.items.length);
    expect(filteredBody.total).toBe(unfilteredBody.total);
  });
});
