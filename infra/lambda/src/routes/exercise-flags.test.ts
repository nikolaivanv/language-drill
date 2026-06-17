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
    exerciseFlags: { __mock: 'exerciseFlags' },
  };
});

// ---------------------------------------------------------------------------
// Auth env fixtures
// ---------------------------------------------------------------------------

const userEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } } };
const otherUserEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_2' } } } } } };

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
  const mod = await import('./exercise-flags');
  app = new Hono();
  app.route('/', mod.default);
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
