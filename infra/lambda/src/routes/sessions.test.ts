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
// leftJoin chains back to `where`, which is already thenable — used by
// GET /sessions/today's Path A items query (no .limit / no .orderBy).
const mockLeftJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ where: mockWhere, leftJoin: mockLeftJoin }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// db.execute(sql`...`) — used by GET /sessions/today's Path B UNION-ALL.
const mockExecute = vi.fn();

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
    execute: (sqlExpr: unknown) => mockExecute(sqlExpr),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: {
    id: 'id',
    type: 'type',
    contentJson: 'content_json',
    difficulty: 'difficulty',
    language: 'language',
    reviewStatus: 'review_status',
  },
  userExerciseHistory: { id: 'id', exerciseId: 'exerciseId', sessionId: 'sessionId' },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  usageEvents: {},
  practiceSessions: {
    id: 'id',
    userId: 'user_id',
    language: 'language',
    startedAt: 'started_at',
  },
}));

// Mock the review-status filter so we can count calls per route. The
// SQL-level behaviour (partial-index hit, exclusion of flagged rows) is
// verified end-to-end in Task 19's manual EXPLAIN step.
const mockApprovedStatusFilter = vi.fn((table: unknown) => ({
  __mockToken: 'approved-status-filter',
  table,
}));
const mockFreshFirstOrderBy = vi.fn((userId: string) => ({ __mockToken: 'fresh-first-order-by', userId }));
vi.mock('../lib/exercise-filters', () => ({
  APPROVED_STATUSES: ['auto-approved', 'manual-approved'] as const,
  approvedStatusFilter: (table: unknown) => mockApprovedStatusFilter(table),
  freshFirstOrderBy: (userId: string) => mockFreshFirstOrderBy(userId),
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
    expect(mockFreshFirstOrderBy).toHaveBeenCalledWith('user_123');
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

// ---------------------------------------------------------------------------
// GET /sessions/today route tests
// ---------------------------------------------------------------------------

describe('GET /sessions/today', () => {
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

  // -------------------------------------------------------------------------
  // Validation + auth
  // -------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when the language query param is missing', async () => {
    const res = await app.request('/sessions/today', { method: 'GET' }, authEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for language=EN (LearningLanguageEnum is ES/DE/TR)', async () => {
    const res = await app.request(
      '/sessions/today?language=EN',
      { method: 'GET' },
      authEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      { event: { requestContext: {} } },
    );
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Path A — hydrate from today's session
  // -------------------------------------------------------------------------

  it('Path A: today-session with all items attempted and completedAt set returns done items + summary', async () => {
    const startedAt = new Date('2026-05-04T08:00:00Z');
    const completedAt = new Date('2026-05-04T08:18:00Z'); // +18 min

    // Query 1 (parallel): today's session row + proficiency level
    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'session-uuid-1',
          exerciseIds: ['e1', 'e2', 'e3', 'e4', 'e5'],
          exerciseCount: 5,
          correctCount: 4,
          startedAt,
          completedAt,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    // Query 2 (Path A): leftJoin exercises × user_exercise_history
    // Every exerciseId has a history row → every item is `done`.
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze', topicHint: 'subjunctive', difficulty: 'B1', historyId: 'h1' },
      { exerciseId: 'e2', type: 'cloze', topicHint: 'pronoun', difficulty: 'B1', historyId: 'h2' },
      { exerciseId: 'e3', type: 'translation', topicHint: null, difficulty: 'B1', historyId: 'h3' },
      { exerciseId: 'e4', type: 'vocab_recall', topicHint: 'food', difficulty: 'B1', historyId: 'h4' },
      { exerciseId: 'e5', type: 'cloze', topicHint: 'preterite', difficulty: 'B1', historyId: 'h5' },
    ]);

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.language).toBe('ES');
    expect(body.code).toBeNull();
    expect(body.items).toHaveLength(5);
    expect(body.items.every((it: AnyJson) => it.status === 'done')).toBe(true);
    expect(body.summary).toEqual({
      itemCount: 5,
      correctCount: 4,
      durationMinutes: 18,
    });
    // Sum: cloze 2 + cloze 2 + translation 4 + vocab_recall 2 + cloze 2 = 12
    expect(body.totalEstimatedMinutes).toBe(12);
    // No pool sample query in Path A
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('Path A: today-session with partial attempts returns mixed statuses + summary: null', async () => {
    const startedAt = new Date('2026-05-04T08:00:00Z');

    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'session-uuid-2',
          exerciseIds: ['e1', 'e2', 'e3', 'e4', 'e5'],
          exerciseCount: 5,
          correctCount: 0, // not finalised yet
          startedAt,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    // Only e1 and e2 have history rows → first two `done`, rest `queued`.
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze', topicHint: 'subjunctive', difficulty: 'B1', historyId: 'h1' },
      { exerciseId: 'e2', type: 'cloze', topicHint: 'pronoun', difficulty: 'B1', historyId: 'h2' },
      { exerciseId: 'e3', type: 'translation', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e4', type: 'vocab_recall', topicHint: 'food', difficulty: 'B1', historyId: null },
      { exerciseId: 'e5', type: 'cloze', topicHint: 'preterite', difficulty: 'B1', historyId: null },
    ]);

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.items.map((it: AnyJson) => it.status)).toEqual([
      'done',
      'done',
      'queued',
      'queued',
      'queued',
    ]);
    expect(body.summary).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Path B — fresh plan composition
  // -------------------------------------------------------------------------

  it('Path B: no today-session, pool returns 5 draws → 5 queued items in V1_PLAN_SHAPE order', async () => {
    // No today-session row + proficiency level B2.
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B2' }]);

    // UNION-ALL of 5 LIMIT 20 selects, in slot order:
    // cloze, cloze, translation, vocab_recall, cloze
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: 'pronouns', difficulty: 'B2', grammar_point_key: 'es-b2-pronouns' },
        { id: 'p2', type: 'cloze', topic_hint: 'subjunctive', difficulty: 'B2', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B2', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: 'food', difficulty: 'B2', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: 'preterite', difficulty: 'B2', grammar_point_key: 'es-b2-preterite' },
      ],
    });

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();
    expect(body.summary).toBeNull();
    expect(body.items).toHaveLength(5);
    expect(body.items.every((it: AnyJson) => it.status === 'queued')).toBe(true);
    expect(body.items.map((it: AnyJson) => it.type)).toEqual([
      'cloze',
      'cloze',
      'translation',
      'vocab_recall',
      'cloze',
    ]);
    expect(body.items.map((it: AnyJson) => it.index)).toEqual([1, 2, 3, 4, 5]);
    // cloze 2 + cloze 2 + translation 4 + vocab_recall 2 + cloze 2 = 12
    expect(body.totalEstimatedMinutes).toBe(12);
  });

  it('Path B: UNION-ALL SQL selects grammar_point_key and uses exposure ordering (nulls first)', async () => {
    // Verify the generated SQL structure: it should select grammar_point_key
    // and use freshFirstOrderBy (which produces "nulls first" in its ORDER BY).
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlExpr = mockExecute.mock.calls[0]?.[0] as {
      queryChunks: Array<unknown>;
    };

    // Collect all static-text fragments from the SQL expression recursively.
    // Chunks can be: string/number scalars (skip), objects with 'value' (static
    // text fragment), or objects with 'queryChunks' (nested sql fragment).
    function collectStaticText(expr: { queryChunks: Array<unknown> }): string {
      let text = '';
      for (const chunk of expr.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as Record<string, unknown>;
        if ('value' in c && Array.isArray(c.value)) {
          text += (c.value as string[]).join('');
        } else if ('queryChunks' in c && Array.isArray(c.queryChunks)) {
          text += collectStaticText(c as { queryChunks: unknown[] });
        }
      }
      return text;
    }

    const staticText = collectStaticText(sqlExpr);

    // grammar_point_key must be projected in every subquery
    expect(staticText).toContain('grammar_point_key');
    // The ORDER BY clause must reference the exposure-ordering fragment
    // (not bare random()). The fragment itself is mocked, but the ORDER BY
    // placeholder must be present and the mock must have been called.
    expect(staticText).toContain('ORDER BY');
    expect(staticText).not.toMatch(/ORDER BY\s+random\(\)/i);
    // freshFirstOrderBy is called once per plan type (3 distinct types in V1_PLAN_SHAPE)
    // and must receive the authenticated userId so per-user exposure is tracked.
    expect(mockFreshFirstOrderBy).toHaveBeenCalledWith('user_123');
    expect(mockFreshFirstOrderBy).toHaveBeenCalledTimes(3);
  });

  it('Path B: pool returns no draws → items: [], code: INSUFFICIENT_POOL, status 200', async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    // Empty pool — no approved exercise of any type at this level.
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.items).toEqual([]);
    expect(body.code).toBe('INSUFFICIENT_POOL');
    expect(body.summary).toBeNull();
    expect(body.totalEstimatedMinutes).toBe(0);
  });

  it('Path B: a type missing from the pool is backfilled so the plan stays at 5 items', async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'A1' }]);

    // A1-Turkish shape: cloze + translation present, zero vocab_recall. The
    // sample over-fetches per type, so the vocab slot is backfilled with a
    // distinct cloze rather than emptying the whole plan.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c2', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c3', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c4', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 't1', type: 'translation', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
      ],
    });

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();
    expect(body.items).toHaveLength(5);
    expect(body.items.map((it: AnyJson) => it.index)).toEqual([1, 2, 3, 4, 5]);
    // Slot 4 (normally vocab_recall) is served as a cloze via backfill.
    expect(body.items[3].type).toBe('cloze');
  });

  it('Path B: defaults to B1 when the user has no language profile row', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // no today-session
      .mockResolvedValueOnce([]); // no profile row → fallback to B1

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request(
      '/sessions/today?language=DE',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.items.every((it: AnyJson) => it.difficulty === 'B1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id/debrief route tests
// ---------------------------------------------------------------------------

describe('GET /sessions/:id/debrief', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  // A valid v4 UUID for the session id used in tests.
  const SESSION_ID = '11111111-2222-4222-8222-555555555555';
  const EX_1 = 'ex-1';
  const EX_2 = 'ex-2';
  const EX_3 = 'ex-3';

  // Phase E `responseJson` shape: { userAnswer, evaluation }
  const sampleEvaluation = {
    score: 0.92,
    grammarAccuracy: 0.95,
    vocabularyRange: 'B1',
    taskAchievement: 0.9,
    feedback: 'Solid.',
    errors: [],
    estimatedCefrEvidence: 'B1',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns the debrief payload for a completed session (manifest order, mixed statuses)', async () => {
    // 1. Session row select — owned by user_123, completed.
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:04:38.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 3,
        correctCount: 1,
        exerciseIds: [EX_1, EX_2, EX_3], // manifest order
        startedAt,
        completedAt,
      },
    ]);

    // 2. Items query — out-of-order rows; route must reorder by manifest.
    //    EX_2 is correct (score >= 0.7), EX_1 is incorrect, EX_3 is skipped (no history).
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_2,
          type: 'translation',
          content_json: { instructions: 'Translate', sourceText: 'hi' },
          score: 0.85,
          response_json: { userAnswer: 'hola', evaluation: sampleEvaluation },
        },
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: { instructions: 'Fill', sentence: 'Yo ___' },
          score: 0.4,
          response_json: { userAnswer: 'fui', evaluation: sampleEvaluation },
        },
        {
          // Manifest exercise present in pool but no history row → skipped.
          // The LEFT JOIN still emits the row with null score/response_json.
          exercise_id: EX_3,
          type: 'vocab_recall',
          content_json: { prompt: 'kitchen pan', expectedWord: 'sartén' },
          score: null,
          response_json: null,
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');

    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe(SESSION_ID);
    expect(body.language).toBe('ES');
    expect(body.difficulty).toBe('B1');
    expect(body.exerciseCount).toBe(3);
    expect(body.correctCount).toBe(1);
    expect(body.attemptedCount).toBe(2);
    expect(body.skippedCount).toBe(1);
    expect(body.durationSeconds).toBe(278);
    expect(body.startedAt).toBe(startedAt.toISOString());
    expect(body.completedAt).toBe(completedAt.toISOString());

    // Items must be in manifest order — not in the row order returned by the SQL.
    expect(body.items).toHaveLength(3);
    expect(body.items[0].exerciseId).toBe(EX_1);
    expect(body.items[0].status).toBe('incorrect');
    expect(body.items[0].userAnswer).toBe('fui');
    expect(body.items[0].score).toBe(0.4);
    expect(body.items[0].evaluation).toEqual(sampleEvaluation);

    expect(body.items[1].exerciseId).toBe(EX_2);
    expect(body.items[1].status).toBe('correct');
    expect(body.items[1].userAnswer).toBe('hola');
    expect(body.items[1].score).toBe(0.85);

    expect(body.items[2].exerciseId).toBe(EX_3);
    expect(body.items[2].status).toBe('skipped');
    expect(body.items[2].userAnswer).toBeNull();
    expect(body.items[2].score).toBeNull();
    expect(body.items[2].evaluation).toBeNull();
  });

  it('returns 404 SESSION_NOT_FOUND when the session is owned by a different user, and logs a forensic debrief.not_found event', async () => {
    // The session-row WHERE includes eq(userId), so a foreign session yields 0 rows.
    mockLimit.mockResolvedValueOnce([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('SESSION_NOT_FOUND');
    // Critical: no items query was issued for an unauthorized session.
    expect(mockExecute).not.toHaveBeenCalled();

    // Forensic log fired so CloudWatch can pin which axis tripped a real user.
    expect(warnSpy).toHaveBeenCalledWith(
      'debrief: session row not found for ownership+completion predicate',
      { event: 'debrief.not_found', sessionId: SESSION_ID, userId: 'user_123' },
    );
    warnSpy.mockRestore();
  });

  it('returns 404 SESSION_NOT_FOUND when the session id is unknown', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 404 SESSION_NOT_FOUND when the session is not yet completed', async () => {
    // The session-row WHERE includes isNotNull(completedAt), so an in-progress
    // session returns 0 rows. Same response shape as cross-user / unknown to
    // avoid leaking session existence (NFR Security).
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('items query uses `IN`, not `ANY`, on the exerciseIds interpolation (regression — see .claude/bugs/debrief-items-query-failure)', async () => {
    // Drizzle's `sql\`\`` interpolates a JS array as a positional record
    // `($N, ...)`. `ANY((record))` is invalid Postgres syntax — it broke prod
    // with `op ANY/ALL (array) requires array on right side`. `IN (record)`
    // accepts the same record shape and is valid. Lock the shape here so any
    // regression is caught at unit-test time, since CI does not run SQL
    // against a real Postgres for these handlers (only migrations).
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:04:38.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'TR',
        difficulty: 'A1',
        exerciseCount: 1,
        correctCount: 0,
        exerciseIds: [EX_1],
        startedAt,
        completedAt,
      },
    ]);
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlExpr = mockExecute.mock.calls[0]?.[0] as {
      queryChunks: Array<{ value?: string[] } | unknown>;
    };

    // Reconstruct the static-text skeleton of the SQL. queryChunks alternates
    // between `{ value: [string] }` static fragments and interpolated params.
    const staticText = sqlExpr.queryChunks
      .filter(
        (c): c is { value: string[] } =>
          !!c && typeof c === 'object' && 'value' in c,
      )
      .map((c) => c.value.join(''))
      .join(' /*param*/ ');

    expect(staticText).toContain('e.id IN');
    expect(staticText).not.toContain('ANY(');
  });

  it('returns 400 VALIDATION_ERROR for a non-uuid id', async () => {
    const res = await app.request(
      '/sessions/not-a-uuid/debrief',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    // No DB calls dispatched for a malformed id (no items query, no session row).
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      { event: { requestContext: {} } },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });

  // -------------------------------------------------------------------------
  // Retry-collapse semantics (Req 2.2)
  // -------------------------------------------------------------------------
  // DISTINCT ON in the SQL (with ORDER BY exercise_id, evaluated_at DESC NULLS
  // LAST) guarantees the items query returns at most ONE row per exercise. The
  // test mocks that post-DISTINCT-ON result with the "later" submission's
  // score/responseJson and verifies the route propagates it untouched. Earlier
  // submissions never reach the response. The SQL shape itself is enforced by
  // code review of the raw `sql\`...\`` template in routes/sessions.ts.

  it('uses the most-recent submission per exercise (retry collapse via DISTINCT ON)', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:05:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 1,
        correctCount: 1,
        exerciseIds: [EX_1],
        startedAt,
        completedAt,
      },
    ]);

    // Only the later submission is returned (DISTINCT ON has already applied).
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: { instructions: 'Fill', sentence: 'Yo ___' },
          score: 0.9, // later submission — passes CORRECT_THRESHOLD
          response_json: {
            userAnswer: 'leo',
            evaluation: sampleEvaluation,
          },
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // Exactly one item in the response — earlier retries do not surface.
    expect(body.items).toHaveLength(1);
    expect(body.items[0].score).toBe(0.9);
    expect(body.items[0].userAnswer).toBe('leo');
    expect(body.items[0].status).toBe('correct');
    // The items query was issued exactly once.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Empty user_exercise_history (Req 2.3, design.md Error Handling §6)
  // -------------------------------------------------------------------------

  it('returns 200 with all items skipped when user_exercise_history is empty', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:01:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'DE',
        difficulty: 'B2',
        exerciseCount: 3,
        correctCount: 0,
        exerciseIds: [EX_1, EX_2, EX_3],
        startedAt,
        completedAt,
      },
    ]);

    // LEFT JOIN still returns one row per manifest exercise, but every row has
    // null score/response_json because the right side is empty.
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: { sentence: 'a ___' },
          score: null,
          response_json: null,
        },
        {
          exercise_id: EX_2,
          type: 'translation',
          content_json: { sourceText: 'hello' },
          score: null,
          response_json: null,
        },
        {
          exercise_id: EX_3,
          type: 'vocab_recall',
          content_json: { prompt: 'kitchen pan' },
          score: null,
          response_json: null,
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exerciseCount).toBe(3);
    expect(body.correctCount).toBe(0);
    expect(body.attemptedCount).toBe(0);
    expect(body.skippedCount).toBe(3);
    expect(body.items).toHaveLength(3);
    for (const item of body.items as AnyJson[]) {
      expect(item.status).toBe('skipped');
      expect(item.userAnswer).toBeNull();
      expect(item.score).toBeNull();
      expect(item.evaluation).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Malformed responseJson (Req 2.9, design.md Error Handling §7)
  // -------------------------------------------------------------------------
  // A history row with a present `score` but malformed `response_json` should:
  //   - count toward `attemptedCount` (matches Phase E `count(distinct
  //     exercise_id) FROM user_exercise_history WHERE session_id = $1`)
  //   - report `userAnswer: null`, `evaluation: null` (defensive)
  //   - derive `status` from `score` against CORRECT_THRESHOLD (so it can still
  //     contribute to `correctCount` if the score is high enough)

  it('keeps a malformed responseJson row in attemptedCount with null userAnswer/evaluation', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:02:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 2,
        correctCount: 1,
        exerciseIds: [EX_1, EX_2],
        startedAt,
        completedAt,
      },
    ]);

    // EX_1: malformed responseJson, but score is present and >= threshold.
    // EX_2: well-formed, low score → incorrect.
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: { sentence: 'a ___' },
          score: 0.9,
          response_json: { foo: 'bar' }, // malformed — no userAnswer, no evaluation
        },
        {
          exercise_id: EX_2,
          type: 'cloze',
          content_json: { sentence: 'b ___' },
          score: 0.3,
          response_json: { userAnswer: 'wrong', evaluation: sampleEvaluation },
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // Both rows count as attempted — the malformed JSON does NOT push the row
    // into `skipped`.
    expect(body.attemptedCount).toBe(2);
    expect(body.skippedCount).toBe(0);
    // EX_1 has score >= CORRECT_THRESHOLD → correct, even with null userAnswer.
    expect(body.correctCount).toBe(1);

    expect(body.items[0].status).toBe('correct');
    expect(body.items[0].score).toBe(0.9);
    expect(body.items[0].userAnswer).toBeNull();
    expect(body.items[0].evaluation).toBeNull();

    expect(body.items[1].status).toBe('incorrect');
    expect(body.items[1].score).toBe(0.3);
    expect(body.items[1].userAnswer).toBe('wrong');
    expect(body.items[1].evaluation).toEqual(sampleEvaluation);
  });

  // -------------------------------------------------------------------------
  // Cache-Control header (NFR Performance)
  // -------------------------------------------------------------------------

  it('sets Cache-Control: private, max-age=300 on the success path', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:01:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 1,
        correctCount: 0,
        exerciseIds: [EX_1],
        startedAt,
        completedAt,
      },
    ]);
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: {},
          score: null,
          response_json: null,
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });
});

