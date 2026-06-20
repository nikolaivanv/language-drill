import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { CefrLevel, ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
//
// The progress route's only DB chain is:
//   db.select(...).from(...).innerJoin(...).where(...)
// resolving to an array of row objects. We capture the WHERE thunk and let
// each test stub the resolved rows with `mockWhere.mockResolvedValueOnce`.
// ---------------------------------------------------------------------------

const mockWhere = vi.fn();
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
// The radar handler now also issues a no-innerJoin review-evidence query
// (`reviewContributingRows`): `select(...).from(vocabularyReviewLog).where(...)`.
// `mockReviewWhere` is that terminal — defaults to no review rows; a test can
// `mockReviewWhere.mockResolvedValueOnce(rows)` to drive radar movement.
const mockReviewWhere = vi.fn(() => Promise.resolve<unknown[]>([]));
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin, where: mockReviewWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
  },
}));

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    difficulty: 'difficulty',
    language: 'language',
    contentJson: 'content_json',
  },
  userExerciseHistory: {
    userId: 'user_id',
    exerciseId: 'exercise_id',
    score: 'score',
    evaluatedAt: 'evaluated_at',
  },
  vocabularyReviewLog: {
    userId: 'user_id',
    language: 'language',
    outcome: 'outcome',
    cefrBand: 'cefr_band',
    grammarPoints: 'grammar_points',
    reviewedAt: 'reviewed_at',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Auth env fixtures (mirror profiles.test.ts / exercises.test.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Row factories — match the projection shape returned by Drizzle for each
// route.
// ---------------------------------------------------------------------------

type RadarRow = {
  score: number | null;
  difficulty: string | null;
  type: string | null;
  evaluatedAt: Date | null;
};

const NOW_MS = Date.now();
const DAY = 86_400_000;

function radarRow(overrides: Partial<RadarRow> = {}): RadarRow {
  return {
    score: 0.8,
    difficulty: CefrLevel.B1,
    type: ExerciseType.CLOZE,
    evaluatedAt: new Date(NOW_MS),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GET /progress/radar
// ---------------------------------------------------------------------------

describe('GET /progress/radar', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./progress');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns six axes in fixed order with all-zero values for an empty user', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const res = await app.request(
      '/progress/radar?language=ES',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.language).toBe('ES');
    expect(body.axes).toHaveLength(6);
    expect(body.axes.map((a: AnyJson) => a.key)).toEqual([
      'listening',
      'reading',
      'speaking',
      'writing',
      'grammar',
      'vocabulary',
    ]);
    for (const axis of body.axes) {
      expect(axis.currentMastery).toBe(0);
      expect(axis.previousMastery).toBe(0);
      expect(axis.lastPracticedAt).toBeNull();
      expect(axis.evidenceCount).toBe(0);
    }
  });

  it('routes rows to the right axis based on exercise type', async () => {
    mockWhere.mockResolvedValueOnce([
      radarRow({ type: ExerciseType.CLOZE }),
      radarRow({ type: ExerciseType.CLOZE }),
      radarRow({ type: ExerciseType.VOCAB_RECALL }),
      radarRow({ type: ExerciseType.TRANSLATION }),
    ]);

    const res = await app.request(
      '/progress/radar?language=ES',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    const byKey = Object.fromEntries(
      body.axes.map((a: AnyJson) => [a.key, a]),
    );
    expect(byKey.grammar.evidenceCount).toBe(2);
    expect(byKey.vocabulary.evidenceCount).toBe(1);
    expect(byKey.writing.evidenceCount).toBe(1);
    expect(byKey.listening.evidenceCount).toBe(0);
    expect(byKey.reading.evidenceCount).toBe(0);
    expect(byKey.speaking.evidenceCount).toBe(0);
  });

  it('drops rows with null score, evaluatedAt, type, or difficulty', async () => {
    mockWhere.mockResolvedValueOnce([
      radarRow({ score: null }),
      radarRow({ evaluatedAt: null }),
      radarRow({ type: null }),
      radarRow({ difficulty: null }),
      // Unknown CEFR level — also dropped (free-text difficulty column)
      radarRow({ difficulty: 'D1' }),
    ]);

    const res = await app.request(
      '/progress/radar?language=ES',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    for (const axis of body.axes) expect(axis.evidenceCount).toBe(0);
  });

  it('returns 400 when language=EN', async () => {
    const res = await app.request(
      '/progress/radar?language=EN',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when language is missing', async () => {
    const res = await app.request('/progress/radar', undefined, authEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when language is not a recognised value', async () => {
    const res = await app.request(
      '/progress/radar?language=FR',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/progress/radar?language=ES',
      undefined,
      unauthEnv,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

// ---------------------------------------------------------------------------
// GET /progress/radar — vocabulary-review evidence UNIONed in (Req 9.5)
// ---------------------------------------------------------------------------
// `mockReviewWhere` stands in for the `reviewContributingRows` query; it
// resolves the raw `vocabulary_review_log` projection
// (`{ outcome, cefrBand, grammarPoints, reviewedAt }`), which the real
// evidence mapper turns into vocabulary (+ grammar) ContributingRows.

type ReviewLogRow = {
  outcome: 'correct' | 'partial' | 'incorrect';
  cefrBand: string | null;
  grammarPoints: string[];
  reviewedAt: Date;
};

function reviewLogRow(overrides: Partial<ReviewLogRow> = {}): ReviewLogRow {
  return {
    outcome: 'correct',
    cefrBand: CefrLevel.B1,
    grammarPoints: [],
    reviewedAt: new Date(NOW_MS),
    ...overrides,
  };
}

describe('GET /progress/radar — review evidence', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./progress');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('advances the vocabulary axis from review evidence alone', async () => {
    mockWhere.mockResolvedValueOnce([]); // no exercise history
    mockReviewWhere.mockResolvedValueOnce([reviewLogRow(), reviewLogRow()]);

    const res = await app.request('/progress/radar?language=ES', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    const byKey = Object.fromEntries(body.axes.map((a: AnyJson) => [a.key, a]));
    expect(byKey.vocabulary.evidenceCount).toBe(2);
    expect(byKey.vocabulary.currentMastery).toBeCloseTo(1, 5); // two correct reviews
    expect(byKey.grammar.evidenceCount).toBe(0); // no grammar points
  });

  it('also advances the grammar axis when a review carries grammar points, unioned with exercise evidence', async () => {
    mockWhere.mockResolvedValueOnce([radarRow({ type: ExerciseType.VOCAB_RECALL })]);
    mockReviewWhere.mockResolvedValueOnce([reviewLogRow({ grammarPoints: ['dative'] })]);

    const res = await app.request('/progress/radar?language=ES', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    const byKey = Object.fromEntries(body.axes.map((a: AnyJson) => [a.key, a]));
    // One exercise vocab_recall row + one review vocab row → vocabulary axis.
    expect(byKey.vocabulary.evidenceCount).toBe(2);
    // The grammar-points row routes to the grammar axis.
    expect(byKey.grammar.evidenceCount).toBe(1);
  });

  it('recency-weights review evidence within the window (old negative decays)', async () => {
    // The hard 90-day cut lives in the SQL WHERE; here we assert the
    // recency-weighting the radar applies: a recent correct + recent incorrect
    // sits near 0.5, while the same pair with the incorrect aged 80 days rises
    // (the stale miss is down-weighted).
    mockWhere.mockResolvedValueOnce([]);
    mockReviewWhere.mockResolvedValueOnce([
      reviewLogRow({ outcome: 'correct' }),
      reviewLogRow({ outcome: 'incorrect' }),
    ]);
    const recentRes = await app.request('/progress/radar?language=ES', undefined, authEnv);
    const recent = (await recentRes.json()) as AnyJson;
    const masteryRecent = Object.fromEntries(
      recent.axes.map((a: AnyJson) => [a.key, a]),
    ).vocabulary.currentMastery;

    mockWhere.mockResolvedValueOnce([]);
    mockReviewWhere.mockResolvedValueOnce([
      reviewLogRow({ outcome: 'correct' }),
      reviewLogRow({ outcome: 'incorrect', reviewedAt: new Date(NOW_MS - 80 * DAY) }),
    ]);
    const agedRes = await app.request('/progress/radar?language=ES', undefined, authEnv);
    const aged = (await agedRes.json()) as AnyJson;
    const masteryAged = Object.fromEntries(
      aged.axes.map((a: AnyJson) => [a.key, a]),
    ).vocabulary.currentMastery;

    expect(masteryRecent).toBeGreaterThan(0);
    expect(masteryAged).toBeGreaterThan(masteryRecent);
  });
});

