import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createObservedClaudeClient,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
} from '@language-drill/ai';
import { EXERCISE_ANSWER_MAX_CHARS } from '@language-drill/shared';
import { ExerciseQuerySchema, SubmitAnswerSchema } from './exercises';
import { getEffectivePlan } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
// `GET /exercises` now uses a single query:
// `db.select().from().where(...).orderBy(...).limit(1)` resolved by `mockLimit`.
// `mockCandidates` is the default resolution of the thenable that `where()`
// returns; it is no longer exercised by GET /exercises tests but is kept so
// the `where()` mock still returns a thenable that carries `.limit`/`.orderBy`
// for the POST /submit tests that call `db.select(...).from(...).where(...)`.
const mockCandidates = vi.fn(async () => [{ id: 'abc-123' }]);
// Return type is loose (`any`) so the POST /submit tests can override `where`
// with the plain `{ orderBy, limit }` shape via `mockImplementationOnce`, while
// the default returns a thenable (candidate ids) carrying `.limit`/`.orderBy`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWhere = vi.fn((): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = mockCandidates() as any;
  p.limit = mockLimit;
  p.orderBy = mockOrderBy;
  return p;
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockOnConflictDoUpdate = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & {
    onConflictDoNothing: typeof mockOnConflictDoNothing;
    onConflictDoUpdate: typeof mockOnConflictDoUpdate;
  };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  p.onConflictDoUpdate = mockOnConflictDoUpdate;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
  },
}));

const mockUpdateMastery = vi.fn((prev: unknown, _obs: unknown) => ({
  masteryScore: prev ? 0.6 : 0.4,
  confidence: 0.5,
  evidenceCount: prev ? 2 : 1,
  lastPracticedAt: new Date('2026-01-01'),
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: { reviewStatus: 'review_status', type: 'type', audioS3Key: 'audio_s3_key' },
  userExerciseHistory: {},
  usageEvents: {},
  practiceSessions: {
    id: 'id',
    userId: 'user_id',
    completedAt: 'completed_at',
    exerciseIds: 'exercise_ids',
  },
  userGrammarMastery: {
    userId: 'user_id',
    grammarPointKey: 'grammar_point_key',
    masteryScore: 'mastery_score',
    confidence: 'confidence',
    evidenceCount: 'evidence_count',
    lastPracticedAt: 'last_practiced_at',
  },
  updateMastery: (prev: unknown, obs: unknown) => mockUpdateMastery(prev, obs),
  getGrammarPoint: vi.fn(() => undefined),
}));

// Mock the review-status filter so we can assert the route invokes it.
// The actual SQL behaviour (partial-index hit, predicate ordering) is
// verified end-to-end in Task 19's manual EXPLAIN step.
const mockApprovedStatusFilter = vi.fn((table: unknown) => ({
  __mockToken: 'approved-status-filter',
  table,
}));
const mockFreshFirstOrderBy = vi.fn((userId: string) => ({ __mockToken: 'fresh-first-order-by', userId }));
const mockAudioReadyFilter = vi.fn((table: unknown) => ({
  __mockToken: 'audio-ready-filter',
  table,
}));
vi.mock('../lib/exercise-filters', () => ({
  APPROVED_STATUSES: ['auto-approved', 'manual-approved'] as const,
  approvedStatusFilter: (table: unknown) => mockApprovedStatusFilter(table),
  freshFirstOrderBy: (userId: string) => mockFreshFirstOrderBy(userId),
  audioReadyFilter: (table: unknown) => mockAudioReadyFilter(table),
}));

const mockEvaluateAnswer = vi.fn();
const mockGradeDictationAnswer = vi.fn();
const mockEvaluateFreeWriting = vi.fn();
// Spy on `withLlmTrace` so observability tests can inspect the trace
// context the route assembles. Default behaviour: transparent passthrough
// (Langfuse is disabled in vitest — no env keys — so this matches the
// real production behaviour for the no-op path).
const mockWithLlmTrace = vi.fn(
  <T>(_ctx: unknown, fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(fn()),
);
vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  createObservedClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: (...args: unknown[]) => mockEvaluateAnswer(...args),
  gradeDictationAnswer: (...args: unknown[]) => mockGradeDictationAnswer(...args),
  evaluateFreeWriting: (...args: unknown[]) => mockEvaluateFreeWriting(...args),
  withLlmTrace: <T>(ctx: unknown, fn: () => T | Promise<T>) =>
    mockWithLlmTrace(ctx, fn),
  EVALUATION_SYSTEM_PROMPT_VERSION: 'evaluate@test',
  DICTATION_EVAL_PROMPT_VERSION: 'dictation@test',
  EVAL_REQUEST_TIMEOUT_MS: 18_000,
  EVAL_MAX_RETRIES: 1,
  FREE_WRITING_EVAL_PROMPT_VERSION: 'free-writing-eval@test',
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS: 45_000,
  FREE_WRITING_EVAL_MAX_RETRIES: 1,
}));

