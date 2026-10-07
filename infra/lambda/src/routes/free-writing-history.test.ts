import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// DB chain mock — each awaited query shifts the next canned result. The chain
// records its `.where()` / `.limit()` arguments so the tests can assert the
// ownership and type filters, which the canned rows alone cannot prove.
// ---------------------------------------------------------------------------

const queryQueue: unknown[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whereCalls: any[] = [];
const limitCalls: number[] = [];

function makeChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn((cond: unknown) => {
      whereCalls.push(cond);
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn((n: number) => {
      limitCalls.push(n);
      return chain;
    }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(queryQueue.shift() ?? []).then(resolve, reject),
  };
  return chain;
}

vi.mock('../db', () => ({ db: { select: () => makeChain() } }));

// Condition builders become inspectable descriptors.
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
    lt: (col: unknown, val: unknown) => ({ op: 'lt', col, val }),
    and: (...conds: unknown[]) => ({ op: 'and', conds }),
    desc: (col: unknown) => ({ op: 'desc', col }),
  };
});

vi.mock('@language-drill/db', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/db')>('@language-drill/db');
  return {
    ...actual,
    exercises: {
      id: 'exercises.id',
      type: 'exercises.type',
      language: 'exercises.language',
      difficulty: 'exercises.difficulty',
      contentJson: 'exercises.contentJson',
    },
    userExerciseHistory: {
      id: 'history.id',
      userId: 'history.userId',
      exerciseId: 'history.exerciseId',
      evaluatedAt: 'history.evaluatedAt',
      score: 'history.score',
      responseJson: 'history.responseJson',
    },
  };
});

const userEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } } };

const SUBMISSION_ID = '22222222-2222-2222-2222-222222222222';
const EXERCISE_ID = '11111111-1111-1111-1111-111111111111';

const evaluation = {
  overallScore: 0.72,
  overallCefr: 'B1',
  headline: 'Clear argument, shaky agreement',
  summary: 'Good structure.',
  criteria: [],
  errors: [],
  goodSpans: [],
  improved: { text: 'Mejorado.' },
  wordCount: 182,
  improvedWordCount: 190,
};

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION_ID,
    exerciseId: EXERCISE_ID,
    evaluatedAt: new Date('2026-10-01T10:00:00.000Z'),
    score: 0.72,
    responseJson: { userAnswer: 'Mi ensayo.', evaluation },
    language: 'ES',
    difficulty: 'B1',
    contentJson: { type: 'free_writing', title: 'El teletrabajo', task: 'Escribe…' },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatConds(where: any): any[] {
  return where?.op === 'and' ? where.conds : [where];
}

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  whereCalls.length = 0;
  limitCalls.length = 0;
  const mod = await import('./free-writing-history');
  app = new Hono();
  app.route('/', mod.default);
});

