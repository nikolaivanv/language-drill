import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
//
// The fluency route uses three DB chain shapes:
//   1. db.execute(sql`...`) returning { rows: [...] }       — POST /fluency/session
//   2. db.select().from().where().limit()                   — exercise lookup in POST /fluency/attempts
//      db.insert().values(...)                              — record attempt in POST /fluency/attempts
//   3. db.select({...}).from().where()   (thenable)         — POST /fluency/stats
//
// `mockWhere` is thenable (like sessions.test.ts) to support both the
// direct-await pattern (stats) and the .limit() chain (exercise lookup).
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();

// `mockSelectAwait` powers `await db.select(...).from(...).where(...)` — the
// GET /fluency/stats query awaits where() directly without .limit().
const mockSelectAwait = vi.fn();
const mockWhere = vi.fn(() => {
  return {
    limit: mockLimit,
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve(mockSelectAwait()).then(resolve, reject);
    },
  };
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// db.execute(sql`...`) — used by POST /fluency/session DISTINCT ON query.
const mockExecute = vi.fn();

// db.insert().values(...) — used by POST /fluency/attempts.
const mockValues = vi.fn(() => Promise.resolve([]));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    execute: (sqlExpr: unknown) => mockExecute(sqlExpr),
  },
}));

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    contentJson: 'content_json',
    difficulty: 'difficulty',
    language: 'language',
    grammarPointKey: 'grammar_point_key',
    reviewStatus: 'review_status',
  },
  fluencyAttempts: {
    userId: 'user_id',
    exerciseId: 'exercise_id',
    language: 'language',
    grammarPointKey: 'grammar_point_key',
    correct: 'correct',
    latencyMs: 'latency_ms',
    attemptedAt: 'attempted_at',
  },
}));

// Mock the review-status filter to avoid the real inArray() call.
vi.mock('../lib/exercise-filters', () => ({
  APPROVED_STATUSES: ['auto-approved', 'manual-approved'] as const,
  approvedStatusFilter: (table: unknown) => ({
    __mockToken: 'approved-status-filter',
    table,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Auth env fixtures
// ---------------------------------------------------------------------------

const authEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user_123' } } },
    },
  },
};

const EXERCISE_UUID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Helper to build a pool row for the session endpoint's db.execute result
// ---------------------------------------------------------------------------
function makeConjugationRow(id: string) {
  return makePoolRow({
    id,
    type: ExerciseType.CONJUGATION,
    grammar_point_key: 'es-b1-conditional',
    content_json: {
      type: ExerciseType.CONJUGATION,
      instructions: 'Write the correct form.',
      lemma: 'ir',
      lemmaGloss: 'to go',
      featureBundle: 'condicional · 1ª persona del plural',
      targetForm: 'iríamos',
      breakdown: 'ir + íamos',
      exampleSentences: ['Iríamos al cine.'],
    },
  });
}

function makePoolRow(overrides: Partial<{
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammar_point_key: string | null;
  content_json: unknown;
}> = {}) {
  return {
    id: overrides.id ?? 'ex-uuid-1',
    type: overrides.type ?? ExerciseType.CLOZE,
    language: overrides.language ?? 'ES',
    difficulty: overrides.difficulty ?? 'B1',
    grammar_point_key: overrides.grammar_point_key ?? null,
    content_json: overrides.content_json ?? {
      type: ExerciseType.CLOZE,
      sentence: '___ es bueno',
      correctAnswer: 'Esto',
      acceptableAnswers: [],
    },
  };
}

// ---------------------------------------------------------------------------
// POST /fluency/session
// ---------------------------------------------------------------------------

describe('POST /fluency/session', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./fluency');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 409 INSUFFICIENT_FLUENCY_POOL when db.execute returns only 1 row', async () => {
    // 1 row < MIN_FLUENCY_POOL (4) → insufficient
    mockExecute.mockResolvedValueOnce({ rows: [makePoolRow()] });

    const res = await app.request(
      '/fluency/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INSUFFICIENT_FLUENCY_POOL');
    expect(body.details.required).toBe(4);
  });

  it('returns 200 with exercises array of requested count when pool is sufficient', async () => {
    // 6 rows >= MIN_FLUENCY_POOL (4); count=5 → should return 5 items
    const rows = Array.from({ length: 6 }, (_, i) =>
      makePoolRow({ id: `ex-uuid-${i + 1}` }),
    );
    mockExecute.mockResolvedValueOnce({ rows });

    const res = await app.request(
      '/fluency/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', count: 5 }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exercises).toHaveLength(5);
  });

  it('accepts a conjugation-only types filter and returns 200', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeConjugationRow(`conj-${i + 1}`));
    mockExecute.mockResolvedValueOnce({ rows });

    const res = await app.request(
      '/fluency/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', types: ['conjugation'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exercises.length).toBeGreaterThanOrEqual(4);
    expect(body.exercises.every((e: AnyJson) => e.type === 'conjugation')).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for a non-eligible type', async () => {
    const res = await app.request(
      '/fluency/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', types: ['translation'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for an empty types array', async () => {
    const res = await app.request(
      '/fluency/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', types: [] }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /fluency/attempts
// ---------------------------------------------------------------------------

describe('POST /fluency/attempts', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./fluency');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 422 when latencyMs is 0 (not positive)', async () => {
    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'está',
          latencyMs: 0,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when exercise lookup returns empty array', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'está',
          latencyMs: 1000,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
  });

  it('grades correct answer, clamps latency, records insert, returns 200', async () => {
    // Exercise lookup returns a cloze with correctAnswer 'está'
    mockLimit.mockResolvedValueOnce([
      {
        id: EXERCISE_UUID,
        type: ExerciseType.CLOZE,
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: null,
        contentJson: {
          type: ExerciseType.CLOZE,
          sentence: '___ bien',
          correctAnswer: 'está',
          acceptableAnswers: [],
        },
      },
    ]);

    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: '  ESTÁ ',
          latencyMs: 999999,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.correct).toBe(true);
    expect(body.latencyMs).toBe(60000); // clamped to LATENCY_CEILING_MS

    // Verify db.insert was called once with the expected values
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);
    const insertedValues = (mockValues.mock.calls[0] as unknown as [AnyJson])[0];
    expect(insertedValues.correct).toBe(true);
    expect(insertedValues.latencyMs).toBe(60000);
  });

  it('grades incorrect answer, records insert with correct:false, returns 200', async () => {
    // Exercise lookup returns a cloze with correctAnswer 'está'
    mockLimit.mockResolvedValueOnce([
      {
        id: EXERCISE_UUID,
        type: ExerciseType.CLOZE,
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: null,
        contentJson: {
          type: ExerciseType.CLOZE,
          sentence: '___ bien',
          correctAnswer: 'está',
          acceptableAnswers: [],
        },
      },
    ]);

    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'estar',
          latencyMs: 2000,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.correct).toBe(false);

    // Verify db.insert was called once with correct:false
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);
    const insertedValues = (mockValues.mock.calls[0] as unknown as [AnyJson])[0];
    expect(insertedValues.correct).toBe(false);
  });

  it('returns 400 NOT_FLUENCY_ELIGIBLE for a non-eligible exercise type', async () => {
    // Exercise lookup returns a translation exercise (not eligible for fluency)
    mockLimit.mockResolvedValueOnce([
      {
        id: EXERCISE_UUID,
        language: 'ES',
        type: 'translation',
        grammarPointKey: null,
        contentJson: { type: 'translation' },
      },
    ]);

    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'some answer',
          latencyMs: 1500,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('NOT_FLUENCY_ELIGIBLE');

    // No insert should have been made
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('resolves correctAnswer to targetForm for a conjugation attempt', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: EXERCISE_UUID,
        type: ExerciseType.CONJUGATION,
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: 'es-b1-conditional',
        contentJson: {
          type: ExerciseType.CONJUGATION,
          instructions: 'Write the correct form.',
          lemma: 'ir',
          lemmaGloss: 'to go',
          featureBundle: 'condicional · 1ª persona del plural',
          targetForm: 'iríamos',
          breakdown: 'ir + íamos',
          exampleSentences: ['Iríamos al cine.'],
        },
      },
    ]);

    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'irian', // wrong on purpose
          latencyMs: 1500,
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.correct).toBe(false);
    expect(body.correctAnswer).toBe('iríamos');
  });
});