// Mock `node:crypto` so observability tests can pin `submissionId` and
// assert the 1:1 mapping between the Langfuse trace tag and the
// `userExerciseHistory.id` (design.md Open Question 1). The default
// implementation returns a stable string so existing tests that don't
// care about the value still see deterministic inserts.
const mockRandomUUID = vi.fn(() => '00000000-0000-0000-0000-000000000000');
vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(async () => 'free'),
  isAdmin: vi.fn(() => false),
}));
vi.mock('../usage/global-capacity', () => ({
  checkGlobalCapacity: vi.fn(async () => 'ok'),
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

  it('accepts an answer at the max length boundary', () => {
    const result = SubmitAnswerSchema.safeParse({
      answer: 'a'.repeat(EXERCISE_ANSWER_MAX_CHARS),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an answer over the max length (token-cost guard)', () => {
    const result = SubmitAnswerSchema.safeParse({
      answer: 'a'.repeat(EXERCISE_ANSWER_MAX_CHARS + 1),
    });
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
    expect(mockFreshFirstOrderBy).toHaveBeenCalledWith('user_123');
  });

  it('applies exposure ordering (freshFirstOrderBy) and returns the drawn row', async () => {
    // The single-query exposure draw uses freshFirstOrderBy(userId) as the
    // ORDER BY clause so never-seen items surface first; assert the ordering
    // function is invoked with the authenticated userId and the full row is
    // returned.
    mockLimit.mockResolvedValueOnce([sampleExercise]);

    const res = await app.request('/exercises?language=EN&difficulty=B1', undefined, authEnv);

    expect(res.status).toBe(200);
    expect(mockFreshFirstOrderBy).toHaveBeenCalledWith('user_123');
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('abc-123');
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

  it('returns 404 with NO_EXERCISES when the pool is empty', async () => {
    // The single-query draw returns [] when no approved exercise matches the
    // given filters; the route converts that to a 404.
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
    // The eval client is constructed with the fail-fast timeout/retries
    // (Req 4.1, 4.5) — applied at construction, not per-request.
    expect(vi.mocked(createObservedClaudeClient)).toHaveBeenCalledWith(
      expect.any(String),
      { timeout: EVAL_REQUEST_TIMEOUT_MS, maxRetries: EVAL_MAX_RETRIES },
    );
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

  it('boosted user passes the free 50 cap (count 60 → proceeds to eval)', async () => {
    // Boosted plan raises the ai_evaluation cap from 50 to 500, so a count of
    // 60 is under the limit and the request proceeds to Claude.
    vi.mocked(getEffectivePlan).mockResolvedValueOnce('boosted');

    // exercise lookup → usage count (no session)
    mockLimit.mockResolvedValueOnce([sampleExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 60 }] as never);
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
    expect(mockEvaluateAnswer).toHaveBeenCalledTimes(1);
  });

  it('returns 503 GLOBAL_CAPACITY when the global guard trips', async () => {
    vi.mocked(checkGlobalCapacity).mockResolvedValueOnce('capped');

    // The guard runs before the usage-count query, so only the exercise
    // lookup needs seeding.
    mockLimit.mockResolvedValueOnce([sampleExercise]);

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'test answer' }),
      },
      authEnv,
    );

    expect(res.status).toBe(503);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('GLOBAL_CAPACITY');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
    // Only the auth middleware user upsert — no history/usage inserts
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 503 GLOBAL_CAPACITY when the kill switch trips', async () => {
    vi.mocked(checkGlobalCapacity).mockResolvedValueOnce('killed');

    mockLimit.mockResolvedValueOnce([sampleExercise]);

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'test answer' }),
      },
      authEnv,
    );

    expect(res.status).toBe(503);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('GLOBAL_CAPACITY');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
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

  // -------------------------------------------------------------------------
  // Dictation submit branch
  // -------------------------------------------------------------------------

  it('calls gradeDictationAnswer for dictation exercises and writes history with kind=dictation', async () => {
    const dictationExercise = {
      id: 'dict-001',
      type: 'dictation',
      language: 'ES',
      difficulty: 'B2',
      contentJson: {
        type: 'dictation',
        title: 'El tiempo lo cura todo',
        referenceText: 'El tiempo lo cura todo.',
        sentences: ['El tiempo lo cura todo.'],
        accent: 'español peninsular · centro',
        voiceId: 'Sergio',
        tested: ['listening'],
        durationSec: 3,
        waveform: [0.5, 0.8, 0.6],
      },
      audioS3Key: null,
      createdAt: new Date(),
    };

    const dictationResult = {
      kind: 'dictation' as const,
      score: 0.9,
      grammarAccuracy: 0.9,
      vocabularyRange: 'B2',
      taskAchievement: 0.9,
      feedback: 's',
      errors: [],
      estimatedCefrEvidence: 'B2',
      rawCharAccuracy: 0.9,
      adjustedCharAccuracy: 0.9,
      wordAccuracy: 0.9,
      listeningCefr: 'B2',
      headline: 'h',
      summary: 's',
      diff: [],
      differences: [],
      criteria: [],
    };

    // exercise fetch → usage count
    mockLimit.mockResolvedValueOnce([dictationExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
    mockGradeDictationAnswer.mockResolvedValueOnce(dictationResult);

    const res = await app.request(
      '/exercises/dict-001/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'El tiempo lo cura todo.' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.kind).toBe('dictation');
    expect(body.score).toBe(0.9);

    // gradeDictationAnswer called; evaluateAnswer NOT called
    expect(mockGradeDictationAnswer).toHaveBeenCalledTimes(1);
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();

    // userExerciseHistory row (2nd insert) must carry score 0.9
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        exerciseId: 'dict-001',
        score: 0.9,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // sessionId-bound submission paths (Req 5.4, 5.5)
  // -------------------------------------------------------------------------

  const validSessionId = '11111111-1111-1111-1111-111111111111';

  it('writes sessionId into history when a valid session is provided', async () => {
    // exercise fetch → session fetch → usage count
    mockLimit
      .mockResolvedValueOnce([sampleExercise])
      .mockResolvedValueOnce([
        { userId: 'user_123', completedAt: null, exerciseIds: ['abc-123'] },
      ]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 5 }] as never);
    mockEvaluateAnswer.mockResolvedValueOnce(sampleEvaluation);

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'I went to the store', sessionId: validSessionId }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    // Insert order: 1) auth user upsert, 2) userExerciseHistory, 3) usageEvents
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        exerciseId: 'abc-123',
        sessionId: validSessionId,
      }),
    );
  });

  it('returns 400 INVALID_SESSION when sessionId belongs to another user', async () => {
    mockLimit
      .mockResolvedValueOnce([sampleExercise])
      .mockResolvedValueOnce([
        { userId: 'user_999', completedAt: null, exerciseIds: ['abc-123'] },
      ]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'foo', sessionId: validSessionId }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
    // Only the auth middleware user upsert — no history/usage inserts
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 400 INVALID_SESSION when session is already completed', async () => {
    mockLimit
      .mockResolvedValueOnce([sampleExercise])
      .mockResolvedValueOnce([
        { userId: 'user_123', completedAt: new Date(), exerciseIds: ['abc-123'] },
      ]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'foo', sessionId: validSessionId }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_SESSION when exercise is not in the session manifest', async () => {
    mockLimit
      .mockResolvedValueOnce([sampleExercise])
      .mockResolvedValueOnce([
        { userId: 'user_123', completedAt: null, exerciseIds: ['other-exercise-id'] },
      ]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'foo', sessionId: validSessionId }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_SESSION when sessionId does not exist', async () => {
    mockLimit
      .mockResolvedValueOnce([sampleExercise])
      .mockResolvedValueOnce([]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'foo', sessionId: validSessionId }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('INVALID_SESSION');
  });
});

