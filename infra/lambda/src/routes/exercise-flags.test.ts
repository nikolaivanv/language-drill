import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// DB chain mock (copied from admin.test.ts harness)
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
// `__mock` sentinel.
const insertedValuesByTable: Record<string, unknown> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

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

// transaction mock: calls the callback with a tx object that re-uses the same
// dbUpdate spy so that `expect(dbUpdate).not.toHaveBeenCalled()` assertions
// work uniformly whether the handler uses db.update() or a tx.update().
const dbTransaction = vi.fn(async (fn: (tx: { update: typeof dbUpdate }) => unknown) =>
  fn({ update: dbUpdate }),
);

vi.mock('../db', () => ({
  db: {
    select: () => makeChain(),
    insert: (table: unknown) => dbInsert(table as AnyJson),
    update: (table: unknown) => dbUpdate(table),
    transaction: (fn: never) => dbTransaction(fn),
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
    exerciseFlags: { __mock: 'exerciseFlags' },
  };
});

// ---------------------------------------------------------------------------
// Auth env fixtures
// ---------------------------------------------------------------------------

const userEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } } };
const otherUserEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_2' } } } } } };

// Admin fixtures (mirrored from admin.test.ts)
const ADMIN_USER_ID = 'admin_user_001';
const NON_ADMIN_USER_ID = 'user_999';
const adminEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: ADMIN_USER_ID } } } } } };
const nonAdminEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: NON_ADMIN_USER_ID } } } } } };
const previousAdminUserIds = process.env.ADMIN_USER_IDS;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  for (const k of Object.keys(insertedValuesByTable)) {
    delete insertedValuesByTable[k];
  }
  process.env.ADMIN_USER_IDS = ADMIN_USER_ID;
  const mod = await import('./exercise-flags');
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
// Tests
// ---------------------------------------------------------------------------

describe('POST /exercises/:exerciseId/flag', () => {
  it('400s on an invalid body', async () => {
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST', body: JSON.stringify({ category: 'nope' }), headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(400);
  });

  it('404s when the submission is not the caller\'s / does not match the exercise', async () => {
    queryQueue.push([]); // ownership lookup returns no row
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'wrong_answer' }),
      headers: { 'content-type': 'application/json' },
    }, otherUserEnv);
    expect(res.status).toBe(404);
  });

  it('inserts an open flag and returns 201', async () => {
    queryQueue.push([{ id: '22222222-2222-2222-2222-222222222222', userId: 'user_1', exerciseId: '11111111-1111-1111-1111-111111111111' }]); // ownership lookup
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'misleading_explanation', note: 'the reference answer is wrong' }),
      headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(201);
    const inserted = insertedValuesByTable['exerciseFlags'] as Record<string, unknown>;
    expect(inserted).toMatchObject({ historyId: '22222222-2222-2222-2222-222222222222', exerciseId: '11111111-1111-1111-1111-111111111111', userId: 'user_1', category: 'misleading_explanation', status: 'open' });
  });

  it('409s on a duplicate flag (unique history_id violation)', async () => {
    queryQueue.push([{ id: '22222222-2222-2222-2222-222222222222', userId: 'user_1', exerciseId: '11111111-1111-1111-1111-111111111111' }]);
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    // The auth middleware calls db.insert(users) first; let that through, then
    // throw on the exerciseFlags insert (the second insert in the request).
    dbInsert.mockImplementationOnce(() => makeChain()); // users upsert (auth middleware)
    dbInsert.mockImplementationOnce(() => { const c = makeChain(); c.values = vi.fn(() => { throw dupErr; }); return c; });
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'other' }),
      headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('ALREADY_FLAGGED');
  });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

describe('GET /admin/flags', () => {
  it('403s for a non-admin', async () => {
    const res = await app.request('/admin/flags', undefined, nonAdminEnv);
    expect(res.status).toBe(403);
  });

  it('returns open flags joined to exercise + attempt', async () => {
    // list query (join) then count query, in Promise.all order
    queryQueue.push([{
      id: 'f1', status: 'open', category: 'wrong_answer', note: 'bad', createdAt: new Date('2026-06-18T00:00:00Z'), resolvedAt: null,
      exerciseId: 'ex1', submissionId: 'h1',
      exLanguage: 'ES', exLevel: 'B1', exType: 'cloze', exGrammar: 'es-b1-x', exReviewStatus: 'auto-approved', exContent: { type: 'cloze' },
      responseJson: { userAnswer: 'mi respuesta', evaluation: { score: 1, feedback: 'ok' } },
    }]);
    queryQueue.push([{ count: 1 }]);
    const res = await app.request('/admin/flags', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: 'f1', userAnswer: 'mi respuesta', exerciseId: 'ex1' });
    expect((body.items[0].exercise as Record<string, unknown>).reviewStatus).toBe('auto-approved');
  });
});

describe('POST /admin/flags/:id/reject', () => {
  it('rejects the exercise and resolves the flag', async () => {
    // flag lookup → returns the open flag with its exerciseId
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'open' }]);
    // exercise reject update returns 1 row; flag resolve update returns 1 row
    // (dbUpdate chains pull from queryQueue via .returning() → then)
    queryQueue.push([{ id: 'ex1' }]);
    queryQueue.push([{ id: 'f1' }]);
    const res = await app.request('/admin/flags/f1/reject', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('rejected');
  });

  it('returns not_found for an unknown flag', async () => {
    queryQueue.push([]); // flag lookup empty
    const res = await app.request('/admin/flags/missing/reject', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('not_found');
  });

  it('returns already_resolved for a non-open flag without writing', async () => {
    // flag lookup returns a resolved flag → guard short-circuits before any writes
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'resolved_rejected' }]);
    const res = await app.request('/admin/flags/f1/reject', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('already_resolved');
    // guard must short-circuit before the update writes
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /admin/flags/:id/dismiss', () => {
  it('resolves the flag without touching the exercise', async () => {
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'open' }]); // flag lookup
    queryQueue.push([{ id: 'f1' }]); // flag resolve update
    const res = await app.request('/admin/flags/f1/dismiss', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('dismissed');
    // exercises table must not be updated on dismiss
    expect(dbUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ __mock: 'exercises' }));
  });

  it('returns already_resolved for a non-open flag without writing', async () => {
    // flag lookup returns a resolved flag → guard short-circuits before any writes
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'resolved_dismissed' }]);
    const res = await app.request('/admin/flags/f1/dismiss', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('already_resolved');
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('returns not_found for a missing flag without writing', async () => {
    queryQueue.push([]); // flag lookup empty
    const res = await app.request('/admin/flags/missing/dismiss', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('not_found');
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
