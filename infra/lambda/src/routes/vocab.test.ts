import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
//
// The vocab route issues two DB query *shapes*, against two different tables:
//
//   vocab_target rows (topic list / topic detail):
//     db.select(...).from(vocabTarget).where(...)[.orderBy(...)]
//   word-coverage rollup (per umbrella, may run more than once per request):
//     db.select(...).from(exercises).leftJoin(userExerciseHistory, ...).where(...).groupBy(...)
//
// Rather than a single FIFO queue (fragile: `Promise.all` in the topic-detail
// handler resolves the two query chains in an order that depends on await
// timing, not source order -- see the admin.test.ts execute-vs-select
// ordering hazard in the project memory), we branch by *which table* `.from()`
// was called with and keep a separate FIFO queue per table. Each table's own
// call order is still deterministic (topic-detail: one vocab_target call +
// one exercises call; topic-list: one vocab_target call then N sequential
// exercises calls, one per umbrella, in Map iteration/insertion order).
// ---------------------------------------------------------------------------

const vocabTargetQueue: unknown[][] = [];
const exercisesQueue: unknown[][] = [];

function makeBuilder(queue: unknown[][]): unknown {
  const builder: {
    from: (_t: unknown) => typeof builder;
    leftJoin: (..._args: unknown[]) => typeof builder;
    where: (..._args: unknown[]) => typeof builder;
    orderBy: (..._args: unknown[]) => typeof builder;
    groupBy: (..._args: unknown[]) => typeof builder;
    then: (
      onFulfilled: (v: unknown[]) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    catch: (fn: (e: unknown) => unknown) => unknown;
    finally: (fn: () => void) => unknown;
  } = {
    from: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    groupBy: () => builder,
    then(onFulfilled, onRejected) {
      return Promise.resolve(queue.shift() ?? []).then(onFulfilled, onRejected);
    },
    catch(fn) {
      return Promise.resolve(queue.shift() ?? []).catch(fn);
    },
    finally(fn) {
      return Promise.resolve(queue.shift() ?? []).finally(fn);
    },
  };
  return builder;
}

// `.from(table)` picks the right per-table queue by reference identity
// against the mocked `vocabTarget` / `exercises` table objects below.
const mockSelect = vi.fn(() => {
  const builder = {
    from: (table: unknown) => {
      if (table === MOCK_VOCAB_TARGET) return makeBuilder(vocabTargetQueue);
      return makeBuilder(exercisesQueue);
    },
  };
  return builder;
});

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
  },
}));

const MOCK_VOCAB_TARGET = {
  language: 'language',
  umbrellaKey: 'umbrella_key',
  lemma: 'lemma',
  displayForm: 'display_form',
  gloss: 'gloss',
  exampleSentence: 'example_sentence',
  freqRank: 'freq_rank',
  tier: 'tier',
  status: 'status',
};

const MOCK_EXERCISES = {
  id: 'id',
  language: 'language',
  contentJson: 'content_json',
  grammarPointKey: 'grammar_point_key',
  reviewStatus: 'review_status',
};

const MOCK_USER_EXERCISE_HISTORY = {
  id: 'id',
  exerciseId: 'exercise_id',
  userId: 'user_id',
  score: 'score',
};

type VocabFixture = {
  key: string;
  name: string;
  cefrLevel: string;
  language: string;
  kind: string;
};

const ES_VOCAB_FIXTURES: VocabFixture[] = [
  {
    key: 'es-a1-vocab-food-drink',
    name: 'Food & drink',
    cefrLevel: 'A1',
    language: 'ES',
    kind: 'vocab',
  },
  {
    key: 'es-a1-vocab-family',
    name: 'Family',
    cefrLevel: 'A1',
    language: 'ES',
    kind: 'vocab',
  },
];

const ES_VOCAB_INDEX = new Map<string, VocabFixture>(ES_VOCAB_FIXTURES.map((p) => [p.key, p]));
const ES_VOCAB_ORDER = new Map<string, number>(ES_VOCAB_FIXTURES.map((p, i) => [p.key, i]));

vi.mock('@language-drill/db', () => ({
  exercises: MOCK_EXERCISES,
  userExerciseHistory: MOCK_USER_EXERCISE_HISTORY,
  vocabTarget: MOCK_VOCAB_TARGET,
  getGrammarPoint: (key: string) => ES_VOCAB_INDEX.get(key),
  curriculumOrderOf: (key: string) => ES_VOCAB_ORDER.get(key),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

const authEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user_123' } } },
    },
  },
};

