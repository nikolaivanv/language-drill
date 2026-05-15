import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { parseTheoryTopicJson, type TheoryTopicJson } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// DB chain mocks
// ---------------------------------------------------------------------------
// Single-topic route uses: db.select(...).from(...).where(...).orderBy(...).limit(1)
// List route uses Promise.all of:
//   - db.select(...).from(...).where(...).orderBy(...)        (rowsQuery)
//   - db.select(...).from(...).where(...)                     (totalQuery — count)
// We mock the chain so each terminal call (.limit, .orderBy without limit, .where
// for count) can be primed independently per test.
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
// Thenable resolvers for query shapes that terminate without `.limit()`.
// Drizzle query builders implement `.then`, so chains like
// `select().from().where().orderBy()` (list rowsQuery) and
// `select().from().where()` (list totalQuery — no orderBy or limit)
// resolve directly. The single-topic chain ends at `.limit(1)` and uses
// `mockLimit` instead, so these thenables are never invoked there.
const mockRowsResolver = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]));
const mockTotalResolver = vi.fn<() => Promise<unknown>>(() =>
  Promise.resolve([{ total: 0 }]),
);

const mockOrderBy = vi.fn(() => ({
  limit: mockLimit,
  then: (
    resolve?: ((value: unknown) => unknown) | null,
    reject?: ((reason: unknown) => unknown) | null,
  ) => mockRowsResolver().then(resolve ?? undefined, reject ?? undefined),
}));
const mockWhere = vi.fn(() => ({
  orderBy: mockOrderBy,
  limit: mockLimit,
  then: (
    resolve?: ((value: unknown) => unknown) | null,
    reject?: ((reason: unknown) => unknown) | null,
  ) => mockTotalResolver().then(resolve ?? undefined, reject ?? undefined),
}));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & {
    onConflictDoNothing: typeof mockOnConflictDoNothing;
  };
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
  theoryTopics: {
    id: 'id',
    language: 'language',
    topicId: 'topic_id',
    contentJson: 'content_json',
    reviewStatus: 'review_status',
    generatedAt: 'generated_at',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Auth env helpers
// ---------------------------------------------------------------------------

const authEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user_123' } } },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validTopicJson: TheoryTopicJson = {
  id: 'b1-test-topic',
  title: 'a small B1 theory topic',
  subtitle: 'for the route test',
  cefr: 'B1',
  sections: [
    {
      id: 'overview',
      title: 'overview',
      body: [
        {
          kind: 'paragraph',
          text: [{ kind: 'text', text: 'A short paragraph.' }],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// GET /theory/:lang/:topicId — happy paths
// ---------------------------------------------------------------------------

describe('GET /theory/:lang/:topicId — happy paths', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./theory');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 200 + parsed TheoryTopicJson for an approved row', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-000000000001',
        contentJson: validTopicJson,
      },
    ]);

    const res = await app.request('/theory/ES/b1-test-topic', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // Body must validate against the parser (same contract the client uses).
    const reparsed = parseTheoryTopicJson(body);
    expect(reparsed.id).toBe('b1-test-topic');
    expect(reparsed.title).toBe('a small B1 theory topic');
    expect(reparsed.sections).toHaveLength(1);
  });

  it('returns 404 TOPIC_NOT_FOUND when no row matches', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/theory/ES/non-existent', undefined, authEnv);

    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('TOPIC_NOT_FOUND');
  });

  it('returns 404 when only flagged rows exist (partial-index/predicate excludes them)', async () => {
    // The route's `inArray(reviewStatus, ['auto-approved','manual-approved'])`
    // predicate causes a flagged-only row to be filtered out at the SQL layer,
    // so the mock returns an empty array — same effect as the no-row path.
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/theory/ES/b1-flagged', undefined, authEnv);

    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('TOPIC_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /theory/:lang/:topicId — error paths
// ---------------------------------------------------------------------------

describe('GET /theory/:lang/:topicId — error paths', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./theory');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 400 VALIDATION_ERROR for an unsupported language (EN)', async () => {
    const res = await app.request('/theory/EN/anything', undefined, authEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.error).toBe('Invalid language');
    // Validation runs before the DB call — select must not be invoked.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a topicId that violates the regex', async () => {
    const res = await app.request('/theory/ES/Bad..ID', undefined, authEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.error).toBe('Invalid topicId');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR and logs error when content_json fails the parser', async () => {
    // Corrupt row: empty `title` + empty `sections` array — parser throws.
    mockLimit.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-0000000000aa',
        contentJson: { id: 'x', title: '', subtitle: 'x', cefr: 'B1', sections: [] },
      },
    ]);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await app.request('/theory/ES/b1-corrupt', undefined, authEnv);

    expect(res.status).toBe(500);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).toBe('Internal error');
    // The row id must appear in the log so an operator can find the bad row.
    expect(errorSpy).toHaveBeenCalled();
    const loggedMessage = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(loggedMessage).toContain('00000000-0000-0000-0000-0000000000aa');

    errorSpy.mockRestore();
  });

  it('returns the freshest row when ORDER BY generated_at DESC NULLS LAST resolves a tie', async () => {
    // The route trusts SQL's ORDER BY + LIMIT 1 to pick the row with the later
    // generated_at. The mock returns the post-sort, post-limit result — we
    // assert the route both applies an orderBy step and returns rows[0].
    const freshTopic: TheoryTopicJson = {
      ...validTopicJson,
      title: 'fresh title',
    };
    mockLimit.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-0000000000bb',
        contentJson: freshTopic,
      },
    ]);

    const res = await app.request('/theory/ES/b1-test-topic', undefined, authEnv);

    expect(res.status).toBe(200);
    expect(mockOrderBy).toHaveBeenCalled();
    const body = (await res.json()) as AnyJson;
    expect(body.title).toBe('fresh title');
  });
});

