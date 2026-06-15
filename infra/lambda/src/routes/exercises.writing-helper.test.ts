import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// The route issues, in order, on the success path:
//   db.select().from(exercises).where().limit()        (exercise lookup)
//   db.select({count}).from(usageEvents).where()       (24h usage count)
//   db.insert(usageEvents).values()                    (meter)
// Distinguish the two selects by call order via mockLimit / mockWhere.

let exerciseRow: Record<string, unknown> | undefined;
let usageCount = 0;

const mockLimit = vi.fn(() => Promise.resolve(exerciseRow ? [exerciseRow] : []));
const mockWhere = vi.fn(() => {
  const p = Promise.resolve([{ count: usageCount }]) as Promise<unknown> & { limit: typeof mockLimit };
  p.limit = mockLimit;
  return p;
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn((..._a: unknown[]) => ({ from: mockFrom }));

const insertValuesCalls: Array<Record<string, unknown>> = [];
const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn((row: Record<string, unknown>) => {
  insertValuesCalls.push(row);
  const p = Promise.resolve() as Promise<void> & { onConflictDoNothing: typeof mockOnConflictDoNothing };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: () => mockInsert(),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: { id: 'id', language: 'language', difficulty: 'difficulty', type: 'type', status: 'status', grammarPointKey: 'grammar_point_key' },
  usageEvents: { userId: 'user_id', eventType: 'event_type', createdAt: 'created_at', metadata: 'metadata' },
  practiceSessions: {},
  userExerciseHistory: {},
  userGrammarMastery: {},
  getGrammarPoint: vi.fn(() => undefined),
  updateMastery: vi.fn(),
}));

const mockGenerateBrainstorm = vi.fn();
const mockGenerateVocabBoost = vi.fn();
vi.mock('@language-drill/ai', () => ({
  createObservedClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: vi.fn(),
  gradeDictationAnswer: vi.fn(),
  evaluateFreeWriting: vi.fn(),
  generateBrainstorm: (...a: unknown[]) => mockGenerateBrainstorm(...a),
  generateVocabBoost: (...a: unknown[]) => mockGenerateVocabBoost(...a),
  withLlmTrace: (_meta: unknown, fn: () => unknown) => fn(),
  EVALUATION_SYSTEM_PROMPT_VERSION: 'v',
  DICTATION_EVAL_PROMPT_VERSION: 'v',
  FREE_WRITING_EVAL_PROMPT_VERSION: 'v',
  BRAINSTORM_PROMPT_VERSION: 'free-writing-brainstorm@2026-06-15',
  VOCAB_BOOST_PROMPT_VERSION: 'free-writing-vocab-boost@2026-06-15',
  EVAL_REQUEST_TIMEOUT_MS: 1000,
  EVAL_MAX_RETRIES: 1,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS: 1000,
  FREE_WRITING_EVAL_MAX_RETRIES: 1,
  WRITING_HELPER_REQUEST_TIMEOUT_MS: 1000,
  WRITING_HELPER_MAX_RETRIES: 1,
}));

vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(() => Promise.resolve('free')),
  isAdmin: vi.fn(() => false),
}));

let capacityVerdict: 'ok' | 'killed' | 'capped' = 'ok';
const mockCheckGlobalCapacity = vi.fn(() => Promise.resolve(capacityVerdict));
vi.mock('../usage/global-capacity', () => ({
  checkGlobalCapacity: () => mockCheckGlobalCapacity(),
}));

vi.mock('../lib/exercise-filters', () => ({
  approvedStatusFilter: () => undefined,
  freshFirstOrderBy: () => undefined,
}));

const authEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_123' } } } } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

const FW_ROW = {
  id: 'fw-1',
  language: 'ES',
  difficulty: 'B1',
  type: 'free_writing',
  contentJson: {
    type: 'free_writing',
    instructions: 'i', title: 'T', task: 'task', domain: 'd',
    register: 'formal', minWords: 150, maxWords: 200, requiredElements: [],
  },
};

function post(app: Hono, path: string) {
  return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, authEnv);
}

describe('POST /exercises/:id/brainstorm', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    exerciseRow = FW_ROW;
    usageCount = 0;
    capacityVerdict = 'ok';
    insertValuesCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('success → 200, returns groups, meters one writing_helper event', async () => {
    mockGenerateBrainstorm.mockResolvedValue({ groups: [{ label: 'Angle', points: ['idea'] }] });
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ groups: [{ label: 'Angle', points: ['idea'] }] });
    expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    const writingHelperEvents = insertValuesCalls.filter((r) => r.eventType === 'writing_helper');
    expect(writingHelperEvents).toHaveLength(1);
    expect(writingHelperEvents[0]).toMatchObject({ userId: 'user_123', eventType: 'writing_helper' });
  });

  it('non-free-writing exercise → 400 BAD_EXERCISE_TYPE, no AI, no meter', async () => {
    exerciseRow = { ...FW_ROW, type: 'cloze', contentJson: { type: 'cloze' } };
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('BAD_EXERCISE_TYPE');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });

  it('missing exercise → 404, no AI', async () => {
    exerciseRow = undefined;
    const res = await post(app, '/exercises/none/brainstorm');
    expect(res.status).toBe(404);
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
  });

  it('global brake → 503 GLOBAL_CAPACITY, no AI, no meter', async () => {
    capacityVerdict = 'killed';
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(503);
    expect(((await res.json()) as AnyJson).code).toBe('GLOBAL_CAPACITY');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });

  it('daily cap reached → 429 RATE_LIMIT_EXCEEDED, no AI', async () => {
    usageCount = 50; // free writing_helper limit
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(429);
    expect(((await res.json()) as AnyJson).code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
  });

  it('generator throws → 502 AI_UNAVAILABLE, no meter', async () => {
    mockGenerateBrainstorm.mockRejectedValue(new Error('claude exploded'));
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(502);
    expect(((await res.json()) as AnyJson).code).toBe('AI_UNAVAILABLE');
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });

  it('missing ANTHROPIC_API_KEY → 502 AI_UNAVAILABLE, no AI call, no meter', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const mod = await import('./exercises');
    const freshApp = new Hono();
    freshApp.route('/', mod.default);
    const res = await post(freshApp, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(502);
    expect(((await res.json()) as AnyJson).code).toBe('AI_UNAVAILABLE');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });
});

describe('POST /exercises/:id/vocab-boost', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    exerciseRow = FW_ROW;
    usageCount = 0;
    capacityVerdict = 'ok';
    insertValuesCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('success → 200, returns items, meters one writing_helper event', async () => {
    mockGenerateVocabBoost.mockResolvedValue({ items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] });
    const res = await post(app, '/exercises/fw-1/vocab-boost');
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] });
    const writingHelperEvents = insertValuesCalls.filter((r) => r.eventType === 'writing_helper');
    expect(writingHelperEvents).toHaveLength(1);
    expect(writingHelperEvents[0]).toMatchObject({ eventType: 'writing_helper' });
  });
});
