import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';
import { adminLabeling, extractReferenceAnswers, safeSeed } from './admin-labeling';

// ---------------------------------------------------------------------------
// DB chain mock (copied verbatim from exercise-flags.test.ts, itself copied
// from admin.test.ts:1-133 — the established pattern in this package)
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

vi.mock('../db', () => ({
  db: {
    select: () => makeChain(),
    insert: () => makeChain(),
    update: () => makeChain(),
    transaction: async (fn: (tx: unknown) => unknown) => fn({ update: () => makeChain() }),
    execute: () => Promise.resolve({ rows: queryQueue.shift() ?? [] }),
  },
}));

vi.mock('@language-drill/db', async () => {
  const actual =
    await vi.importActual<typeof import('@language-drill/db')>('@language-drill/db');
  return {
    ...actual,
    exercises: { __mock: 'exercises' },
    userExerciseHistory: { __mock: 'userExerciseHistory' },
    submissionLabels: { __mock: 'submissionLabels' },
  };
});

// ---------------------------------------------------------------------------
// Admin fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin_user_001';
const previousAdminUserIds = process.env.ADMIN_USER_IDS;

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  process.env.ADMIN_USER_IDS = ADMIN_ID;
});

afterEach(() => {
  if (previousAdminUserIds === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = previousAdminUserIds;
  }
});

// ---------------------------------------------------------------------------
// Test harness — build a Hono app, stamp `userId` via middleware ahead of the
// router (standing in for authMiddleware, which is inherited from admin.ts
// in production), apply the admin gate directly (also inherited in
// production), then mount `adminLabeling` on its own.
// ---------------------------------------------------------------------------

async function request(path: string, opts: { userId: string }) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('userId', opts.userId);
    await next();
  });
  app.use('/admin/*', adminMiddleware);
  app.route('/', adminLabeling);
  return app.request(path);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('safeSeed', () => {
  it('falls back to the date when no seed is given, so a queue is resumable', () => {
    expect(safeSeed(undefined, new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
  });

  it('accepts a simple explicit seed', () => {
    expect(safeSeed('pass2', new Date('2026-09-29T10:00:00Z'))).toBe('pass2');
  });

  it('rejects anything that could reach SQL, since the seed is inlined', () => {
    expect(safeSeed("x'; drop table submission_labels; --", new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
    expect(safeSeed('a'.repeat(64), new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
  });
});

describe('extractReferenceAnswers', () => {
  it('pulls the cloze answer and its accepted variants', () => {
    expect(
      extractReferenceAnswers({ type: 'cloze', correctAnswer: 'fui', acceptableAnswers: ['me fui'] }),
    ).toEqual({ correctAnswer: 'fui', acceptableAnswers: ['me fui'] });
  });

  it('pulls the translation reference', () => {
    expect(
      extractReferenceAnswers({ type: 'translation', referenceTranslation: 'Fui al mercado.' }),
    ).toEqual({ referenceTranslation: 'Fui al mercado.' });
  });

  it('returns an empty object for unknown content rather than throwing', () => {
    expect(extractReferenceAnswers(null)).toEqual({});
    expect(extractReferenceAnswers({ type: 'mystery' })).toEqual({});
  });
});

type QueueResponse = {
  items: Array<Record<string, unknown>>;
  remaining: number;
};

describe('GET /admin/labeling/queue', () => {
  beforeEach(() => {
    queryQueue.length = 0;
  });

  const row = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    exerciseId: '22222222-2222-4222-8222-222222222222',
    language: 'ES',
    cefrLevel: 'B1',
    exerciseType: 'cloze',
    grammarPointKey: 'es.b1.preterite-vs-imperfect',
    contentJson: { type: 'cloze', instructions: 'Fill the blank', sentence: 'Ayer ___ al mercado.', correctAnswer: 'fui' },
    responseJson: { userAnswer: 'iba', evaluation: { score: 0.4, feedback: 'iba is imperfect', errors: [] } },
    score: 0.4,
    evaluatedAt: new Date('2026-09-20T12:00:00Z'),
  };

  it('403s for a non-admin', async () => {
    const res = await request('/admin/labeling/queue?stratum=random', { userId: 'user_nobody' });
    expect(res.status).toBe(403);
  });

  it('400s on an unknown stratum', async () => {
    const res = await request('/admin/labeling/queue?stratum=everything', { userId: ADMIN_ID });
    expect(res.status).toBe(400);
  });

  it('renders the learner view server-side and returns the evaluation', async () => {
    queryQueue.push([row], [{ count: 42 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    expect(res.status).toBe(200);
    const body = (await res.json()) as QueueResponse;
    expect(body.remaining).toBe(42);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.learnerView).toContain('Ayer ___ al mercado.');
    expect(item.learnerView).not.toContain('fui');
    expect(item.referenceAnswers).toEqual({ correctAnswer: 'fui' });
    expect(item.userAnswer).toBe('iba');
    expect(item.evaluation).toEqual(row.responseJson.evaluation);
    expect(item.exerciseType).toBe('cloze');
  });

  it('shows cloze options only when the learner actually revealed them', async () => {
    const withOptions = {
      ...row,
      contentJson: { ...row.contentJson, options: ['fui', 'iba'] },
      responseJson: { ...row.responseJson, optionsRevealed: true },
    };
    queryQueue.push([withOptions], [{ count: 1 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    const item = ((await res.json()) as QueueResponse).items[0];
    expect(item.optionsRevealed).toBe(true);
    expect(item.learnerView).toContain('Options:');
  });

  it('omits an item whose content type renderLearnerView cannot render, rather than 500ing', async () => {
    queryQueue.push([{ ...row, exerciseType: 'dictation', contentJson: { type: 'dictation' } }], [{ count: 1 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    expect(res.status).toBe(200);
    expect(((await res.json()) as QueueResponse).items).toHaveLength(0);
  });

  it('accepts the targeted stratum with filters', async () => {
    queryQueue.push([row], [{ count: 3 }]);
    const res = await request(
      '/admin/labeling/queue?stratum=targeted&language=ES&type=cloze&nearBoundary=true',
      { userId: ADMIN_ID },
    );
    expect(res.status).toBe(200);
  });
});
