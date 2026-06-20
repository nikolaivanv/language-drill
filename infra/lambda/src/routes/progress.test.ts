import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { CefrLevel, ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
//
// The progress route issues several DB query shapes:
//
//   Radar exercise history:
//     db.select(...).from(...).innerJoin(...).where(...)
//   Radar review evidence:
//     db.select(...).from(...).where(...)
//   Curriculum profile:
//     db.select(...).from(...).where(...).limit(1)
//   Curriculum mastery:
//     db.select(...).from(...).where(...)
//   Curriculum errors:
//     db.select(...).from(...).where(...).groupBy(...)
//
// We capture WHERE thunks and let each test stub the resolved rows.
// `mockWhere` covers the innerJoin path (radar exercise history).
// `mockReviewWhere` covers the plain `.from().where()` path (radar review +
// all three curriculum queries). It returns a thenable-plus object so callers
// can either `await` it directly, call `.limit()`, or call `.groupBy()` on it.
// The queue of per-call resolved values is managed via `queueWhereResult`.
// ---------------------------------------------------------------------------

const mockWhere = vi.fn();
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));

// A chainable-thenable factory: the returned object is awaitable (has .then /
// .catch / .finally so Promise.resolve(obj) just returns obj as the resolved
// value — not what we want — so we implement the Thenable protocol directly:
// drizzle awaits the query object itself, calling obj.then(onFulfilled,
// onRejected). That is exactly what we implement. We also expose .groupBy()
// and .limit() for the curriculum error / profile queries.
function makeChainResult(data: unknown[] = []): unknown {
  const obj: {
    then: (
      onFulfilled: (v: unknown[]) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    catch: (fn: (e: unknown) => unknown) => unknown;
    finally: (fn: () => void) => unknown;
    groupBy: (..._args: unknown[]) => Promise<unknown[]>;
    limit: (_n: number) => Promise<unknown[]>;
  } = {
    then(onFulfilled, onRejected) {
      return Promise.resolve(data).then(onFulfilled, onRejected);
    },
    catch(fn) {
      return Promise.resolve(data).catch(fn);
    },
    finally(fn) {
      return Promise.resolve(data).finally(fn);
    },
    groupBy(..._args) {
      return Promise.resolve(data);
    },
    limit(_n) {
      return Promise.resolve(data);
    },
  };
  return obj;
}

// `mockReviewWhere` is the terminal for the plain `.from().where()` path.
// Default: resolves to []. Radar tests use `.mockResolvedValueOnce(rows)`;
// curriculum tests use `.mockImplementationOnce(() => makeChainResult(rows))`.
const mockReviewWhere = vi.fn(() => makeChainResult([]));
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin, where: mockReviewWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
  },
}));

// ---------------------------------------------------------------------------
// Curriculum fixtures — deterministic TR grammar points used in test seeding.
// These mirror the real curriculum entries but are kept small so assertions are
// easy to reason about.  `grammarPointsAtOrBelow` and `getGrammarPoint` are
// mocked to return only these three points; `curriculumOrderOf` returns stable
// index numbers.
// ---------------------------------------------------------------------------

type TrFixture = {
  key: string;
  name: string;
  cefrLevel: string;
  language: string;
  kind: string;
  prerequisiteKeys: string[];
};

const TR_FIXTURES: TrFixture[] = [
  {
    key: 'tr-a1-vowel-harmony',
    name: 'Vowel harmony',
    cefrLevel: 'A1',
    language: 'TR',
    kind: 'grammar',
    prerequisiteKeys: [],
  },
  {
    key: 'tr-a1-accusative-definite-object',
    name: 'Accusative -(y)I for definite objects',
    cefrLevel: 'A1',
    language: 'TR',
    kind: 'grammar',
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-possessive-case-stacking',
    name: 'Possessive + case stacking',
    cefrLevel: 'A2',
    language: 'TR',
    kind: 'grammar',
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-accusative-definite-object'],
  },
];