// ---------------------------------------------------------------------------
// GET /theory/:lang — list endpoint
// ---------------------------------------------------------------------------

describe('GET /theory/:lang — list endpoint', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./theory');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns topics sorted by title ascending', async () => {
    // SQL contract is `ORDER BY content_json->>'title' ASC`; the route relies
    // on the DB to return rows pre-sorted. We mock the post-sort result so
    // the test pins both the response shape and the route's pass-through.
    mockRowsResolver.mockResolvedValueOnce([
      { id: 'topic-alpha', title: 'alpha', cefr: 'B1' },
      { id: 'topic-beta', title: 'beta', cefr: 'B1' },
      { id: 'topic-gamma', title: 'gamma', cefr: 'B2' },
    ]);
    mockTotalResolver.mockResolvedValueOnce([{ total: 3 }]);

    const res = await app.request('/theory/ES', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.topics.map((t: { title: string }) => t.title)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('returns { topics: [] } when no rows exist for the language', async () => {
    mockRowsResolver.mockResolvedValueOnce([]);
    mockTotalResolver.mockResolvedValueOnce([{ total: 0 }]);

    const res = await app.request('/theory/DE', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.topics).toEqual([]);
  });

  it('filters out corrupt rows (title IS NULL) and emits one warn-level log', async () => {
    // The SQL `IS NOT NULL` predicates drop corrupt rows from rowsQuery while
    // the totalQuery counts them. The route detects the count mismatch and
    // emits one warn log so an operator can see the degraded shape.
    mockRowsResolver.mockResolvedValueOnce([
      { id: 'topic-good', title: 'good', cefr: 'B1' },
    ]);
    mockTotalResolver.mockResolvedValueOnce([{ total: 2 }]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await app.request('/theory/ES', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.topics).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArgs = warnSpy.mock.calls[0];
    expect(JSON.stringify(warnArgs)).toContain('"dropped":1');
    expect(JSON.stringify(warnArgs)).toContain('"language":"ES"');

    warnSpy.mockRestore();
  });
});
