import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ExerciseQuerySchema, SubmitAnswerSchema } from './exercises';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & { onConflictDoNothing: typeof mockOnConflictDoNothing };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: {},
  userExerciseHistory: {},
  usageEvents: {},
}));

const mockEvaluateAnswer = vi.fn();
vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: (...args: unknown[]) => mockEvaluateAnswer(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

describe('ExerciseQuerySchema', () => {
  it('accepts valid language + difficulty', () => {
    const result = ExerciseQuerySchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ language: 'EN', difficulty: 'B1' });
  });

  it('accepts valid language + difficulty + type', () => {
    const result = ExerciseQuerySchema.safeParse({
      language: 'ES',
      difficulty: 'A2',
      type: 'cloze',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      language: 'ES',
      difficulty: 'A2',
      type: 'cloze',
    });
  });

  it('accepts all valid exercise types', () => {
    for (const type of ['cloze', 'translation', 'vocab_recall']) {
      const result = ExerciseQuerySchema.safeParse({
        language: 'DE',
        difficulty: 'C1',
        type,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing language', () => {
    const result = ExerciseQuerySchema.safeParse({ difficulty: 'B1' });
    expect(result.success).toBe(false);
  });

  it('rejects missing difficulty', () => {
    const result = ExerciseQuerySchema.safeParse({ language: 'EN' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid language', () => {
    const result = ExerciseQuerySchema.safeParse({
      language: 'FR',
      difficulty: 'B1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid difficulty', () => {
    const result = ExerciseQuerySchema.safeParse({
      language: 'EN',
      difficulty: 'D1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid exercise type', () => {
    const result = ExerciseQuerySchema.safeParse({
      language: 'EN',
      difficulty: 'B1',
      type: 'quiz',
    });
    expect(result.success).toBe(false);
  });
});

describe('SubmitAnswerSchema', () => {
  it('accepts a non-empty answer string', () => {
    const result = SubmitAnswerSchema.safeParse({ answer: 'hello world' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ answer: 'hello world' });
  });

  it('rejects an empty answer string', () => {
    const result = SubmitAnswerSchema.safeParse({ answer: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing answer', () => {
    const result = SubmitAnswerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string answer', () => {
    const result = SubmitAnswerSchema.safeParse({ answer: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /exercises route tests
// ---------------------------------------------------------------------------

describe('GET /exercises', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const unauthEnv = {
    event: { requestContext: {} },
  };

  const sampleExercise = {
    id: 'abc-123',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store', options: ['go', 'went', 'gone'] },
    audioS3Key: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import so the mock is in place
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns a random exercise matching language and difficulty', async () => {
    mockLimit.mockResolvedValueOnce([sampleExercise]);

    const res = await app.request('/exercises?language=EN&difficulty=B1', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: 'abc-123',
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: sampleExercise.contentJson,
    });
    expect(mockSelect).toHaveBeenCalled();
  });

  it('filters by type when provided', async () => {
    mockLimit.mockResolvedValueOnce([{ ...sampleExercise, type: 'translation' }]);

    const res = await app.request(
      '/exercises?language=EN&difficulty=B1&type=translation',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.type).toBe('translation');
  });

  it('returns 404 with NO_EXERCISES code when no matches found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/exercises?language=TR&difficulty=C2', undefined, authEnv);

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('NO_EXERCISES');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/exercises?language=EN&difficulty=B1', undefined, unauthEnv);

    expect(res.status).toBe(401);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });

  it('returns 400 for invalid query parameters', async () => {
    const res = await app.request('/exercises?language=FR&difficulty=B1', undefined, authEnv);

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when required parameters are missing', async () => {
    const res = await app.request('/exercises?language=EN', undefined, authEnv);

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /exercises/:id route tests
// ---------------------------------------------------------------------------

describe('GET /exercises/:id', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const unauthEnv = {
    event: { requestContext: {} },
  };

  const sampleExercise = {
    id: 'abc-123',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store', options: ['go', 'went', 'gone'] },
    audioS3Key: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns an exercise by ID', async () => {
    mockLimit.mockResolvedValueOnce([sampleExercise]);

    const res = await app.request('/exercises/abc-123', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: 'abc-123',
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: sampleExercise.contentJson,
    });
    expect(mockSelect).toHaveBeenCalled();
  });

  it('returns 404 with EXERCISE_NOT_FOUND code when exercise does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/exercises/nonexistent-id', undefined, authEnv);

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(body.error).toBe('Exercise not found');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/exercises/abc-123', undefined, unauthEnv);

    expect(res.status).toBe(401);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit route tests
// ---------------------------------------------------------------------------

describe('POST /exercises/:id/submit', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const sampleExercise = {
    id: 'abc-123',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store', options: ['go', 'went', 'gone'] },
    audioS3Key: null,
    createdAt: new Date(),
  };

  const sampleEvaluation = {
    score: 0.85,
    grammarAccuracy: 0.9,
    vocabularyRange: 'B1',
    taskAchievement: 0.8,
    feedback: 'Good job!',
    errors: [],
    estimatedCefrEvidence: 'B1',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 200 with evaluation result on successful submission', async () => {
    // First select: fetch exercise by ID (where -> limit chain)
    mockLimit.mockResolvedValueOnce([sampleExercise]);
    // Second select: usage count check (where is awaited directly, no .limit())
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })) // exercise fetch
      .mockResolvedValueOnce([{ count: 5 }] as never); // usage count
    // Mock evaluateAnswer
    mockEvaluateAnswer.mockResolvedValueOnce(sampleEvaluation);

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'I went to the store' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(0.85);
    expect(body.feedback).toBe('Good job!');
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockEvaluateAnswer).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when exercise does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      '/exercises/nonexistent/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'some answer' }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('returns 502 when Claude API fails and does not write to history', async () => {
    // Fetch exercise succeeds
    mockLimit.mockResolvedValueOnce([sampleExercise]);
    // Usage count under limit
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
    // Claude fails
    mockEvaluateAnswer.mockRejectedValueOnce(new Error('Claude API error'));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'test answer' }),
      },
      authEnv,
    );

    expect(res.status).toBe(502);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('AI_UNAVAILABLE');
    // Only the auth middleware user upsert — no history/usage inserts
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when daily evaluation limit is exceeded', async () => {
    // Fetch exercise succeeds
    mockLimit.mockResolvedValueOnce([sampleExercise]);
    // Usage count at limit
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 50 }] as never);

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'test answer' }),
      },
      authEnv,
    );

    expect(res.status).toBe(429);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
    // Only the auth middleware user upsert — no history/usage inserts
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for invalid request body', async () => {
    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: '' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when answer field is missing', async () => {
    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