// ---------------------------------------------------------------------------
// review_status filter — Requirement 3.6
// ---------------------------------------------------------------------------
//
// These tests verify that each pool-touching route invokes
// `approvedStatusFilter(exercisesTable)` so that flagged and rejected rows
// cannot reach users via pool-discovery or direct-fetch endpoints. The
// helper is mocked here; the SQL-level behaviour (partial-index hit,
// 'auto-approved' / 'manual-approved' predicate, exclusion of flagged
// rows from the underlying table) is verified end-to-end against a Neon
// dev branch in Task 19's manual EXPLAIN step.

describe('review_status filter', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const approvedExercise = {
    id: 'approved-id',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store' },
    audioS3Key: null,
    createdAt: new Date(),
    reviewStatus: 'auto-approved',
  };

  const flaggedFixtureId = 'flagged-uuid';
  const rejectedFixtureId = 'rejected-uuid';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  // -- GET /exercises (random pool draw) -----------------------------------

  it('GET /exercises composes the review_status filter into the pool query', async () => {
    mockLimit.mockResolvedValueOnce([approvedExercise]);

    const res = await app.request('/exercises?language=EN&difficulty=B1', undefined, authEnv);

    expect(res.status).toBe(200);
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
    expect(mockApprovedStatusFilter).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'review_status' }),
    );
  });

  it('GET /exercises 100 random draws never surface flagged or rejected fixtures', async () => {
    // Simulate the SQL filter excluding both fixtures from the cell — every
    // draw has only the approved fixture available. If the filter regresses,
    // this loop is the canary because mockLimit captures whatever the route
    // actually queried for.
    for (let i = 0; i < 100; i++) {
      mockLimit.mockResolvedValueOnce([approvedExercise]);
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = await app.request('/exercises?language=EN&difficulty=B1', undefined, authEnv);
      expect(res.status).toBe(200);
      const body = await res.json() as AnyJson;
      seenIds.add(body.id);
    }

    expect(seenIds).not.toContain(flaggedFixtureId);
    expect(seenIds).not.toContain(rejectedFixtureId);
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(100);
  });

  // -- GET /exercises/:id (direct fetch) -----------------------------------

  it('GET /exercises/:id composes the review_status filter into the lookup', async () => {
    mockLimit.mockResolvedValueOnce([approvedExercise]);

    const res = await app.request(`/exercises/${approvedExercise.id}`, undefined, authEnv);

    expect(res.status).toBe(200);
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
    expect(mockApprovedStatusFilter).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'review_status' }),
    );
  });

  it('GET /exercises/:id returns 404 for a flagged exercise UUID', async () => {
    // SQL filter excludes the flagged row → empty result reaches the route.
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(`/exercises/${flaggedFixtureId}`, undefined, authEnv);

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
  });

  it('GET /exercises/:id returns 404 for a rejected exercise UUID', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(`/exercises/${rejectedFixtureId}`, undefined, authEnv);

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
  });

  // -- POST /exercises/:id/submit (exercise lookup) ------------------------

  it('POST /exercises/:id/submit composes the review_status filter into the lookup', async () => {
    mockLimit.mockResolvedValueOnce([approvedExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
    mockEvaluateAnswer.mockResolvedValueOnce({
      score: 0.8,
      grammarAccuracy: 0.8,
      vocabularyRange: 'B1',
      taskAchievement: 0.8,
      feedback: 'ok',
      errors: [],
      estimatedCefrEvidence: 'B1',
    });

    const res = await app.request(
      `/exercises/${approvedExercise.id}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'something' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
    expect(mockApprovedStatusFilter).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'review_status' }),
    );
  });

  it('POST /exercises/:id/submit returns 404 for a flagged exercise UUID', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      `/exercises/${flaggedFixtureId}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'something' }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    const body = await res.json() as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
    expect(mockApprovedStatusFilter).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// audio-ready filter (Task 9b) — never serve an audioless dictation row
// ---------------------------------------------------------------------------
//
// Generated dictation text rows are approved before PR-2's audio-synth Lambda
// attaches audio (`audio_s3_key IS NULL`). The serve paths must hide those
// transient, unplayable rows. As with the review_status filter above, the SQL
// behaviour is verified end-to-end elsewhere; here we assert the route composes
// `audioReadyFilter(exercisesTable)` into every serve query and that, when the
// filter excludes the null-audio row, only the audio-ready row is ever served.
describe('audio-ready filter', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const audioReadyDictation = {
    id: 'dictation-with-audio',
    type: 'dictation',
    language: 'ES',
    difficulty: 'B1',
    contentJson: { referenceText: 'No te preocupes.', sentences: ['No te preocupes.'] },
    audioS3Key: 'dictation/es/b1/ready.mp3',
    createdAt: new Date(),
    reviewStatus: 'auto-approved',
  };

  const audiolessDictationId = 'dictation-null-audio';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  // -- GET /exercises (random pool draw) -----------------------------------

  it('GET /exercises composes the audio-ready filter into the pool query', async () => {
    mockLimit.mockResolvedValueOnce([audioReadyDictation]);

    const res = await app.request(
      '/exercises?language=ES&difficulty=B1&type=dictation',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(mockAudioReadyFilter).toHaveBeenCalledTimes(1);
    expect(mockAudioReadyFilter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'type', audioS3Key: 'audio_s3_key' }),
    );
  });

  it('GET /exercises 100 dictation draws never surface the null-audio row', async () => {
    // Simulate the SQL filter excluding the audioless dictation row from the
    // cell — every draw can only return the audio-ready fixture. If the gate
    // regresses, this loop is the canary because mockLimit captures whatever
    // the route actually queried for.
    for (let i = 0; i < 100; i++) {
      mockLimit.mockResolvedValueOnce([audioReadyDictation]);
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = await app.request(
        '/exercises?language=ES&difficulty=B1&type=dictation',
        undefined,
        authEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnyJson;
      seenIds.add(body.id);
    }

    expect(seenIds).toEqual(new Set([audioReadyDictation.id]));
    expect(seenIds).not.toContain(audiolessDictationId);
    expect(mockAudioReadyFilter).toHaveBeenCalledTimes(100);
  });

  // -- GET /exercises/:id (direct fetch) -----------------------------------

  it('GET /exercises/:id composes the audio-ready filter into the lookup', async () => {
    mockLimit.mockResolvedValueOnce([audioReadyDictation]);

    const res = await app.request(`/exercises/${audioReadyDictation.id}`, undefined, authEnv);

    expect(res.status).toBe(200);
    expect(mockAudioReadyFilter).toHaveBeenCalledTimes(1);
    expect(mockAudioReadyFilter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'type', audioS3Key: 'audio_s3_key' }),
    );
  });

  it('GET /exercises/:id returns 404 for an audioless dictation UUID', async () => {
    // SQL filter excludes the null-audio dictation row → empty result reaches
    // the route, which 404s.
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(`/exercises/${audiolessDictationId}`, undefined, authEnv);

    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('EXERCISE_NOT_FOUND');
    expect(mockAudioReadyFilter).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — observability swap + submissionId contract
// ---------------------------------------------------------------------------
//
// Task 12 (langfuse-implementation-phase-1): the route was changed to mint
// a `submissionId` UUID before the Claude call, wrap `evaluateAnswer` in
// `withLlmTrace`, and use the same UUID as both the trace tag AND the
// `userExerciseHistory.id` on insert. These tests lock in:
//   (a) no-op when LANGFUSE_PUBLIC_KEY is unset — response and DB row are
//       indistinguishable from the pre-spec route.
//   (b) the inserted history row id equals the route's minted submissionId
//       (verified by stubbing `randomUUID`).
//   (c) when Langfuse env is set, the trace context handed to
//       `withLlmTrace` carries `feature='evaluate'` and a `submissionId`
//       that matches the inserted row id — i.e. the Proxy will tag the
//       Langfuse generation accordingly. The Proxy → tag/metadata mapping
//       itself is exercised by `packages/ai/src/observability.test.ts`.

describe('POST /exercises/:id/submit — observability', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
        requestId: 'req-abc-123',
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
    // `vi.clearAllMocks()` clears call records but preserves mock
    // implementations set via `vi.fn(impl)`. Re-pin the defaults for the
    // two spies we control so the tests are order-independent.
    mockWithLlmTrace.mockImplementation(
      <T>(_ctx: unknown, fn: () => T | Promise<T>) => Promise.resolve(fn()),
    );
    mockRandomUUID.mockImplementation(() => '00000000-0000-0000-0000-000000000000');
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) LANGFUSE_PUBLIC_KEY unset: inserts history row and returns the evaluation byte-identical to the pre-spec response', async () => {
    // Defensive: vitest does not load Langfuse env vars by default, but
    // an earlier test could have leaked. Force the no-op path explicitly.
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '');
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');

    mockLimit.mockResolvedValueOnce([sampleExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
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
    const body = await res.json();
    // Byte-identical to the pre-spec response: just `result` from
    // `evaluateAnswer`, no observability-added fields.
    expect(body).toEqual(sampleEvaluation);

    // Three inserts: auth user upsert (1), userExerciseHistory (2),
    // usageEvents (3). Identical to pre-spec.
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        exerciseId: 'abc-123',
        userId: 'user_123',
        score: 0.85,
        responseJson: {
          userAnswer: 'I went to the store',
          evaluation: sampleEvaluation,
        },
      }),
    );
  });

  it('(b) userExerciseHistory.id equals the route-minted submissionId (stubbed randomUUID)', async () => {
    const stubbedId = '11111111-2222-3333-4444-555555555555';
    mockRandomUUID.mockReturnValueOnce(stubbedId);

    mockLimit.mockResolvedValueOnce([sampleExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
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
    // The 2nd insert is the userExerciseHistory row. Its `id` MUST equal
    // the route's `submissionId` so the DB row and the Langfuse trace are
    // 1:1 (Req 2 AC 7, design.md Open Question 1).
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: stubbedId,
        exerciseId: 'abc-123',
      }),
    );
  });

  it('(c) Langfuse env set: trace context carries feature=evaluate and submissionId matching the inserted row id', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');
    const stubbedId = '99999999-8888-7777-6666-555555555555';
    mockRandomUUID.mockReturnValueOnce(stubbedId);

    mockLimit.mockResolvedValueOnce([sampleExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
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

    // Exactly one trace per submission. The Anthropic Proxy emits one
    // Langfuse generation inside this ALS scope — that mapping is verified
    // by `packages/ai/src/observability.test.ts` (Task 8 success-path test).
    expect(mockWithLlmTrace).toHaveBeenCalledTimes(1);
    const ctx = mockWithLlmTrace.mock.calls[0]![0] as {
      feature: string;
      submissionId: string;
      userId: string;
      language: string;
      cefrLevel: string;
      exerciseType: string;
      promptVersion: string;
      requestId: string;
      env: string;
    };
    expect(ctx.feature).toBe('evaluate');
    expect(ctx.submissionId).toBe(stubbedId);
    expect(ctx.userId).toBe('user_123');
    expect(ctx.language).toBe('EN');
    expect(ctx.cefrLevel).toBe('B1');
    expect(ctx.exerciseType).toBe('cloze');
    expect(ctx.promptVersion).toBe('evaluate@test');
    expect(ctx.requestId).toBe('req-abc-123');

    // The inserted row id must equal the trace's submissionId (Req 2 AC 7).
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: stubbedId }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — mastery upsert (Task 9)
// ---------------------------------------------------------------------------

describe('POST /exercises/:id/submit — mastery upsert', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const exerciseWithGrammarKey = {
    id: 'abc-123',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store', options: ['go', 'went', 'gone'] },
    audioS3Key: null,
    createdAt: new Date(),
    grammarPointKey: 'en-b1-past-simple',
  };

  const exerciseWithoutGrammarKey = {
    id: 'abc-456',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    contentJson: { sentence: 'I ___ to the store', options: ['go', 'went', 'gone'] },
    audioS3Key: null,
    createdAt: new Date(),
    grammarPointKey: null,
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

  it('returns 200 and attempts mastery upsert when grammarPointKey is present', async () => {
    // Exercise fetch → mastery read (first-observation, returns [])
    mockLimit
      .mockResolvedValueOnce([exerciseWithGrammarKey]) // exercise fetch
      .mockResolvedValueOnce([]); // mastery select → no prior row
    // mockWhere: exercise fetch where chain, then usage count (resolved directly), then mastery where chain
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })) // exercise fetch
      .mockResolvedValueOnce([{ count: 0 }] as never) // usage count
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })); // mastery read
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

    // 4 inserts: auth upsert + history + usageEvents + mastery
    expect(mockInsert).toHaveBeenCalledTimes(4);
    // The mastery insert is the 4th values call and must use onConflictDoUpdate
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    // Mastery values should include userId, grammarPointKey, language
    expect(mockValues).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        userId: 'user_123',
        grammarPointKey: 'en-b1-past-simple',
        language: 'EN',
      }),
    );
  });

  it('returns 200 and does NOT attempt mastery upsert when grammarPointKey is null', async () => {
    mockLimit.mockResolvedValueOnce([exerciseWithoutGrammarKey]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })) // exercise fetch
      .mockResolvedValueOnce([{ count: 0 }] as never); // usage count
    mockEvaluateAnswer.mockResolvedValueOnce(sampleEvaluation);

    const res = await app.request(
      '/exercises/abc-456/submit',
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

    // 3 inserts only: auth upsert + history + usageEvents (no mastery)
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('still returns 200 even if mastery upsert throws (best-effort)', async () => {
    mockLimit
      .mockResolvedValueOnce([exerciseWithGrammarKey]) // exercise fetch
      .mockResolvedValueOnce([]); // mastery select
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })) // exercise fetch
      .mockResolvedValueOnce([{ count: 0 }] as never) // usage count
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit })); // mastery read
    mockEvaluateAnswer.mockResolvedValueOnce(sampleEvaluation);
    // Simulate mastery insert failure
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('DB constraint error'));

    const res = await app.request(
      '/exercises/abc-123/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'I went to the store' }),
      },
      authEnv,
    );

    // Submission must still succeed despite mastery failure
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — free_writing exercises route to evaluateFreeWriting
// ---------------------------------------------------------------------------

