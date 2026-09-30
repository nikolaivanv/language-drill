import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: Record<string, any> = {};
// Captures the object handed to db.select({...}) and the predicates passed to
// .where(), so the test can assert the projection and the forced type filter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captured: Record<string, any> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

vi.mock('../db', () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.from = () => c;
    c.where = (...args: unknown[]) => {
      captured.where = args;
      return c;
    };
    c.limit = (n: number) => {
      captured.limit = n;
      if (state.dbError) return Promise.reject(state.dbError);
      return Promise.resolve(state.rows ?? []);
    };
    // The points query is the one that terminates on groupBy rather than limit.
    c.groupBy = (...args: unknown[]) => {
      captured.groupBy = args;
      if (state.dbError) return Promise.reject(state.dbError);
      return Promise.resolve(state.rows ?? []);
    };
    return c;
  };
  return {
    db: {
      select: (projection: unknown) => {
        captured.projection = projection;
        return chain();
      },
    },
  };
});

// A miniature curriculum. `es-b1-conditional` is ES/B1; `es-a2-imperfect` is
// ES/A2, so it is a real key that is nonetheless WRONG for the B1 cell — the
// case that separates "the key exists" from "the key belongs here".
const CURRICULUM: Record<string, { name: string; language: string; cefrLevel: string }> = {
  'es-b1-conditional': { name: 'Conditional', language: 'ES', cefrLevel: 'B1' },
  'es-b1-present-subjunctive': {
    name: 'Present subjunctive',
    language: 'ES',
    cefrLevel: 'B1',
  },
  'es-a2-imperfect': { name: 'Imperfect', language: 'ES', cefrLevel: 'A2' },
};

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    language: 'language',
    difficulty: 'difficulty',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    contentJson: 'content_json',
    audioS3Key: 'audio_s3_key',
  },
  getGrammarPoint: (key: string) => CURRICULUM[key],
  curriculumOrderOf: (key: string) => Object.keys(CURRICULUM).indexOf(key) + 1,
}));

vi.mock('@language-drill/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/shared')>()),
  resolveTheoryCategory: () => 'tenses',
}));

// `eq` / `and` are replaced with plain data so the test can inspect the
// predicates structurally. Stringifying real Drizzle SQL objects is brittle —
// the bound values live in `queryChunks` and the shape is not part of its API.
// `inArray` and `sql` (used by approvedStatusFilter / audioReadyFilter) stay real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ __and: preds }),
    eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  };
});

/** The `[column, value]` pairs the route passed to `eq()`. */
function eqPairs(): Array<[string, string]> {
  const preds = (captured.where[0] as { __and: Array<{ __eq?: [string, string] }> }).__and;
  return preds.filter((p) => p.__eq).map((p) => p.__eq!);
}

function row(id: string, lemma: string, targetForm: string) {
  return {
    id,
    type: 'conjugation',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: 'es-b1-conditional',
    contentJson: {
      type: 'conjugation',
      lemma,
      targetForm,
      subject: { pronoun: 'nosotros', gloss: 'we' },
    },
  };
}