// ---------------------------------------------------------------------------
// regression: fluency stays off the accuracy radar
// ---------------------------------------------------------------------------
//
// Design guarantee: POST /fluency/attempts writes ONLY to `fluencyAttempts`.
// It must never write to `userExerciseHistory` (what the skill radar reads) or
// `usageEvents` (the AI rate-limit bucket), and it must never call Claude.
//
// This guarantee is structural: routes/fluency.ts imports neither
// `userExerciseHistory`, `usageEvents`, nor `@language-drill/ai`, so those
// side-effects cannot occur. This test guards against a future edit that
// accidentally reintroduces any of them: if `mockInsert` is called more than
// once, a second table has been written; if it is never called, the fluency
// insert was removed. Exactly one call == exactly one table written.

describe('regression: fluency attempts never reach the accuracy radar', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./fluency');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('POST /fluency/attempts calls db.insert exactly once (fluencyAttempts only, no history/usage writes)', async () => {
    // Arrange: exercise lookup returns a cloze with correctAnswer 'está'
    mockLimit.mockResolvedValueOnce([
      {
        id: EXERCISE_UUID,
        type: ExerciseType.CLOZE,
        language: 'ES',
        difficulty: 'B1',
        grammarPointKey: null,
        contentJson: {
          type: ExerciseType.CLOZE,
          sentence: '___ bien',
          correctAnswer: 'está',
          acceptableAnswers: [],
        },
      },
    ]);

    // Act: submit a correct answer
    const res = await app.request(
      '/fluency/attempts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseId: EXERCISE_UUID,
          answer: 'está',
          latencyMs: 1500,
        }),
      },
      authEnv,
    );

    // Assert: route completed successfully
    expect(res.status).toBe(200);

    // Assert: db.insert was called exactly once.
    // routes/fluency.ts only imports `fluencyAttempts` from @language-drill/db,
    // so one insert == one table. Two or more would mean history/usage was also
    // written. Zero would mean the fluencyAttempts write was removed.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GET /fluency/stats
// ---------------------------------------------------------------------------

describe('GET /fluency/stats', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./fluency');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 200 with stats shape for empty history', async () => {
    mockSelectAwait.mockResolvedValueOnce([]);

    const res = await app.request(
      '/fluency/stats?language=ES',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.language).toBe('ES');
    expect(body.totalAttempts).toBe(0);
    expect(body.overallAccuracy).toBe(0);
    expect(body.overallMedianLatencyMs).toBeNull();
    expect(Array.isArray(body.weeks)).toBe(true);
    expect(body.weeks).toHaveLength(8);
  });

  it('returns 400 VALIDATION_ERROR when language is missing', async () => {
    const res = await app.request(
      '/fluency/stats',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