describe('POST /exercises/:id/submit — free_writing branch', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
        requestId: 'req-fw-001',
      },
    },
  };

  const freeWritingExercise = {
    id: 'fw-exercise-001',
    type: 'free_writing',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: {
      type: 'free_writing',
      title: 'Una carta formal',
      task: 'Escribe una carta formal solicitando información sobre un curso.',
      domain: 'academic',
      register: 'formal',
      minWords: 80,
      maxWords: 150,
      requiredElements: [],
      instructions: 'Usa un saludo y una despedida formales.',
    },
    audioS3Key: null,
    createdAt: new Date(),
  };

  const freeWritingEvaluation = {
    overallScore: 0.8,
    overallCefr: 'B1',
    headline: 'A solid formal letter with minor grammar slips.',
    summary: 'The letter addresses the task well. Grammar is mostly accurate.',
    criteria: [
      { id: 'task', label: 'Task Achievement', score: 0.8, cefr: 'B1', note: 'Good.' },
      { id: 'coherence', label: 'Coherence & Cohesion', score: 0.75, cefr: 'B1', note: 'Mostly clear.' },
      { id: 'lexis', label: 'Lexical Resource', score: 0.8, cefr: 'B1', note: 'Appropriate vocabulary.' },
      { id: 'grammar', label: 'Grammatical Range', score: 0.85, cefr: 'B1', note: 'Minor errors only.' },
    ],
    errors: [],
    goodSpans: [],
    improved: { text: 'Estimada señora, me dirijo a usted para solicitar información sobre el curso.' },
    wordCount: 95,
    improvedWordCount: 98,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWithLlmTrace.mockImplementation(
      <T>(_ctx: unknown, fn: () => T | Promise<T>) => Promise.resolve(fn()),
    );
    mockRandomUUID.mockImplementation(() => '00000000-0000-0000-0000-000000000000');
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes free_writing to evaluateFreeWriting, stores overallScore, and returns the rich evaluation', async () => {
    mockLimit.mockResolvedValueOnce([freeWritingExercise]);
    mockWhere
      .mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
      .mockResolvedValueOnce([{ count: 0 }] as never);
    mockEvaluateFreeWriting.mockResolvedValueOnce(freeWritingEvaluation);

    const res = await app.request(
      '/exercises/fw-exercise-001/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'Mi texto suficientemente largo.' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;

    // Response must be the rich FreeWritingEvaluation
    expect(body.overallScore).toBe(0.8);

    // evaluateFreeWriting called once; evaluateAnswer NOT called
    expect(mockEvaluateFreeWriting).toHaveBeenCalledTimes(1);
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();

    // userExerciseHistory insert (2nd values call, after auth upsert) must
    // store overallScore as `score` and the full evaluation in responseJson.
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        score: 0.8,
        responseJson: expect.objectContaining({
          evaluation: freeWritingEvaluation,
        }),
      }),
    );

    // usageEvents insert must meter ai_evaluation (3rd values call)
    expect(mockValues).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ eventType: 'ai_evaluation' }),
    );
  });
});