describe('GET /public/conjugation/set', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(state)) delete state[k];
    for (const k of Object.keys(captured)) delete captured[k];
    const mod = await import('./public');
    // Each test gets a clean cache — the module-scope cache would otherwise
    // leak rows between cases.
    mod.__clearPoolCacheForTests();
    app = new Hono();
    app.route('/', mod.default);
  });

  it('serves a set with NO Authorization header', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.available).toBe(1);
    expect(body.exercises[0].id).toBe('a');
    expect(body.difficulty).toBe('B1');
  });

  it('ignores a caller-supplied type and always queries conjugation', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&type=free_writing',
    );
    expect(res.status).toBe(200);
    expect(eqPairs()).toContainEqual(['type', 'conjugation']);
    expect(eqPairs().map(([, value]) => value)).not.toContain('free_writing');
  });

  // NOTE: this file previously asserted that `grammarPoint` was IGNORED — the
  // original design excluded the parameter so the cache key space could not be
  // inflated by a caller (spec D3). The parameter now exists, because a drill
  // you cannot aim is a worse product, and the bound is what actually mattered.
  // The replacement for that test is the validation group further down: an
  // unknown key, a key from another level and a key from another language are
  // all rejected before any query runs, and a mixed request still carries no
  // grammar-point predicate. Those cases ARE the bound — do not weaken them.

  it('projects only the public columns', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(captured.projection).toEqual({
      id: 'id',
      type: 'type',
      language: 'language',
      difficulty: 'difficulty',
      grammarPointKey: 'grammar_point_key',
      contentJson: 'content_json',
    });
  });

  it('rejects a count above the public maximum of 10', async () => {
    state.rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, `lemma${i}`, `form${i}`));
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1&count=50');
    expect(res.status).toBe(400);

    const ok = await app.request('/public/conjugation/set?lang=ES&level=B1&count=10');
    expect(((await ok.json()) as AnyJson).available).toBe(10);
  });

  it('rejects EN and C1', async () => {
    expect((await app.request('/public/conjugation/set?lang=EN&level=B1')).status).toBe(400);
    expect((await app.request('/public/conjugation/set?lang=ES&level=C1')).status).toBe(400);
  });

  it('returns 200 with an empty set for a valid but empty cell', async () => {
    state.rows = [];
    const res = await app.request('/public/conjugation/set?lang=DE&level=B2');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ exercises: [], available: 0 });
  });

  it('collapses duplicate-content rows to one item', async () => {
    state.rows = [
      row('a', 'ir', 'iríamos'),
      row('b', 'ir', 'iríamos'),
      row('c', 'ser', 'seríamos'),
    ];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(((await res.json()) as AnyJson).available).toBe(2);
  });

  it('queries once per key within the TTL', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    captured.limit = undefined;
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(res.status).toBe(200);
    expect(captured.limit).toBeUndefined();
  });

  it('caches per cell, not globally', async () => {
    state.rows = [row('es-a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');

    // A different (language, level) cell must trigger its own query rather
    // than reusing the ES|B1 cache entry — if the cache key stopped
    // distinguishing cells (e.g. collapsed to a constant, or to `lang` alone),
    // this request would silently serve ES|B1's cached rows instead.
    state.rows = [{ ...row('de-b', 'gehen', 'gingen'), language: 'DE', difficulty: 'B2' }];
    captured.limit = undefined;
    const res = await app.request('/public/conjugation/set?lang=DE&level=B2');
    expect(res.status).toBe(200);
    expect(captured.limit).toBe(300); // a fresh query ran for the new cell
    const body = (await res.json()) as AnyJson;
    expect(body.exercises[0].id).toBe('de-b');
  });

  it('keys on level, not language alone', async () => {
    state.rows = [row('es-b1', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');

    // Same language, different level: if the cache key dropped `level` (e.g.
    // collapsed to `lang` alone), this request would hit the ES|B1 cache
    // entry and silently serve B1 rows to a caller who asked for A2.
    state.rows = [{ ...row('es-a2', 'hablar', 'hablabas'), difficulty: 'A2' }];
    captured.limit = undefined;
    const res = await app.request('/public/conjugation/set?lang=ES&level=A2');
    expect(res.status).toBe(200);
    expect(captured.limit).toBe(300); // a fresh query ran for the new cell
    const body = (await res.json()) as AnyJson;
    expect(body.exercises[0].id).toBe('es-a2');
  });

  it('strips writer-only contentJson keys while keeping learner-facing fields', async () => {
    state.rows = [
      {
        ...row('a', 'ir', 'iríamos'),
        contentJson: {
          ...row('a', 'ir', 'iríamos').contentJson,
          _dedupKey: 'ir|iríamos|nosotros',
          seedWord: 'ir',
        },
      },
    ];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    const body = (await res.json()) as AnyJson;
    const content = body.exercises[0].contentJson;
    expect(content).not.toHaveProperty('_dedupKey');
    expect(content).not.toHaveProperty('seedWord');
    // Learner-facing fields survive untouched.
    expect(content).toMatchObject({
      type: 'conjugation',
      lemma: 'ir',
      targetForm: 'iríamos',
      subject: { pronoun: 'nosotros', gloss: 'we' },
    });
  });

  it('sets Cache-Control: no-store on a successful response', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 503 POOL_UNAVAILABLE when the database load fails, with no-store', async () => {
    state.dbError = new Error('connection refused');
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('POOL_UNAVAILABLE');
  });

  it('negative-caches a database failure: a second request within the window does not re-query', async () => {
    state.dbError = new Error('connection refused');
    const first = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(first.status).toBe(503);

    captured.limit = undefined;
    const second = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(second.status).toBe(503);
    // No fresh query ran for the second request — served from the negative
    // cache entry instead.
    expect(captured.limit).toBeUndefined();
  });

  // --- grammarPoint: the parameter the original design refused to have ------
  //
  // It is admitted only because it is validated against the curriculum. These
  // cases are the validation, so weakening them re-opens the unbounded-cache-key
  // hole the exclusion existed to prevent.

  it('rejects a grammar point the curriculum does not know', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=../../etc/passwd',
    );
    expect(res.status).toBe(400);
    // Nothing was queried, so no cache key was minted for the invented string.
    expect(captured.limit).toBeUndefined();
  });

  it('rejects a real grammar point that belongs to another level', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-a2-imperfect',
    );
    expect(res.status).toBe(400);
    expect(captured.limit).toBeUndefined();
  });

  it('rejects a real grammar point that belongs to another language', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=DE&level=B1&grammarPoint=es-b1-conditional',
    );
    expect(res.status).toBe(400);
  });

  it('filters on an accepted grammar point', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-b1-conditional',
    );
    expect(res.status).toBe(200);
    expect(eqPairs()).toContainEqual(['grammar_point_key', 'es-b1-conditional']);
  });

  it('caches a targeted set separately from the mixed one', async () => {
    state.rows = [row('mixed', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');

    state.rows = [row('targeted', 'poder', 'podría')];
    captured.limit = undefined;
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-b1-conditional',
    );

    // A fresh query ran, and the targeted request did not serve the mixed
    // set's cached rows.
    expect(captured.limit).toBe(300);
    expect(((await res.json()) as AnyJson).exercises[0].id).toBe('targeted');
  });

  it('omits the grammar-point predicate entirely for a mixed set', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(eqPairs().map(([column]) => column)).not.toContain('grammar_point_key');
  });

  // --- GET /public/conjugation/points ---------------------------------------

  it('lists only points the curriculum can name, with their counts', async () => {
    state.rows = [
      { key: 'es-b1-conditional', total: 12 },
      { key: 'es-b1-present-subjunctive', total: 9 },
      // Orphaned: a real pool row whose point was retired from the curriculum.
      // It cannot be named, so it must not be offered — it stays reachable
      // through the mixed set.
      { key: 'es-b1-retired-point', total: 4 },
      { key: null, total: 3 },
    ];
    const res = await app.request('/public/conjugation/points?lang=ES&level=B1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.points.map((p: AnyJson) => p.key)).toEqual([
      'es-b1-conditional',
      'es-b1-present-subjunctive',
    ]);
    expect(body.points[0]).toMatchObject({ name: 'Conditional', count: 12, category: 'tenses' });
  });

  it('rejects an invalid cell on the points endpoint', async () => {
    expect((await app.request('/public/conjugation/points?lang=EN&level=B1')).status).toBe(400);
    expect((await app.request('/public/conjugation/points?lang=ES&level=C1')).status).toBe(400);
  });
});
