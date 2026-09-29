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

  it('ignores a caller-supplied grammarPoint', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-b1-subjunctive',
    );
    expect(res.status).toBe(200);
    // No grammar-point predicate at all: an unvalidated caller-supplied key
    // would make the cache key space unbounded (spec D3).
    expect(eqPairs().map(([column]) => column)).not.toContain('grammar_point_key');
  });

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
});