describe('GET /free-writing/history', () => {
  it('lists the caller\'s free-writing attempts as summaries', async () => {
    queryQueue.push([historyRow()]);
    const res = await app.request('/free-writing/history?language=ES', {}, userEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          id: SUBMISSION_ID,
          exerciseId: EXERCISE_ID,
          evaluatedAt: '2026-10-01T10:00:00.000Z',
          language: 'ES',
          difficulty: 'B1',
          title: 'El teletrabajo',
          score: 0.72,
          overallCefr: 'B1',
          headline: 'Clear argument, shaky agreement',
          wordCount: 182,
        },
      ],
      nextCursor: null,
    });
  });

  it('scopes the query to the caller, free writing and the requested language', async () => {
    queryQueue.push([]);
    await app.request('/free-writing/history?language=DE', {}, userEnv);
    const conds = flatConds(whereCalls[0]);
    expect(conds).toContainEqual({ op: 'eq', col: 'history.userId', val: 'user_1' });
    expect(conds).toContainEqual({ op: 'eq', col: 'exercises.type', val: 'free_writing' });
    expect(conds).toContainEqual({ op: 'eq', col: 'exercises.language', val: 'DE' });
  });

  it('omits the language filter when none is given', async () => {
    queryQueue.push([]);
    await app.request('/free-writing/history', {}, userEnv);
    const conds = flatConds(whereCalls[0]);
    expect(conds.some((c) => c.col === 'exercises.language')).toBe(false);
  });

  it('returns a cursor when the page is full and filters by it on the next page', async () => {
    queryQueue.push([
      historyRow({ id: 'a', evaluatedAt: new Date('2026-10-02T00:00:00.000Z') }),
      historyRow({ id: 'b', evaluatedAt: new Date('2026-10-01T00:00:00.000Z') }),
    ]);
    const res = await app.request('/free-writing/history?limit=2', {}, userEnv);
    const body = (await res.json()) as { nextCursor: string | null };
    expect(limitCalls[0]).toBe(2);
    expect(body.nextCursor).toBe('2026-10-01T00:00:00.000Z');

    queryQueue.push([]);
    await app.request(`/free-writing/history?limit=2&cursor=${body.nextCursor}`, {}, userEnv);
    const conds = flatConds(whereCalls[1]);
    expect(conds).toContainEqual({
      op: 'lt',
      col: 'history.evaluatedAt',
      val: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('tolerates rows whose stored evaluation is missing or malformed', async () => {
    queryQueue.push([historyRow({ responseJson: { userAnswer: 'x', evaluation: 'garbage' }, contentJson: null })]);
    const res = await app.request('/free-writing/history', {}, userEnv);
    expect(res.status).toBe(200);
    const [item] = ((await res.json()) as { items: unknown[] }).items;
    expect(item).toMatchObject({ title: null, overallCefr: null, headline: null, wordCount: null });
  });

  it('400s on an invalid query', async () => {
    const bad = ['language=XX', 'limit=0', 'limit=1000', 'cursor=yesterday'];
    for (const q of bad) {
      const res = await app.request(`/free-writing/history?${q}`, {}, userEnv);
      expect(res.status, q).toBe(400);
    }
  });
});

describe('GET /free-writing/history/:submissionId', () => {
  it('returns the stored essay, evaluation and prompt', async () => {
    queryQueue.push([historyRow()]);
    const res = await app.request(`/free-writing/history/${SUBMISSION_ID}`, {}, userEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: SUBMISSION_ID,
      exerciseId: EXERCISE_ID,
      evaluatedAt: '2026-10-01T10:00:00.000Z',
      language: 'ES',
      difficulty: 'B1',
      content: { type: 'free_writing', title: 'El teletrabajo', task: 'Escribe…' },
      userAnswer: 'Mi ensayo.',
      evaluation,
    });
  });

  it('only looks up the attempt among the caller\'s own free-writing rows', async () => {
    queryQueue.push([historyRow()]);
    await app.request(`/free-writing/history/${SUBMISSION_ID}`, {}, userEnv);
    const conds = flatConds(whereCalls[0]);
    expect(conds).toContainEqual({ op: 'eq', col: 'history.id', val: SUBMISSION_ID });
    expect(conds).toContainEqual({ op: 'eq', col: 'history.userId', val: 'user_1' });
    expect(conds).toContainEqual({ op: 'eq', col: 'exercises.type', val: 'free_writing' });
  });

  it('404s when the attempt is not found for this user', async () => {
    queryQueue.push([]);
    const res = await app.request(`/free-writing/history/${SUBMISSION_ID}`, {}, userEnv);
    expect(res.status).toBe(404);
  });

  it('404s on a non-uuid id without querying', async () => {
    const res = await app.request('/free-writing/history/not-a-uuid', {}, userEnv);
    expect(res.status).toBe(404);
    expect(whereCalls).toHaveLength(0);
  });

  it('returns null fields for a row with no stored answer or evaluation', async () => {
    queryQueue.push([historyRow({ responseJson: null })]);
    const res = await app.request(`/free-writing/history/${SUBMISSION_ID}`, {}, userEnv);
    const body = (await res.json()) as { userAnswer: unknown; evaluation: unknown };
    expect(body.userAnswer).toBeNull();
    expect(body.evaluation).toBeNull();
  });
});
