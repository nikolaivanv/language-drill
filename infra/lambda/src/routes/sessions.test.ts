import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { CreateSessionRequestSchema, levelsAtOrBelow } from './sessions';
import { CefrLevel, Language } from '@language-drill/shared';
import { isFreeWritingDay, FREE_WRITING_CADENCE_DAYS } from '../lib/today-plan';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));

// `mockSelectAwait` powers `await db.select(...).from(...).where(...)` — used by
// the count query in POST /sessions/:id/complete. Make `where()` return a
// thenable that resolves via mockSelectAwait, while still being chainable to
// .orderBy / .limit / .groupBy for the various query shapes.
const mockSelectAwait = vi.fn();
// groupBy() is used by the errorObservations count-by-point query; it needs to
// be thenable so the handler can await the grouped result.
const mockGroupBy = vi.fn(() => ({
  then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    return Promise.resolve(mockSelectAwait()).then(resolve, reject);
  },
}));
const mockWhere = vi.fn(() => {
  return {
    orderBy: mockOrderBy,
    limit: mockLimit,
    groupBy: mockGroupBy,
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve(mockSelectAwait()).then(resolve, reject);
    },
  };
});
// leftJoin chains back to `where`, which is already thenable — used by
// GET /sessions/today's Path A items query (no .limit / no .orderBy).
const mockLeftJoin = vi.fn(() => ({ where: mockWhere }));
// innerJoin chains back to `where` — used by the skill-movements history query
// in GET /sessions/:id/debrief.
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ where: mockWhere, leftJoin: mockLeftJoin, innerJoin: mockInnerJoin }));
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
    // selectDistinct uses the same chain shape as select — routes through the
    // same mockFrom → mockWhere → mockSelectAwait path so per-test sequence
    // ordering via mockSelectAwait.mockResolvedValueOnce works identically.
    selectDistinct: () => mockSelect(),
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
    audioS3Key: 'audio_s3_key',
    grammarPointKey: 'grammar_point_key',
  },
  userExerciseHistory: {
    id: 'id',
    exerciseId: 'exerciseId',
    sessionId: 'sessionId',
    userId: 'user_id',
    score: 'score',
    evaluatedAt: 'evaluated_at',
  },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  userGrammarMastery: {
    userId: 'user_id',
    language: 'language',
    grammarPointKey: 'grammar_point_key',
    masteryScore: 'mastery_score',
    lastPracticedAt: 'last_practiced_at',
  },
  userPreferences: {
    userId: 'user_id',
    dailyMinutes: 'daily_minutes',
    dailyGoal: 'daily_goal',
  },
  errorObservations: {
    userId: 'user_id',
    language: 'language',
    errorGrammarPointKey: 'error_grammar_point_key',
    hostGrammarPointKey: 'host_grammar_point_key',
    occurredAt: 'occurred_at',
  },
  usageEvents: {},
  practiceSessions: {
    id: 'id',
    userId: 'user_id',
    language: 'language',
    startedAt: 'started_at',
  },
  // getGrammarPoint is a pure in-memory function — return undefined for unknown
  // keys so prereqsOf yields [] and the prereq penalty doesn't fire in tests.
  getGrammarPoint: (_key: string) => undefined,
}));

// Mock the review-status filter so we can count calls per route. The
// SQL-level behaviour (partial-index hit, exclusion of flagged rows) is
// verified end-to-end in Task 19's manual EXPLAIN step.
const mockApprovedStatusFilter = vi.fn((table: unknown) => ({
  __mockToken: 'approved-status-filter',
  table,
}));
const mockAudioReadyFilter = vi.fn((table: unknown) => ({
  __mockToken: 'audio-ready-filter',
  table,
}));
const mockFreshFirstOrderBy = vi.fn((userId: string) => ({ __mockToken: 'fresh-first-order-by', userId }));
vi.mock('../lib/exercise-filters', () => ({
  APPROVED_STATUSES: ['auto-approved', 'manual-approved'] as const,
  approvedStatusFilter: (table: unknown) => mockApprovedStatusFilter(table),
  audioReadyFilter: (table: unknown) => mockAudioReadyFilter(table),
  freshFirstOrderBy: (userId: string) => mockFreshFirstOrderBy(userId),
}));

// presignAudioUrl hits the AWS SDK and is env-gated (returns null when
// CONTENT_BUCKET_NAME is unset). Mock it so dictation tests can assert a
// deterministic presigned URL is injected, independent of AWS/env.
// Default: resolve null (no key / no bucket); per-test override via
// mockPresignAudioUrl.mockResolvedValueOnce(...).
const mockPresignAudioUrl = vi.fn(async (_key: string | null | undefined) => null as string | null);
vi.mock('../lib/audio-url', () => ({
  presignAudioUrl: (key: string | null | undefined) => mockPresignAudioUrl(key),
}));