const TR_FIXTURE_INDEX = new Map<string, TrFixture>(TR_FIXTURES.map((p) => [p.key, p]));
const TR_FIXTURE_ORDER = new Map<string, number>(TR_FIXTURES.map((p, i) => [p.key, i]));

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
  // Curriculum handler tables
  userGrammarMastery: {
    userId: 'user_id',
    language: 'language',
    grammarPointKey: 'grammar_point_key',
    masteryScore: 'mastery_score',
    confidence: 'confidence',
    evidenceCount: 'evidence_count',
    lastPracticedAt: 'last_practiced_at',
  },
  errorObservations: {
    userId: 'user_id',
    language: 'language',
    occurredAt: 'occurred_at',
    errorGrammarPointKey: 'error_grammar_point_key',
    hostGrammarPointKey: 'host_grammar_point_key',
  },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  // Curriculum helpers — driven by TR_FIXTURES above
  grammarPointsAtOrBelow: (language: string, _level: string) => {
    if (language !== 'TR') return [];
    // Return all TR fixtures (A1 + A2) — handler filters by cefrLevel itself
    return [...TR_FIXTURES];
  },
  getGrammarPoint: (key: string) => TR_FIXTURE_INDEX.get(key),
  curriculumOrderOf: (key: string) => TR_FIXTURE_ORDER.get(key) ?? 0,
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

// ---------------------------------------------------------------------------
// GET /progress/curriculum
// ---------------------------------------------------------------------------
// The curriculum handler issues three sequential DB queries (via Promise.all
// for mastery + errors, and a separate profile query before that):
//   1. profile: .from(userLanguageProfiles).where(...).limit(1)
//   2. mastery:  .from(userGrammarMastery).where(...)
//   3. errors:   .from(errorObservations).where(...).groupBy(...)
//
// We drive each via mockImplementationOnce on mockReviewWhere (the plain
// `.from().where()` terminal). The profile call is sequential; mastery and
// errors run in Promise.all so they consume the 2nd and 3rd queued impl.
// ---------------------------------------------------------------------------

describe('GET /progress/curriculum', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./progress');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns level-grouped classified points', async () => {
    // Profile → A1
    mockReviewWhere.mockImplementationOnce(() =>
      makeChainResult([{ proficiencyLevel: 'A1' }]),
    );
    // Mastery → vowel-harmony is solid
    mockReviewWhere.mockImplementationOnce(() =>
      makeChainResult([
        {
          grammarPointKey: 'tr-a1-vowel-harmony',
          masteryScore: 0.9,
          confidence: 0.8,
          evidenceCount: 5,
          lastPracticedAt: new Date(NOW_MS - DAY),
        },
      ]),
    );
    // Errors → accusative has ≥2 recent errors
    mockReviewWhere.mockImplementationOnce(() =>
      makeChainResult([
        { key: 'tr-a1-accusative-definite-object', n: 3 },
      ]),
    );

    const res = await app.request('/progress/curriculum?language=TR', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.language).toBe('TR');
    expect(body.activeLevel).toBe('A1');

    // A1 level is present
    const a1 = body.levels.find((l: AnyJson) => l.level === 'A1');
    expect(a1).toBeDefined();
    expect(a1.isPreview).toBe(false);

    // Vowel harmony is solid
    expect(
      a1.points.find((p: AnyJson) => p.key === 'tr-a1-vowel-harmony').state,
    ).toBe('solid');

    // Accusative is error-prone
    expect(
      a1.points.find((p: AnyJson) => p.key === 'tr-a1-accusative-definite-object').errorProne,
    ).toBe(true);

    // A2 preview level is present
    expect(body.levels.some((l: AnyJson) => l.isPreview)).toBe(true);
    const a2 = body.levels.find((l: AnyJson) => l.level === 'A2');
    expect(a2).toBeDefined();
    expect(a2.isPreview).toBe(true);
  });

  it('defaults to B1 when profile is missing and returns a response', async () => {
    // No profile row
    mockReviewWhere.mockImplementationOnce(() => makeChainResult([]));
    // No mastery
    mockReviewWhere.mockImplementationOnce(() => makeChainResult([]));
    // No errors
    mockReviewWhere.mockImplementationOnce(() => makeChainResult([]));

    const res = await app.request('/progress/curriculum?language=TR', undefined, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.activeLevel).toBe('B1');
  });

  it('returns 400 for invalid language', async () => {
    const res = await app.request('/progress/curriculum?language=EN', undefined, authEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/progress/curriculum?language=TR', undefined, unauthEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

