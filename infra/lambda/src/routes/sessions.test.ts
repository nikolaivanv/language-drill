import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { CreateSessionRequestSchema } from './sessions';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));

// `mockSelectAwait` powers `await db.select(...).from(...).where(...)` — used by
// the count query in POST /sessions/:id/complete. Make `where()` return a
// thenable that resolves via mockSelectAwait, while still being chainable to
// .orderBy / .limit for the existing POST /sessions flow.
const mockSelectAwait = vi.fn();
const mockWhere = vi.fn(() => {
  return {
    orderBy: mockOrderBy,
    limit: mockLimit,
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve(mockSelectAwait()).then(resolve, reject);
    },
  };
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockReturning = vi.fn();
const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & {
    onConflictDoNothing: typeof mockOnConflictDoNothing;
    returning: typeof mockReturning;
  };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  p.returning = mockReturning;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

type UpdateReturnRow = {
  id?: string;
  startedAt?: Date;
  exerciseCount?: number;
};
const mockUpdateReturning = vi.fn(
  (_cols?: unknown): Promise<UpdateReturnRow[]> => Promise.resolve([]),
);
const mockUpdateWhere = vi.fn((_cond?: unknown) => ({ returning: mockUpdateReturning }));
const mockSet = vi.fn((_payload?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn((_table?: unknown) => ({ set: mockSet }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    update: (table: unknown) => mockUpdate(table),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: {},
  userExerciseHistory: {},
  usageEvents: {},
  practiceSessions: { id: 'id' },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

describe('CreateSessionRequestSchema', () => {
  it('accepts a valid request body', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 5,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 5,
    });
  });

  it('rejects invalid language', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'FR',
      difficulty: 'B1',
      exerciseCount: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid difficulty', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'EN',
      difficulty: 'D1',
      exerciseCount: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects exerciseCount below 1', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects exerciseCount above 20', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 21,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer exerciseCount', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 5.5,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /sessions route tests
// ---------------------------------------------------------------------------

describe('POST /sessions', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const sampleExercises = [
    {
      id: 'ex-1',
      type: 'cloze',
      language: 'ES',
      difficulty: 'B1',
      contentJson: { sentence: '___ uno', options: ['a', 'b'] },
      audioS3Key: null,
      createdAt: new Date(),
    },
    {
      id: 'ex-2',
      type: 'translation',
      language: 'ES',
      difficulty: 'B1',
      contentJson: { source: 'hello', target: 'hola' },
      audioS3Key: null,
      createdAt: new Date(),
    },
    {
      id: 'ex-3',
      type: 'vocab_recall',
      language: 'ES',
      difficulty: 'B1',
      contentJson: { word: 'casa' },
      audioS3Key: null,
      createdAt: new Date(),
    },
    {
      id: 'ex-4',
      type: 'cloze',
      language: 'ES',
      difficulty: 'B1',
      contentJson: { sentence: '___ dos', options: ['x', 'y'] },
      audioS3Key: null,
      createdAt: new Date(),
    },
    {
      id: 'ex-5',
      type: 'translation',
      language: 'ES',
      difficulty: 'B1',
      contentJson: { source: 'world', target: 'mundo' },
      audioS3Key: null,
      createdAt: new Date(),
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('creates a session and returns the manifest', async () => {
    // SELECT exercises matching language + difficulty
    mockLimit.mockResolvedValueOnce(sampleExercises);
    // INSERT practice_sessions returning { id }
    mockReturning.mockResolvedValueOnce([{ id: 'session-uuid-1' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 5,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-uuid-1');
    expect(body.exercises).toHaveLength(5);
    expect(body.exercises.map((e: AnyJson) => e.id)).toEqual([
      'ex-1',
      'ex-2',
      'ex-3',
      'ex-4',
      'ex-5',
    ]);
    // Each manifest item exposes the canonical exercise shape
    expect(body.exercises[0]).toEqual({
      id: 'ex-1',
      type: 'cloze',
      language: 'ES',
      difficulty: 'B1',
      contentJson: sampleExercises[0].contentJson,
    });

    // Verify the insert payload — userId, filters, exerciseCount, and the exact ordered exerciseIds
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith({
      userId: 'user_123',
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 5,
      exerciseIds: ['ex-1', 'ex-2', 'ex-3', 'ex-4', 'ex-5'],
    });
    expect(mockReturning).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 5,
        }),
      },
      { event: { requestContext: {} } },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });

  it('returns 400 with VALIDATION_ERROR for invalid body', async () => {
    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'FR',
          difficulty: 'B1',
          exerciseCount: 5,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 INSUFFICIENT_EXERCISES when the pool is too small and does not insert', async () => {
    // Pool returns fewer exercises than requested
    mockLimit.mockResolvedValueOnce(sampleExercises.slice(0, 3));

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 5,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INSUFFICIENT_EXERCISES');
    expect(body.details).toEqual({ available: 3, requested: 5 });

    // Critical: no insert into practice_sessions. The authMiddleware itself
    // does an ensure-user `db.insert(users).values(...).onConflictDoNothing()`
    // chain on every authed request, so mockInsert/mockValues fire there;
    // the practice_sessions insert is the only one that calls `.returning(...)`.
    expect(mockReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/complete route tests
// ---------------------------------------------------------------------------

describe('POST /sessions/:id/complete', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('finalizes a session and returns the summary', async () => {
    // 1. Count query — 4 of 5 attempted items were correct
    mockSelectAwait.mockResolvedValueOnce([{ correct: '4', attempted: '5' }]);

    // 2. Atomic UPDATE — succeeds, returning the session metadata.
    //    startedAt is 4 minutes ago so durationSeconds ≈ 240.
    const startedAt = new Date(Date.now() - 240_000);
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 'session-uuid-1', startedAt, exerciseCount: 5 },
    ]);

    const res = await app.request(
      '/sessions/session-uuid-1/complete',
      { method: 'POST' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-uuid-1');
    expect(body.exerciseCount).toBe(5);
    expect(body.correctCount).toBe(4);
    expect(body.attemptedCount).toBe(5);
    expect(body.skippedCount).toBe(0);
    // Allow a small jitter for execution time
    expect(body.durationSeconds).toBeGreaterThanOrEqual(239);
    expect(body.durationSeconds).toBeLessThanOrEqual(242);

    // Verify the atomic UPDATE was issued: set() with completedAt + correctCount=4
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    const setArg = mockSet.mock.calls[0]?.[0] as
      | { completedAt: Date; correctCount: number }
      | undefined;
    expect(setArg?.correctCount).toBe(4);
    expect(setArg?.completedAt).toBeInstanceOf(Date);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
  });

  it('returns 400 INVALID_SESSION when UPDATE matches 0 rows (already completed or cross-user)', async () => {
    // Count query still runs even if update later no-ops
    mockSelectAwait.mockResolvedValueOnce([{ correct: '4', attempted: '5' }]);
    // UPDATE matches no rows → completed_at IS NOT NULL OR user_id mismatch
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request(
      '/sessions/session-uuid-1/complete',
      { method: 'POST' },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');

    // The UPDATE was attempted exactly once
    expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
  });

  it('reports skippedCount when not every manifest item was attempted', async () => {
    // 5 items in manifest, only 3 attempted, 2 of those correct
    mockSelectAwait.mockResolvedValueOnce([{ correct: '2', attempted: '3' }]);
    const startedAt = new Date(Date.now() - 60_000);
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 'session-uuid-2', startedAt, exerciseCount: 5 },
    ]);

    const res = await app.request(
      '/sessions/session-uuid-2/complete',
      { method: 'POST' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exerciseCount).toBe(5);
    expect(body.correctCount).toBe(2);
    expect(body.attemptedCount).toBe(3);
    expect(body.skippedCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Cross-user and unknown-session safety (Req 5.7, NFR Security)
  // ---------------------------------------------------------------------------
  // Both scenarios surface as the same wire-level outcome: the atomic UPDATE
  // matches 0 rows because the WHERE predicate (id + user_id + completed_at IS
  // NULL) excludes them. They are split into distinct tests for clarity so a
  // future reader sees that ownership AND existence are both load-bearing on
  // the same code path.

  it('returns 400 INVALID_SESSION when the session belongs to a different user', async () => {
    // The session exists but its user_id does not match c.get('userId').
    // The atomic UPDATE WHERE clause has eq(userId), so 0 rows match.
    mockSelectAwait.mockResolvedValueOnce([{ correct: '0', attempted: '0' }]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request(
      '/sessions/session-owned-by-other-user/complete',
      { method: 'POST' },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
    expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
  });

  it('returns 400 INVALID_SESSION when the session id does not exist at all', async () => {
    // No session row matches the id; the count query returns zeros and the
    // atomic UPDATE matches 0 rows.
    mockSelectAwait.mockResolvedValueOnce([{ correct: '0', attempted: '0' }]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await app.request(
      '/sessions/00000000-0000-0000-0000-000000000000/complete',
      { method: 'POST' },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
    expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
  });
});