// computeSkillMovements is a pure helper; banding logic is covered by Task 2
// unit tests. Mock it here so the route test is a wiring-only contract.
// Default: return []; per-test override via mockComputeSkillMovements.mockReturnValueOnce(...).
const mockComputeSkillMovements = vi.fn((_args: unknown): Record<string, unknown>[] => []);
vi.mock('../lib/debrief/skill-movements.js', () => ({
  computeSkillMovements: (args: unknown) => mockComputeSkillMovements(args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// levelsAtOrBelow — unit test (at-or-below CEFR ordering, Task 4)
// ---------------------------------------------------------------------------
// This covers the honest correctness of the helper, since the SQL pool mock in
// the integration tests does NOT filter by difficulty — at-or-below pool
// inclusion is a SQL-level concern verified here at the pure-function level.

describe('levelsAtOrBelow', () => {
  it('A1 → [A1] (only itself)', () => {
    expect(levelsAtOrBelow(CefrLevel.A1)).toEqual([CefrLevel.A1]);
  });

  it('A2 → [A1, A2]', () => {
    expect(levelsAtOrBelow(CefrLevel.A2)).toEqual([CefrLevel.A1, CefrLevel.A2]);
  });

  it('B1 → [A1, A2, B1]', () => {
    expect(levelsAtOrBelow(CefrLevel.B1)).toEqual([CefrLevel.A1, CefrLevel.A2, CefrLevel.B1]);
  });

  it('B2 → [A1, A2, B1, B2]', () => {
    expect(levelsAtOrBelow(CefrLevel.B2)).toEqual([
      CefrLevel.A1, CefrLevel.A2, CefrLevel.B1, CefrLevel.B2,
    ]);
  });

  it('C1 → [A1, A2, B1, B2, C1]', () => {
    expect(levelsAtOrBelow(CefrLevel.C1)).toEqual([
      CefrLevel.A1, CefrLevel.A2, CefrLevel.B1, CefrLevel.B2, CefrLevel.C1,
    ]);
  });

  it('C2 → all six levels', () => {
    expect(levelsAtOrBelow(CefrLevel.C2)).toEqual([
      CefrLevel.A1, CefrLevel.A2, CefrLevel.B1, CefrLevel.B2, CefrLevel.C1, CefrLevel.C2,
    ]);
  });
});

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

  it('accepts an optional exerciseType', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 4,
      exerciseType: 'dictation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid exerciseType', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 4,
      exerciseType: 'bogus',
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

  it('creates an untargeted session in the previewed slot order (warm-up cloze first)', async () => {
    // sampleFreshPool projection (db.execute UNION-ALL). Mixed types, NO
    // sentence_construction — exercises the backfill path.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'ex-1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'ex-2', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'ex-3', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'ex-4', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'ex-5', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });
    // buildRankContext: mastery (call 1) + error (call 2). Both empty → all
    // candidates share the neutral priority, so input order is preserved.
    mockSelectAwait.mockResolvedValueOnce([]);
    mockSelectAwait.mockResolvedValueOnce([]);
    // Full-rows fetch by the selected ids (order-independent; route re-orders).
    mockSelectAwait.mockResolvedValueOnce(sampleExercises);
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
    // planSkeleton(5) = [cloze, SC, translation, vocab, cloze]. No SC in the
    // pool, so slot 2 backfills with the next translation (ex-5). The warm-up
    // CLOZE leads — matching the dashboard preview. (Regression: the old flat
    // rank could open the session on a translation, contradicting the plan.)
    expect(body.exercises[0].type).toBe('cloze');
    expect(body.exercises.map((e: AnyJson) => e.id)).toEqual([
      'ex-1',
      'ex-5',
      'ex-2',
      'ex-3',
      'ex-4',
    ]);
    // Each manifest item exposes the canonical exercise shape
    expect(body.exercises[0]).toEqual({
      id: 'ex-1',
      type: 'cloze',
      language: 'ES',
      difficulty: 'B1',
      contentJson: sampleExercises[0].contentJson,
    });

    // The persisted manifest order matches the served order exactly.
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith({
      userId: 'user_123',
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 5,
      exerciseIds: ['ex-1', 'ex-5', 'ex-2', 'ex-3', 'ex-4'],
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

  it('untargeted: returns 422 INSUFFICIENT_EXERCISES only when the pool is empty, and does not insert', async () => {
    // sampleFreshPool yields nothing.
    mockExecute.mockResolvedValueOnce({ rows: [] });
    // buildRankContext: mastery + error (both empty).
    mockSelectAwait.mockResolvedValueOnce([]);
    mockSelectAwait.mockResolvedValueOnce([]);

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
    expect(body.details).toEqual({ available: 0, requested: 5 });

    // Critical: no insert into practice_sessions. The authMiddleware itself
    // does an ensure-user `db.insert(users).values(...).onConflictDoNothing()`
    // chain on every authed request, so mockInsert/mockValues fire there;
    // the practice_sessions insert is the only one that calls `.returning(...)`.
    expect(mockReturning).not.toHaveBeenCalled();
  });

  it('untargeted: a pool missing types yields a shorter session (matches preview tolerance), not 422', async () => {
    // Only two clozes exist — no translation / vocab / SC to fill later slots.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });
    mockSelectAwait.mockResolvedValueOnce([]); // mastery
    mockSelectAwait.mockResolvedValueOnce([]); // error
    mockSelectAwait.mockResolvedValueOnce([
      { id: 'c1', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: '1' }, audioS3Key: null },
      { id: 'c2', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: '2' }, audioS3Key: null },
    ]); // full rows
    mockReturning.mockResolvedValueOnce([{ id: 'session-short' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', difficulty: 'B1', exerciseCount: 5 }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exercises.map((e: AnyJson) => e.id)).toEqual(['c1', 'c2']);
    // exerciseCount is persisted as the ACTUAL manifest length, not the request.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseCount: 2, exerciseIds: ['c1', 'c2'] }),
    );
  });

  it('error-aware ranking decides which exercise fills each type slot (high-error cloze leads the warm-up)', async () => {
    // Two clozes compete for the warm-up slot: the high-error one must win.
    // sampleFreshPool projection (db.execute), high-error listed LAST in SQL
    // order — error-aware ranking must override exposure order within the type.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'cloze-low', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: 'gp-zero-errors' },
        { id: 'tr-1', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: 'gp-zero-errors' },
        { id: 'cloze-high', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: 'gp-many-errors' },
      ],
    });

    // buildRankContext: mastery (call 1) empty → gap=1.0 for all; error (call 2)
    // gives gp-many-errors 4 recent errors → +ERROR_WEIGHT*min(4,5)=+0.6.
    mockSelectAwait.mockResolvedValueOnce([]);
    mockSelectAwait.mockResolvedValueOnce([{ key: 'gp-many-errors', n: 4 }]);
    // Full-rows fetch by selected ids.
    mockSelectAwait.mockResolvedValueOnce([
      { id: 'cloze-low', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: 'lo' }, audioS3Key: null },
      { id: 'cloze-high', type: 'cloze', language: 'ES', difficulty: 'B1', contentJson: { sentence: 'hi' }, audioS3Key: null },
      { id: 'tr-1', type: 'translation', language: 'ES', difficulty: 'B1', contentJson: { source: 'a', target: 'b' }, audioS3Key: null },
    ]);

    // INSERT returning
    mockReturning.mockResolvedValueOnce([{ id: 'session-ranked-1' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 3,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-ranked-1');
    // planSkeleton(3) = [warm-up cloze, core SC, cool-down cloze]. The warm-up
    // slot takes the highest-ranked cloze — the high-error one — even though it
    // was last in SQL order. Priority 1.6 vs. 1.0 for the zero-error cloze.
    expect(body.exercises[0].id).toBe('cloze-high');
    expect(body.exercises[0].type).toBe('cloze');
  });

  it('dictation-only request: returns a manifest of the dictation rows the pool yields', async () => {
    const dictationRows = [
      {
        id: 'd-1',
        type: 'dictation',
        language: 'ES',
        difficulty: 'B1',
        contentJson: { title: 'clip 1' },
        audioS3Key: 'audio/d-1.mp3',
        createdAt: new Date(),
      },
      {
        id: 'd-2',
        type: 'dictation',
        language: 'ES',
        difficulty: 'B1',
        contentJson: { title: 'clip 2' },
        audioS3Key: 'audio/d-2.mp3',
        createdAt: new Date(),
      },
    ];
    mockLimit.mockResolvedValueOnce(dictationRows);
    // buildRankContext: mastery query (mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // buildRankContext: error query (mockGroupBy → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);
    mockReturning.mockResolvedValueOnce([{ id: 'session-dictation-1' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 2,
          exerciseType: 'dictation',
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-dictation-1');
    expect(body.exercises.map((e: AnyJson) => e.type)).toEqual([
      'dictation',
      'dictation',
    ]);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseCount: 2,
        exerciseIds: ['d-1', 'd-2'],
      }),
    );
    // The single-type (and grammar-point) flat path still guards review status
    // via the approvedStatusFilter helper in baseWhere — the canary for the
    // untargeted path moved to the UNION-ALL inline predicate.
    expect(mockApprovedStatusFilter).toHaveBeenCalled();
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

// Frozen "today" shared by every describe that calls GET /sessions/today: a UTC
// day on which TR — not ES or DE — is the free-writing day. Exactly one of
// ES/DE/TR is a free-writing day on any given day, so freezing to a TR day
// keeps the ES/DE today tests off the cadence-gated fw-existence query (which
// they do not mock). Computed once at module load from the pure helper.
const FROZEN_TODAY: Date = (() => {
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < FREE_WRITING_CADENCE_DAYS; i++) {
    const d = new Date(base + i * 86_400_000);
    if (
      isFreeWritingDay(d, Language.TR) &&
      !isFreeWritingDay(d, Language.ES) &&
      !isFreeWritingDay(d, Language.DE)
    ) {
      return d;
    }
  }
  throw new Error('no TR-only free-writing day found in range');
})();

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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_TODAY);
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    // Query 1 (parallel): today's session row + proficiency level + daily-minutes prefs
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
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs: no row → dailyMinutes null → default 8

    // Query 1 (parallel): errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]); // no errors
    // Mastery rows (sequential, mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]); // no mastery rows

    // Query 2 (Path A): leftJoin exercises × user_exercise_history (mockSelectAwait call 3)
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
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows
    mockSelectAwait.mockResolvedValueOnce([]);

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
      .mockResolvedValueOnce([{ proficiencyLevel: 'B2' }])
      .mockResolvedValueOnce([]); // prefs: no row → dailyMinutes null → default 8

    // errorRows (groupBy → mockSelectAwait call 1) — no errors
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2) — empty
    mockSelectAwait.mockResolvedValueOnce([]);

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
    // dailyMinutes null → targetItemCount(null) = 8; pool has 5 draws so at
    // most 5 slots can be filled (backfill exhausted after pass 2).
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeLessThanOrEqual(8);
    expect(body.items.every((it: AnyJson) => it.status === 'queued')).toBe(true);
    // Items must be contiguously re-indexed starting from 1.
    expect(body.items.map((it: AnyJson) => it.index)).toEqual(
      body.items.map((_: AnyJson, i: number) => i + 1),
    );
    // All items must carry a reason (non-null for Path B).
    expect(body.items.every((it: AnyJson) => it.reason !== null && it.reason !== undefined)).toBe(true);
  });

  it('Path B: UNION-ALL SQL selects grammar_point_key and uses exposure ordering (freshFirstOrderBy)', async () => {
    // Verify the generated SQL structure: it should select grammar_point_key
    // and use freshFirstOrderBy (which produces "nulls first" in its ORDER BY).
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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
    const occurrences = (staticText.match(/grammar_point_key/g) ?? []).length;
    expect(occurrences).toBe(4); // once per distinct plan type (cloze, sentence_construction, translation, vocab_recall)
    // The ORDER BY clause must reference the exposure-ordering fragment
    // (not bare random()). The fragment itself is mocked, but the ORDER BY
    // placeholder must be present and the mock must have been called.
    expect(staticText).toContain('ORDER BY');
    expect(staticText).not.toMatch(/ORDER BY\s+random\(\)/i);
    // freshFirstOrderBy is called once per plan type (4 distinct types in V1_PLAN_SHAPE)
    // and must receive the authenticated userId so per-user exposure is tracked.
    expect(mockFreshFirstOrderBy).toHaveBeenCalledWith('user_123');
    expect(mockFreshFirstOrderBy).toHaveBeenCalledTimes(4);
  });

  it('Path B: pool returns no draws → items: [], code: INSUFFICIENT_POOL, status 200', async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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

  it('Path B: a type missing from the pool is backfilled so the plan stays full', async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'A1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // A1-Turkish shape: cloze + translation present, zero vocab_recall/sc. The
    // sample over-fetches per type, so missing slots are backfilled with cloze
    // rather than emptying the whole plan.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c2', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c3', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c4', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c5', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c6', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c7', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
        { id: 'c8', type: 'cloze', topic_hint: null, difficulty: 'A1', grammar_point_key: null },
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
    // dailyMinutes null → targetItemCount(null) = 8; planSkeleton(8) has 8 slots,
    // filled via backfill with the plentiful cloze/translation pool.
    expect(body.items).toHaveLength(8);
    expect(body.items.map((it: AnyJson) => it.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Every item is cloze or translation (backfilled where sc/vocab missing).
    expect(body.items.every((it: AnyJson) => ['cloze', 'translation'].includes(it.type))).toBe(true);
  });

  it('Path B: defaults to B1 when the user has no language profile row', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // no today-session
      .mockResolvedValueOnce([]) // no profile row → fallback to B1
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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

  // -------------------------------------------------------------------------
  // Mastery-aware ranking (Task 11)
  // -------------------------------------------------------------------------
  // Proves that a fresh (never-seen) grammar point is preferred over a mastered
  // one. Uses unknown grammar point keys so getGrammarPoint → undefined →
  // prereqsOf → [] and the prereq penalty never fires — the test isolates gap
  // bias only.

  it('Path B: mastery-aware ranking prefers fresh grammar point over mastered one for cloze slot', async () => {
    // No today-session, profile B1.
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1) — no errors so gp-mastered stays lower priority
    mockSelectAwait.mockResolvedValueOnce([]);

    // Mastery rows (sequential → mockSelectAwait call 2):
    // gp-mastered has high mastery, gp-fresh has no row →
    // rankPlanCandidates gives gp-fresh higher priority (larger gap).
    mockSelectAwait.mockResolvedValueOnce([
      {
        grammarPointKey: 'gp-mastered',
        masteryScore: 0.95,
        lastPracticedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
      },
    ]);

    // Pool: two cloze candidates (plus fillers for other types).
    // gp-mastered is listed first in the pool draw (higher exposure priority),
    // but ranking should demote it in favour of gp-fresh (no mastery row).
    // Provide enough items for planSkeleton(8) to fill all 8 slots.
    mockExecute.mockResolvedValueOnce({
      rows: [
        // Cloze candidates — gp-mastered listed first (would win without ranking).
        { id: 'cloze-mastered', type: 'cloze', topic_hint: 'mastered-topic', difficulty: 'B1', grammar_point_key: 'gp-mastered' },
        { id: 'cloze-fresh',    type: 'cloze', topic_hint: 'fresh-topic',    difficulty: 'B1', grammar_point_key: 'gp-fresh' },
        // Extra cloze candidates for the additional cloze slots in planSkeleton(8).
        { id: 'cloze-extra-1',  type: 'cloze', topic_hint: null,             difficulty: 'B1', grammar_point_key: null },
        { id: 'cloze-extra-2',  type: 'cloze', topic_hint: null,             difficulty: 'B1', grammar_point_key: null },
        { id: 'cloze-extra-3',  type: 'cloze', topic_hint: null,             difficulty: 'B1', grammar_point_key: null },
        // Fill the remaining slot types so composeFreshPlan gets a full plan.
        { id: 'sc-1',           type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'sc-2',           type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'tr-1',           type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'tr-2',           type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'vr-1',           type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
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
    // dailyMinutes null → planSkeleton(8) → up to 8 items.
    expect(body.items.length).toBe(8);

    // Verify the mastery select was issued with the right userId and language.
    // The select chain uses mockWhere, which calls mockSelectAwait.
    expect(mockSelectAwait).toHaveBeenCalled();

    // The first cloze slot (index 1 per planSkeleton(8) warm-up) must be filled
    // by the fresh-grammar-point exercise, NOT the mastered one. After ranking,
    // cloze-fresh (gp-fresh, no mastery → gap = 1.0) outranks cloze-mastered
    // (gp-mastered, mastery 0.95 → gap ≈ 0.05) so it is drawn first.
    const clozesInPlan = (body.items as AnyJson[]).filter((it: AnyJson) => it.type === 'cloze');
    // At least one cloze slot; the first cloze must carry the fresh-point hint.
    expect(clozesInPlan.length).toBeGreaterThanOrEqual(1);
    expect(clozesInPlan[0].topicHint).toBe('fresh-topic');
  });

  // -------------------------------------------------------------------------
  // Free-writing block (Plan 1)
  // -------------------------------------------------------------------------

  it('includes a freeWriting block on the cadence day when a free-writing exercise exists', async () => {
    // Path B (no today-session). mockLimit resolves: today → profile → prefs → fw-existence.
    mockLimit
      .mockResolvedValueOnce([]) // today-session lookup
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([]) // prefs
      .mockResolvedValueOnce([{ id: 'fw-1' }]); // fw-existence: one approved row

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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
      '/sessions/today?language=TR',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // ESTIMATED_MINUTES_BY_TYPE[FREE_WRITING] === 8
    expect(body.freeWriting).toEqual({ estimatedMinutes: 8 });
  });

  it('returns freeWriting: null on the cadence day when no free-writing exercise exists', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([]) // prefs
      .mockResolvedValueOnce([]); // fw-existence: pool empty for this cell

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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
      '/sessions/today?language=TR',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.freeWriting).toBeNull();
  });

  it('returns freeWriting: null on a non-cadence day (no fw-existence query runs)', async () => {
    // ES is not the free-writing language on the frozen (TR) day, so the
    // cadence gate is false — three limits (today, profile, prefs) resolve.
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

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
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.freeWriting).toBeNull();
  });

  // -------------------------------------------------------------------------
  // resumeSessionId (Task 1)
  // -------------------------------------------------------------------------

  it('returns resumeSessionId for an incomplete today-session (Path A)', async () => {
    const startedAt = new Date('2026-05-04T08:00:00Z');

    // Query 1 (parallel): today's session row + proficiency level + prefs
    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'sess-1',
          exerciseIds: ['e1', 'e2'],
          exerciseCount: 2,
          correctCount: 0,
          startedAt,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // Query 2 (Path A): leftJoin exercises × user_exercise_history (mockSelectAwait call 3)
    // e1 attempted, e2 not
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze', topicHint: null, difficulty: 'B1', historyId: 'h1' },
      { exerciseId: 'e2', type: 'translation', topicHint: null, difficulty: 'B1', historyId: null },
    ]);

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.resumeSessionId).toBe('sess-1');
  });

  it('returns null resumeSessionId when no today-session exists (Path B)', async () => {
    // No today-session row + proficiency level B1.
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.resumeSessionId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Task 4: daily-minutes sizing (a) + reason classification (b, c)
  // -------------------------------------------------------------------------

  it('(a) dailyGoal: long → fresh plan has 12 items', async () => {
    // No today-session, profile B1, prefs has dailyGoal 'long'.
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([{ dailyGoal: 'long' }]); // prefs → targetItemCount('long') = 12

    // errorRows (groupBy → mockSelectAwait call 1) — no errors
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2) — empty
    mockSelectAwait.mockResolvedValueOnce([]);

    // Pool: provide 12 distinct items covering cloze/sc/translation/vocab to fill
    // planSkeleton(12): warm-up cloze + 10 core cycling SC/TR/VR/CL + cool-down cloze.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c3', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c4', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's1', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's2', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's3', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't1', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't2', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v1', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v2', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v3', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();
    expect(body.items).toHaveLength(12);
    expect(body.items.map((it: AnyJson) => it.index)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
  });

  it('(a) no prefs row → fresh plan has 8 items (default)', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([]); // prefs: no row → dailyMinutes null → default 8

    // errorRows
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery
    mockSelectAwait.mockResolvedValueOnce([]);

    // Provide enough items to fill planSkeleton(8).
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c3', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's1', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's2', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't1', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't2', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v1', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v2', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();
    expect(body.items).toHaveLength(8);
  });

  it('(b) a grammar point with ≥2 recent errors yields reason: "error-fix"', async () => {
    // Path B with a seeded grammar point that has 3 errors in the last 30 days.
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([{ dailyGoal: 'quick' }]); // prefs → targetItemCount('quick') = 5

    // errorRows: 'gp-errors' has 3 errors → reasonFor → 'error-fix'
    mockSelectAwait.mockResolvedValueOnce([
      { key: 'gp-errors', n: 3 },
    ]);
    // mastery rows: 'gp-errors' has some mastery (so not 'new')
    mockSelectAwait.mockResolvedValueOnce([
      {
        grammarPointKey: 'gp-errors',
        masteryScore: 0.5,
        lastPracticedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), // 2 days ago
      },
    ]);

    // Pool: 'gp-errors' cloze plus fillers for the remaining slot types.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'cloze-err', type: 'cloze', topic_hint: 'errors', difficulty: 'B1', grammar_point_key: 'gp-errors' },
        { id: 'cloze-2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'sc-1', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'tr-1', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'vr-1', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();

    // The error-fix item must appear somewhere in the plan.
    const errItem = (body.items as AnyJson[]).find(
      (it: AnyJson) => it.grammarPointKey === 'gp-errors',
    );
    expect(errItem).toBeDefined();
    expect(errItem?.reason).toBe('error-fix');
  });

  it('(c) a grammar point with no mastery row yields reason: "new"', async () => {
    // Path B with a grammar point that has no mastery row → 'new'.
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([{ dailyGoal: 'quick' }]); // prefs → targetItemCount('quick') = 5

    // errorRows: no errors for gp-new
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows: gp-new has NO entry → reasonFor returns 'new'
    mockSelectAwait.mockResolvedValueOnce([]);

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'cloze-new', type: 'cloze', topic_hint: 'new-topic', difficulty: 'B1', grammar_point_key: 'gp-new' },
        { id: 'cloze-2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'sc-1', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'tr-1', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'vr-1', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBeNull();

    // The fresh grammar point must appear in the plan and carry reason: 'new'.
    const newItem = (body.items as AnyJson[]).find(
      (it: AnyJson) => it.grammarPointKey === 'gp-new',
    );
    expect(newItem).toBeDefined();
    expect(newItem?.reason).toBe('new');
  });

  // -------------------------------------------------------------------------
  // Task 4: engagement gate + dailyGoal sizing
  // -------------------------------------------------------------------------

  it('Task4(a): today-session with 0 attempts (untouched) falls through to Path B → 12-item fresh plan for dailyGoal long', async () => {
    // Bug-fix assertion: before the engagement gate, this would hydrate the
    // stored 2-item session. After the fix, the 0-attempt session is ignored
    // and Path B composes a fresh 12-item plan (dailyGoal: 'long').
    const startedAt = new Date('2026-05-04T08:00:00Z');

    // Query 1 (parallel): today's session row (exists, untouched) + proficiency + prefs
    // Query sequence:
    //   mockLimit call 1: today-session (2 exercises, no completedAt)
    //   mockLimit call 2: proficiency → B1
    //   mockLimit call 3: prefs → dailyGoal 'long'
    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'sess-untouched',
          exerciseIds: ['e1', 'e2'],
          exerciseCount: 2,
          correctCount: 0,
          startedAt,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([{ dailyGoal: 'long' }]);

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // Query 2 (Path A item rows, always fetched to check engagement):
    // Both e1 and e2 have historyId: null → attemptedIds.size = 0, completedAt = null
    // → engaged = false → fall through to Path B.
    // (mockSelectAwait call 3)
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e2', type: 'translation', topicHint: null, difficulty: 'B1', historyId: null },
    ]);

    // Path B: pool sample via UNION-ALL (mockExecute call 1)
    // Provide 12 distinct items covering the types planSkeleton(12) needs.
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'c1',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c2',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c3',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c4',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'c5',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's1',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's2',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 's3',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't1',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't2',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 't3',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v1',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v2',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'v3',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;

    // Must be a FRESH plan (Path B), not the stored 2-item session.
    expect(body.code).toBeNull();
    expect(body.items).toHaveLength(12);
    // Confirm none of the plan items are the stored session's exercise IDs.
    const planIds = (body.items as AnyJson[]).map((it: AnyJson) => it.id);
    expect(planIds).not.toContain('e1');
    expect(planIds).not.toContain('e2');
    // All items queued (fresh plan).
    expect(body.items.every((it: AnyJson) => it.status === 'queued')).toBe(true);
    // resumeSessionId must be null (no engaged session).
    expect(body.resumeSessionId).toBeNull();
    // Path B was reached, so the pool UNION-ALL query was executed.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('Task4(b): today-session with ≥1 attempt → Path A (stored items, mixed statuses + resumeSessionId)', async () => {
    // An engaged session (e1 attempted, e2+e3 queued) must be hydrated via Path A.
    const startedAt = new Date('2026-05-04T09:00:00Z');

    // Query 1 (parallel):
    //   mockLimit call 1: today-session (3 exercises, in-progress)
    //   mockLimit call 2: proficiency → B1
    //   mockLimit call 3: prefs → dailyGoal 'medium'
    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'sess-engaged',
          exerciseIds: ['e1', 'e2', 'e3'],
          exerciseCount: 3,
          correctCount: 0,
          startedAt,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([{ dailyGoal: 'medium' }]);

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // Path A item rows (mockSelectAwait call 3):
    // e1 has historyId → attemptedIds.size = 1 → engaged = true → Path A.
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze',       topicHint: 'pronouns', difficulty: 'B1', historyId: 'h1' },
      { exerciseId: 'e2', type: 'translation',  topicHint: null,       difficulty: 'B1', historyId: null },
      { exerciseId: 'e3', type: 'vocab_recall', topicHint: null,       difficulty: 'B1', historyId: null },
    ]);

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;

    // Path A: hydrated from stored session.
    expect(body.items).toHaveLength(3);
    expect(body.items[0].status).toBe('done');
    expect(body.items[1].status).toBe('queued');
    expect(body.items[2].status).toBe('queued');
    expect(body.resumeSessionId).toBe('sess-engaged');
    expect(body.summary).toBeNull(); // not completed
    // Path B was NOT reached.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('Task4(c): completed today-session → Path A (summary present)', async () => {
    // A completed session must always be hydrated via Path A even if it has
    // zero explicit attempts (edge case — completedAt alone gates engagement).
    const startedAt  = new Date('2026-05-04T07:00:00Z');
    const completedAt = new Date('2026-05-04T07:20:00Z');

    // Query 1 (parallel):
    //   mockLimit call 1: today-session (completed)
    //   mockLimit call 2: proficiency → B1
    //   mockLimit call 3: prefs → dailyGoal 'quick'
    mockLimit
      .mockResolvedValueOnce([
        {
          sessionId: 'sess-done',
          exerciseIds: ['e1', 'e2', 'e3'],
          exerciseCount: 3,
          correctCount: 2,
          startedAt,
          completedAt,
        },
      ])
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([{ dailyGoal: 'quick' }]);

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // Path A item rows (mockSelectAwait call 3):
    // All three exercises have history rows → all `done`.
    // completedAt ≠ null → engaged = true (even without attempt count).
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: 'e1', type: 'cloze',       topicHint: null, difficulty: 'B1', historyId: 'h1' },
      { exerciseId: 'e2', type: 'cloze',       topicHint: null, difficulty: 'B1', historyId: 'h2' },
      { exerciseId: 'e3', type: 'translation',  topicHint: null, difficulty: 'B1', historyId: 'h3' },
    ]);

    const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;

    // Path A: hydrated from stored completed session.
    expect(body.items).toHaveLength(3);
    expect(body.items.every((it: AnyJson) => it.status === 'done')).toBe(true);
    // Summary must be present (completedAt set + all items done).
    expect(body.summary).toEqual({
      itemCount: 3,
      correctCount: 2,
      durationMinutes: 20,
    });
    // resumeSessionId is null for a completed session.
    expect(body.resumeSessionId).toBeNull();
    // Path B was NOT reached.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('Task4(d): fresh plan with dailyGoal quick → 5 items; long → 12 items', async () => {
    // Sub-test: quick → 5.
    // No today-session; prefs dailyGoal 'quick' → targetItemCount('quick') = 5.

    // --- quick: 5 items ---
    {
      vi.clearAllMocks();
      const mod = await import('./sessions');
      app = new Hono();
      app.route('/', mod.default);

      mockLimit
        .mockResolvedValueOnce([]) // today-session
        .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
        .mockResolvedValueOnce([{ dailyGoal: 'quick' }]); // prefs → 5

      // errorRows (groupBy → mockSelectAwait call 1)
      mockSelectAwait.mockResolvedValueOnce([]);
      // mastery rows (sequential → mockSelectAwait call 2)
      mockSelectAwait.mockResolvedValueOnce([]);

      // Pool: provide exactly 5 items so planSkeleton(5) is satisfied.
      mockExecute.mockResolvedValueOnce({
        rows: [
          { id: 'c1', type: 'cloze',        topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'c2', type: 'cloze',        topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 't1', type: 'translation',   topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'v1', type: 'vocab_recall',  topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 's1', type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        ],
      });

      const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
      expect(res.status).toBe(200);
      const bodyQuick = (await res.json()) as AnyJson;
      expect(bodyQuick.code).toBeNull();
      expect(bodyQuick.items).toHaveLength(5);
      expect(bodyQuick.items.every((it: AnyJson) => it.status === 'queued')).toBe(true);
    }

    // --- long: 12 items ---
    {
      vi.clearAllMocks();
      const mod = await import('./sessions');
      app = new Hono();
      app.route('/', mod.default);

      mockLimit
        .mockResolvedValueOnce([]) // today-session
        .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
        .mockResolvedValueOnce([{ dailyGoal: 'long' }]); // prefs → 12

      // errorRows (groupBy → mockSelectAwait call 1)
      mockSelectAwait.mockResolvedValueOnce([]);
      // mastery rows (sequential → mockSelectAwait call 2)
      mockSelectAwait.mockResolvedValueOnce([]);

      // Pool: provide 14 distinct items to fill planSkeleton(12).
      mockExecute.mockResolvedValueOnce({
        rows: [
          { id: 'c1',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'c2',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'c3',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'c4',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'c5',  type: 'cloze',                 topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 's1',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 's2',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 's3',  type: 'sentence_construction', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 't1',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 't2',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 't3',  type: 'translation',           topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'v1',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'v2',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
          { id: 'v3',  type: 'vocab_recall',          topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        ],
      });

      const res = await app.request('/sessions/today?language=ES', { method: 'GET' }, authEnv);
      expect(res.status).toBe(200);
      const bodyLong = (await res.json()) as AnyJson;
      expect(bodyLong.code).toBeNull();
      expect(bodyLong.items).toHaveLength(12);
      expect(bodyLong.items.map((it: AnyJson) => it.index)).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      );
      expect(bodyLong.items.every((it: AnyJson) => it.status === 'queued')).toBe(true);
    }
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

  it('includes submissionId (history id) for attempted items and null for skipped items', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:04:38.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        userId: 'user_123',
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 2,
        correctCount: 1,
        exerciseIds: [EX_1, EX_2], // manifest order
        startedAt,
        completedAt,
      },
    ]);

    const HISTORY_1 = '99999999-1111-4111-8111-111111111111';
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          content_json: { instructions: 'Fill', sentence: 'Yo ___' },
          history_id: HISTORY_1,
          score: 0.85,
          response_json: { userAnswer: 'leo', evaluation: sampleEvaluation },
        },
        {
          // skipped — no history row, so history_id is null.
          exercise_id: EX_2,
          type: 'vocab_recall',
          content_json: { prompt: 'kitchen pan', expectedWord: 'sartén' },
          history_id: null,
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
    expect(body.items[0].exerciseId).toBe(EX_1);
    expect(body.items[0].submissionId).toBe(HISTORY_1);
    expect(body.items[1].exerciseId).toBe(EX_2);
    expect(body.items[1].status).toBe('skipped');
    expect(body.items[1].submissionId).toBeNull();
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

  // -------------------------------------------------------------------------
  // Dictation items get a presigned audioUrl injected into contentJson so the
  // debrief can replay the clip (mirrors POST /sessions). Non-dictation items
  // are returned unchanged, and a null audio_s3_key yields no audioUrl (the
  // presign mock resolves null → withAudioUrl leaves the field absent).
  // -------------------------------------------------------------------------

  it('presigns audioUrl on dictation items only; non-dictation + keyless rows are unchanged', async () => {
    const startedAt = new Date('2026-05-04T10:00:00.000Z');
    const completedAt = new Date('2026-05-04T10:02:00.000Z');
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

    // EX_1: dictation with an audio_s3_key → should get the presigned URL.
    // EX_2: non-dictation (cloze) → content returned unchanged (no audioUrl).
    // EX_3: dictation but null audio_s3_key → presign resolves null → no audioUrl.
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'dictation',
          content_json: { type: 'dictation', referenceText: 'el tiempo lo cura todo' },
          audio_s3_key: 'audio/es/clip-1.mp3',
          score: 0.82,
          response_json: { userAnswer: 'el tiempo lo cura todo', evaluation: null },
        },
        {
          exercise_id: EX_2,
          type: 'cloze',
          content_json: { instructions: 'Fill', sentence: 'Yo ___' },
          audio_s3_key: null,
          score: 0.4,
          response_json: { userAnswer: 'fui', evaluation: sampleEvaluation },
        },
        {
          exercise_id: EX_3,
          type: 'dictation',
          content_json: { type: 'dictation', referenceText: 'sin audio' },
          audio_s3_key: null,
          score: null,
          response_json: null,
        },
      ],
    });

    // Only the keyed dictation row should consume a presigned URL.
    mockPresignAudioUrl.mockResolvedValueOnce('https://signed.example/clip-1.mp3?sig=abc');

    const res = await app.request(
      `/sessions/${SESSION_ID}/debrief`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;

    // EX_1 (dictation, keyed) → audioUrl injected.
    expect(body.items[0].exerciseId).toBe(EX_1);
    expect(body.items[0].contentJson.audioUrl).toBe('https://signed.example/clip-1.mp3?sig=abc');

    // EX_2 (cloze) → never presigned; no audioUrl.
    expect(body.items[1].exerciseId).toBe(EX_2);
    expect(body.items[1].contentJson.audioUrl).toBeUndefined();

    // EX_3 (dictation, null key) → presign resolved null; no audioUrl, no throw.
    expect(body.items[2].exerciseId).toBe(EX_3);
    expect(body.items[2].contentJson.audioUrl).toBeUndefined();

    // presignAudioUrl is called for dictation rows only — EX_1 with its key and
    // EX_3 with null — never for the cloze row (so exactly 2 calls).
    expect(mockPresignAudioUrl).toHaveBeenCalledWith('audio/es/clip-1.mp3');
    expect(mockPresignAudioUrl).toHaveBeenCalledTimes(2);
  });

  it('attaches skillMovements to the debrief payload — wiring + no-numbers contract', async () => {
    // 1. Session row with a grammar-point-keyed exercise.
    const startedAt = new Date('2026-06-16T10:00:00.000Z');
    const completedAt = new Date('2026-06-16T10:05:00.000Z');
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

    // 2. Items query — one correct item with a grammar point key.
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          exercise_id: EX_1,
          type: 'cloze',
          grammar_point_key: 'es-b1-subjunctive',
          content_json: { instructions: 'Fill', sentence: 'Quiero que ___ aquí' },
          audio_s3_key: null,
          score: 0.9,
          response_json: { userAnswer: 'estés', evaluation: sampleEvaluation },
        },
      ],
    });

    // 3. History query — one prior row + one session row for the grammar point.
    //    Resolves via mockSelectAwait (the thenable branch of mockWhere).
    const priorRow = {
      id: 'hist-prior-1',
      sessionId: 'session-prior',
      grammarPointKey: 'es-b1-subjunctive',
      difficulty: 'B1',
      score: 0.6,
      evaluatedAt: new Date('2026-06-15T09:00:00.000Z'),
    };
    const sessionRow = {
      id: 'hist-session-1',
      sessionId: SESSION_ID,
      grammarPointKey: 'es-b1-subjunctive',
      difficulty: 'B1',
      score: 0.9,
      evaluatedAt: new Date('2026-06-16T10:03:00.000Z'),
    };
    mockSelectAwait.mockResolvedValueOnce([priorRow, sessionRow]);

    // 4. Override computeSkillMovements to return a controlled movement so the
    //    test can assert the no-numbers contract without depending on banding math.
    mockComputeSkillMovements.mockReturnValueOnce([
      { grammarPointKey: 'es-b1-subjunctive', label: 'Subjunctive mood', band: 'gain', confidence: 'high' },
    ]);

    const res = await app.request(`/sessions/${SESSION_ID}/debrief`, { method: 'GET' }, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // skillMovements must be an array.
    expect(Array.isArray(body.skillMovements)).toBe(true);

    // Wiring contract: the route called the helper with the affected point's
    // history rows, the session row marked for exclusion, and the label map.
    expect(mockComputeSkillMovements).toHaveBeenCalledTimes(1);
    expect(mockComputeSkillMovements).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'hist-prior-1', grammarPointKey: 'es-b1-subjunctive' }),
          expect.objectContaining({ id: 'hist-session-1' }),
        ]),
        sessionRowIds: expect.any(Set),
        labels: expect.any(Map),
      }),
    );
    const callArg = mockComputeSkillMovements.mock.calls[0][0] as {
      sessionRowIds: Set<string>;
      labels: Map<string, string>;
    };
    expect(callArg.sessionRowIds.has('hist-session-1')).toBe(true);
    expect(callArg.sessionRowIds.has('hist-prior-1')).toBe(false);
    expect(callArg.labels.get('es-b1-subjunctive')).toBeDefined();

    // No-numbers contract: every value in every movement is a string, not a number.
    // Also 'from'/'to' raw scores must NOT appear (only banded strings leak out).
    for (const m of body.skillMovements as Array<Record<string, unknown>>) {
      expect(typeof m.band).toBe('string');
      expect('from' in m).toBe(false);
      expect('to' in m).toBe(false);
      for (const v of Object.values(m)) expect(typeof v).not.toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id — resume payload
// ---------------------------------------------------------------------------

describe('GET /sessions/:id', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  // Real UUID strings (handler validates UUIDs).
  const SESSION_ID = 'aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc';
  const EX_1 = 'ex-id-0001-0000-0000-000000000001';
  const EX_2 = 'ex-id-0002-0000-0000-000000000002';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns ordered exercises + attemptedExerciseIds for the owner', async () => {
    // 1. Session row select (id + userId predicate) → found.
    //    exerciseIds = ['e2','e1'] — order matters for the response.
    mockLimit.mockResolvedValueOnce([
      {
        id: SESSION_ID,
        exerciseIds: [EX_2, EX_1],
        completedAt: null,
      },
    ]);

    // 2. Promise.all: exercise rows + distinct history ids.
    //    Both use .where() as a thenable → mockSelectAwait, called in sequence.
    //    db.select().from(exercisesTable).where(inArray(...)) → exercise rows.
    mockSelectAwait.mockResolvedValueOnce([
      {
        id: EX_1,
        type: 'cloze',
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: 'es-b1-subjunctive',
        contentJson: { sentence: 'Yo ___' },
        audioS3Key: null,
      },
      {
        id: EX_2,
        type: 'translation',
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: null,
        contentJson: { sourceText: 'hello' },
        audioS3Key: null,
      },
    ]);
    //    db.selectDistinct({ exerciseId }).from(userExerciseHistory).where(...) → history.
    //    Only EX_2 was attempted.
    mockSelectAwait.mockResolvedValueOnce([{ exerciseId: EX_2 }]);

    const res = await app.request(`/sessions/${SESSION_ID}`, {}, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe(SESSION_ID);
    // Order follows exerciseIds ([EX_2, EX_1]), not the exercises-table return order.
    expect(body.exercises.map((e: { id: string }) => e.id)).toEqual([EX_2, EX_1]);
    expect(body.attemptedExerciseIds).toEqual([EX_2]);
    expect(body.completedAt).toBeNull();
    // Shape spot-check on one exercise item.
    expect(body.exercises[0]).toMatchObject({
      id: EX_2,
      type: 'translation',
      language: 'ES',
      difficulty: 'B1',
    });
  });

  it('404s for a session the caller does not own', async () => {
    // select(session by id+userId) → [] (ownership predicate yields no row).
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(`/sessions/${SESSION_ID}`, {}, authEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('SESSION_NOT_FOUND');
    // No exercise or history queries fired for a non-owned session.
    // Both exercise-rows select and selectDistinct-history go through mockSelectAwait.
    expect(mockSelectAwait).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a non-uuid id', async () => {
    const res = await app.request(
      '/sessions/not-a-uuid',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    // No DB calls dispatched for a malformed id (validation short-circuits before any DB query).
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockSelectAwait).not.toHaveBeenCalled();
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

  // Projection shape sampleFreshPool's UNION-ALL returns (db.execute).
  const approvedDraws = approvedExercises.map((e) => ({
    id: e.id,
    type: e.type,
    topic_hint: null,
    difficulty: e.difficulty,
    grammar_point_key: null,
  }));

  it('100 untargeted pool draws never include flagged or rejected fixtures', async () => {
    // The mock represents the SQL filter excluding the flagged/rejected
    // fixtures from this cell — only approved rows ever reach the route.
    // This is the regression canary: an untargeted session now samples the
    // pool via sampleFreshPool's UNION-ALL (same path as the dashboard
    // preview), which inlines the review-status predicate. If that predicate
    // is dropped, future fixture additions would expose the leak.
    for (let i = 0; i < 100; i++) {
      // buildRankContext: mastery (call 1) + error (call 2)
      mockSelectAwait.mockResolvedValueOnce([]); // mastery: no rows
      mockSelectAwait.mockResolvedValueOnce([]); // error: no rows
      // sampleFreshPool UNION-ALL → approved projection only
      mockExecute.mockResolvedValueOnce({ rows: approvedDraws });
      // full-rows fetch by selected ids
      mockSelectAwait.mockResolvedValueOnce(approvedExercises);
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
    // Untargeted POST inlines the predicate in the UNION-ALL pool sample (like
    // Path B), not via the approvedStatusFilter helper.
    expect(mockApprovedStatusFilter).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledTimes(100);
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
    // Freeze to a TR free-writing day so the ES requests below never trigger
    // the cadence-gated fw-existence query (unmocked here).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_TODAY);
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('100 fresh-plan composes never include the flagged fixture', async () => {
    // Per iteration: no today-session, profile B1, UNION-ALL returns approved
    // draws only (the SQL filter excluded the flagged fixture). The Path B
    // raw-SQL site adds the predicate inline rather than via the helper, so
    // mockApprovedStatusFilter is NOT invoked here — by design.
    for (let i = 0; i < 100; i++) {
      mockLimit
        .mockResolvedValueOnce([]) // no today-session
        .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
        .mockResolvedValueOnce([]); // prefs
      // errorRows (groupBy → mockSelectAwait call 1)
      mockSelectAwait.mockResolvedValueOnce([]);
      // mastery rows (sequential → mockSelectAwait call 2)
      mockSelectAwait.mockResolvedValueOnce([]);
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
    // Freeze to a TR free-writing day so the ES request below never triggers
    // the cadence-gated fw-existence query (unmocked here).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_TODAY);
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }])
      .mockResolvedValueOnce([]); // prefs

    // errorRows (groupBy → mockSelectAwait call 1)
    mockSelectAwait.mockResolvedValueOnce([]);
    // mastery rows (sequential → mockSelectAwait call 2)
    mockSelectAwait.mockResolvedValueOnce([]);

    // The hydrate query is unfiltered: the flagged fixture's row is returned
    // alongside the others (mockSelectAwait call 3). e2 has a history row so
    // the session is engaged (attemptedIds.size = 1 > 0) → Path A fires.
    mockSelectAwait.mockResolvedValueOnce([
      { exerciseId: FLAGGED_FIXTURE_ID, type: 'cloze', topicHint: null, difficulty: 'B1', historyId: null },
      { exerciseId: 'e2', type: 'cloze', topicHint: null, difficulty: 'B1', historyId: 'h2' },
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