// ---------------------------------------------------------------------------
// review_status filter — Requirement 3.6
// ---------------------------------------------------------------------------
//
// Two filtered call sites in this route file:
//   - POST /sessions (Drizzle)   → invokes approvedStatusFilter(exercisesTable)
//   - GET /sessions/today Path B → inlines the predicate in the raw-SQL
//     UNION-ALL (no helper call)
//
// Two intentionally NON-filtered call sites:
//   - GET /sessions/today Path A → manifest hydration
//   - GET /sessions/:id/debrief  → manifest hydration
//
// These tests verify both halves: filtered sites invoke the helper, and the
// non-filtered sites preserve flagged exercises that are already in a stored
// manifest. SQL-level filter behaviour is verified end-to-end in Task 19's
// manual EXPLAIN step.

describe('review_status filter — POST /sessions', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const FLAGGED_FIXTURE_ID = 'flagged-fixture-uuid';
  const REJECTED_FIXTURE_ID = 'rejected-fixture-uuid';

  const approvedExercises = [
    { id: 'a1', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: '___ a' }, audioS3Key: null, createdAt: new Date() },
    { id: 'a2', type: 'translation', language: 'ES', difficulty: 'B1', contentJson: { source: 'b' }, audioS3Key: null, createdAt: new Date() },
    { id: 'a3', type: 'vocab_recall', language: 'ES', difficulty: 'B1', contentJson: { word: 'c' }, audioS3Key: null, createdAt: new Date() },
    { id: 'a4', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: '___ d' }, audioS3Key: null, createdAt: new Date() },
    { id: 'a5', type: 'translation', language: 'ES', difficulty: 'B1', contentJson: { source: 'e' }, audioS3Key: null, createdAt: new Date() },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('100 random pool draws never include flagged or rejected fixtures', async () => {
    // The mock represents the SQL filter excluding the flagged/rejected
    // fixtures from this cell — only approved rows ever reach the route.
    // This is the regression canary: if the route stops applying
    // approvedStatusFilter, future fixture additions would expose the leak.
    for (let i = 0; i < 100; i++) {
      mockLimit.mockResolvedValueOnce(approvedExercises);
      mockReturning.mockResolvedValueOnce([{ id: `session-${i}` }]);
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = await app.request(
        '/sessions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'ES', difficulty: 'B1', exerciseCount: 5 }),
        },
        authEnv,
      );
      // Acceptable: 200 (manifest of approved exercises) or 422 (filter left
      // pool too small). Either outcome confirms flagged rows didn't leak.
      expect([200, 422]).toContain(res.status);
      if (res.status === 200) {
        const body = (await res.json()) as AnyJson;
        for (const ex of body.exercises as Array<{ id: string }>) {
          seenIds.add(ex.id);
        }
      }
    }

    expect(seenIds).not.toContain(FLAGGED_FIXTURE_ID);
    expect(seenIds).not.toContain(REJECTED_FIXTURE_ID);
    // Helper invoked once per pool query (one per request).
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(100);
    expect(mockApprovedStatusFilter).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'review_status' }),
    );
  });
});