describe('GET /vocab/topics/:umbrellaKey', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    vocabTargetQueue.length = 0;
    exercisesQueue.length = 0;
    const mod = await import('./vocab');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns words ordered by freqRank asc with derived coverage state', async () => {
    // vocab_target rows — DB already orders by freqRank asc (pan=300 before manzana=800)
    vocabTargetQueue.push([
      {
        lemma: 'pan',
        displayForm: 'el pan',
        gloss: 'bread',
        exampleSentence: 'Como pan.',
        freqRank: 300,
        tier: 'core',
      },
      {
        lemma: 'manzana',
        displayForm: 'la manzana',
        gloss: 'apple',
        exampleSentence: 'Como una manzana.',
        freqRank: 800,
        tier: 'core',
      },
    ]);
    // word-coverage rollup: manzana practiced strong, pan untested (exercise exists, 0 attempts)
    exercisesQueue.push([
      { word: 'manzana', attempts: 2, bestScore: 0.9 },
      { word: 'pan', attempts: 0, bestScore: null },
    ]);

    const res = await app.request(
      '/vocab/topics/es-a1-vocab-food-drink',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.umbrellaKey).toBe('es-a1-vocab-food-drink');
    expect(body.name).toBe('Food & drink');
    expect(body.cefrLevel).toBe('A1');
    expect(body.words).toHaveLength(2);
    expect(body.words[0].lemma).toBe('pan');
    expect(body.words[0].state).toBe('untested');
    expect(body.words[1].lemma).toBe('manzana');
    expect(body.words[1].state).toBe('practiced-strong');
  });

  it('merges word-coverage rows that differ only by casing instead of overwriting', async () => {
    // Two approved exercises store the same lemma with different casing —
    // two separate SQL GROUP BY groups that normalize to the same map key.
    vocabTargetQueue.push([
      {
        lemma: 'manzana',
        displayForm: 'la manzana',
        gloss: 'apple',
        exampleSentence: 'Como una manzana.',
        freqRank: 800,
        tier: 'core',
      },
    ]);
    exercisesQueue.push([
      { word: 'Manzana', attempts: 1, bestScore: 0.9 },
      { word: 'manzana', attempts: 1, bestScore: 0.6 },
    ]);

    const res = await app.request(
      '/vocab/topics/es-a1-vocab-food-drink',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.words).toHaveLength(1);
    // The strong (0.9) row is emitted FIRST, the weak (0.6) row second — this
    // ordering distinguishes merge from overwrite. A naive .set() overwrite
    // lets the later, weaker row clobber the map entry (ends at attempts:1,
    // bestScore:0.6 -> practiced-weak, failing this assertion). Only a true
    // merge accumulates attempts (1+1=2) and keeps the max bestScore
    // (max(0.9, 0.6)=0.9), landing on practiced-strong.
    expect(body.words[0].lemma).toBe('manzana');
    expect(body.words[0].state).toBe('practiced-strong');
  });

  it('returns 404 NOT_FOUND for an unknown key', async () => {
    const res = await app.request('/vocab/topics/es-a1-not-a-topic', undefined, authEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for a non-vocab grammar-point key', async () => {
    ES_VOCAB_INDEX.set('es-a1-ser-estar', {
      key: 'es-a1-ser-estar',
      name: 'Ser vs estar',
      cefrLevel: 'A1',
      language: 'ES',
      kind: 'grammar',
    });
    const res = await app.request('/vocab/topics/es-a1-ser-estar', undefined, authEnv);
    ES_VOCAB_INDEX.delete('es-a1-ser-estar');
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/vocab/topics/es-a1-vocab-food-drink', undefined, {
      event: { requestContext: {} },
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /vocab/topics', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    vocabTargetQueue.length = 0;
    exercisesQueue.length = 0;
    const mod = await import('./vocab');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns only umbrellas with approved rows, with wordCount/available/practiced, curriculum-ordered', async () => {
    // Single vocab_target query, all approved rows across both umbrellas.
    vocabTargetQueue.push([
      { umbrellaKey: 'es-a1-vocab-family', lemma: 'madre', displayForm: 'la madre' },
      { umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'pan', displayForm: 'el pan' },
      { umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'manzana', displayForm: 'la manzana' },
    ]);
    // Handler iterates umbrellas and issues one exercises rollup query per umbrella.
    // Map insertion order follows the vocab_target row order above: family first, then food-drink.
    exercisesQueue.push([]); // family: madre — not-yet (no exercise)
    exercisesQueue.push([
      { word: 'pan', attempts: 1, bestScore: 0.5 }, // practiced-weak
      { word: 'manzana', attempts: 0, bestScore: null }, // untested
    ]);

    const res = await app.request('/vocab/topics?language=ES', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.topics).toHaveLength(2);

    // Curriculum order: food-drink (index 0) before family (index 1), despite
    // family appearing first in the vocab_target rows.
    expect(body.topics.map((t: AnyJson) => t.umbrellaKey)).toEqual([
      'es-a1-vocab-food-drink',
      'es-a1-vocab-family',
    ]);

    const foodDrink = body.topics.find(
      (t: AnyJson) => t.umbrellaKey === 'es-a1-vocab-food-drink',
    );
    expect(foodDrink).toMatchObject({
      name: 'Food & drink',
      cefrLevel: 'A1',
      wordCount: 2,
      available: 2,
      practiced: 1,
    });

    const family = body.topics.find((t: AnyJson) => t.umbrellaKey === 'es-a1-vocab-family');
    expect(family).toMatchObject({
      name: 'Family',
      cefrLevel: 'A1',
      wordCount: 1,
      available: 0,
      practiced: 0,
    });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/vocab/topics?language=ES', undefined, {
      event: { requestContext: {} },
    });
    expect(res.status).toBe(401);
  });
});