describe('review_status filter — GET /sessions/today Path B', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const FLAGGED_FIXTURE_ID = 'flagged-fixture-uuid';

  const approvedDraws = [
    { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
    { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
    { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
    { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
    { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('100 fresh-plan composes never include the flagged fixture', async () => {
    // Per iteration: no today-session, profile B1, UNION-ALL returns approved
    // draws only (the SQL filter excluded the flagged fixture). The Path B
    // raw-SQL site adds the predicate inline rather than via the helper, so
    // mockApprovedStatusFilter is NOT invoked here — by design.
    for (let i = 0; i < 100; i++) {
      mockLimit
        .mockResolvedValueOnce([]) // no today-session
        .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);
      mockExecute.mockResolvedValueOnce({ rows: approvedDraws });
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = await app.request(
        '/sessions/today?language=ES',
        { method: 'GET' },
        authEnv,
      );
      // Acceptable: 200 with items, or 200 with INSUFFICIENT_POOL if the
      // filter trimmed the slot count below five.
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnyJson;
      for (const it of (body.items ?? []) as Array<{ id: string }>) {
        seenIds.add(it.id);
      }
    }

    expect(seenIds).not.toContain(FLAGGED_FIXTURE_ID);
    // Path B does not call the helper — it inlines the predicate in raw SQL.
    expect(mockApprovedStatusFilter).not.toHaveBeenCalled();
    // Path B took the UNION-ALL site every iteration.
    expect(mockExecute).toHaveBeenCalledTimes(100);
  });
});

describe('review_status non-filter — GET /sessions/today Path A', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const FLAGGED_FIXTURE_ID = 'flagged-fixture-uuid';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('today-session manifest containing a flagged exercise still hydrates Path A', async () => {
    // Regression for the deliberate non-filter at sessions.ts Path A:
    // hydration by stored manifest IDs preserves flagged exercises so the
    // user doesn't see a phantom missing slot.
    const startedAt = new Date('2026-05-04T08:00:00Z');

    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'session-uuid-flagged-manifest',
          exerciseIds: [FLAGGED_FIXTURE_ID, 'e2', 'e3', 'e4', 'e5'],
          exerciseCount: 5,
          correctCount: 0,
          startedAt,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    // The hydrate query is unfiltered: the flagged fixture's row is returned
    // alongside the others.
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: FLAGGED_FIXTURE_ID, type: 'cloze', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e2', type: 'cloze', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e3', type: 'translation', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e4', type: 'vocab_recall', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e5', type: 'cloze', topicHint: null, difficulty: 'B1', historyId: null },
    ]);

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // Path A's wire format omits exercise ids — the regression is that no slot
    // was dropped from the manifest. Five exerciseIds → five items with
    // sequential indexes; if Path A had been wrongly filtered to skip the
    // flagged row, the array would be shorter or have a gap in `index`.
    expect(body.items).toHaveLength(5);
    expect((body.items as Array<{ index: number }>).map((it) => it.index)).toEqual([1, 2, 3, 4, 5]);
    // Path A must NOT invoke the filter helper.
    expect(mockApprovedStatusFilter).not.toHaveBeenCalled();
    // Path A doesn't run the UNION-ALL pool sample either.
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('review_status non-filter — GET /sessions/:id/debrief', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const SESSION_ID = '11111111-2222-4222-8222-666666666666';
  const FLAGGED_FIXTURE_ID = 'flagged-fixture-uuid';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it("completed session manifest containing a flagged exercise still appears in debrief", async () => {
    // Regression for the deliberate non-filter at sessions.ts debrief: a
    // completed session's debrief view must surface every manifest item,
    // including any exercise that was flagged after the session was committed.
    const startedAt = new Date('2026-05-04T10:00:00Z');
    const completedAt = new Date('2026-05-04T10:05:00Z');

    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 1,
        correctCount: 1,
        exerciseIds: [FLAGGED_FIXTURE_ID],
        startedAt,
        completedAt,
      },
    ]);

    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: FLAGGED_FIXTURE_ID,
          type: 'cloze',
          content_json: { instructions: 'Fill', sentence: 'Yo ___' },
          score: 0.85,
          response_json: { userAnswer: 'fui', evaluation: { score: 0.85 } },
        },
      ],
    });

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    const itemIds = (body.items as Array<{ exerciseId: string }>).map((it) => it.exerciseId);
    expect(itemIds).toContain(FLAGGED_FIXTURE_ID);
    // Debrief hydration is unfiltered — helper not invoked.
    expect(mockApprovedStatusFilter).not.toHaveBeenCalled();
  });
});
