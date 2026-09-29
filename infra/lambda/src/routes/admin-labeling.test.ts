import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, getTableName } from 'drizzle-orm';
import { LABELABLE_EXERCISE_TYPES } from '@language-drill/shared';
import { userExerciseHistory } from '@language-drill/db';

// ---------------------------------------------------------------------------
// Mock harness — copied from admin-diversity.test.ts / admin.test.ts (the
// established pattern for a route that must be exercised through the REAL
// admin.ts, so its inherited `authMiddleware, adminMiddleware` gate is what
// actually runs, not a stand-in). Diverging from it causes the auth
// middleware's user upsert to hit a real driver.
//
// UNLIKE admin-diversity.test.ts / admin.test.ts, this file does NOT replace
// `exercises` / `userExerciseHistory` / `submissionLabels` with `{ __mock }`
// sentinels below. The `buildQueueConditions` / `buildQueueOrder` tests need
// the REAL schema objects (real drizzle Column instances) so the dialect can
// compile them to actual SQL text — a sentinel would either produce garbage
// SQL or (per the review finding this responds to) silently build conditions
// against `undefined` columns without ever throwing.
//
// Task 4 adds a real insert (POST /admin/labeling/:submissionId), and because
// the schema objects here are real (not `{ __mock }` sentinels), the
// `insertedValuesByTable` key can't be read off a sentinel tag the way
// admin.test.ts does. Instead the key is derived from the real table via
// drizzle's own `getTableName` — which also means the auth middleware's own
// `db.insert(users)...` (fired on every authenticated request, see
// `authMiddleware`) lands under the `users` key, not `submission_labels`, so
// it can never be mistaken for this route's insert.
// ---------------------------------------------------------------------------

const sqsSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SQSClient: vi.fn(function (this: any) { this.send = sqsSend; }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SendMessageCommand: vi.fn(function (this: any, input: unknown) { this.input = input; }),
}));

const mockValidateDraft = vi.fn();
vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>('@language-drill/ai');
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({})),
    validateDraft: (...args: unknown[]) => mockValidateDraft(...args),
  };
});

// ---------------------------------------------------------------------------
// DB chain mock
// ---------------------------------------------------------------------------

const queryQueue: unknown[] = [];
// Captures every `.onConflictDoUpdate(...)` argument across all chains (there
// is only ever one insert per request, but keeping a list rather than a
// single slot avoids any ordering assumption). Used by the "does not
// re-stamp stratum" regression test — that guarantee lives entirely in the
// `set` clause, which `insertedValuesByTable` (INSERT values only) can't see.
const onConflictDoUpdateCalls: Array<{ target: unknown; set: Record<string, unknown> }> = [];

function makeChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    as: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    having: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    set: vi.fn(() => chain),
    // Only the labeling insert (below) uses onConflictDoUpdate. The auth
    // middleware's own upsert uses onConflictDoNothing, which is deliberately
    // absent here — it throws synchronously and is caught by that
    // middleware's own try/catch, matching the pre-existing GET-endpoint
    // tests' behavior.
    onConflictDoUpdate: vi.fn((arg: { target: unknown; set: Record<string, unknown> }) => {
      onConflictDoUpdateCalls.push(arg);
      return chain;
    }),
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

// Capture the rows passed to `.values()` per insert, keyed by the real
// table's name (see the harness comment above for why this differs from
// admin.test.ts's `__mock`-sentinel key).
const insertedValuesByTable: Record<string, unknown> = {};

function dbInsert(table: unknown) {
  const chain = makeChain();
  let key = 'unknown';
  try {
    key = getTableName(table as never);
  } catch {
    // ignore — fall back to 'unknown'
  }
  chain.values = vi.fn((rows: unknown) => {
    insertedValuesByTable[key] = rows;
    return chain;
  });
  return chain;
}

vi.mock('../db', () => ({
  db: {
    select: () => makeChain(),
    insert: (table: unknown) => dbInsert(table),
    update: () => makeChain(),
    transaction: async (fn: (tx: unknown) => unknown) => fn({ update: () => makeChain() }),
    execute: () => Promise.resolve({ rows: queryQueue.shift() ?? [] }),
  },
}));

// ---------------------------------------------------------------------------
// Auth + admin env fixtures — API-Gateway-shaped, so requests traverse the
// REAL authMiddleware / adminMiddleware chain admin.ts declares, not a
// hand-rolled stand-in.
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin_user_001';
const NON_ADMIN_ID = 'user_nobody';

const unauthenticatedEnv = { event: { requestContext: {} } };
const nonAdminEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: NON_ADMIN_ID } } } } } };
const adminEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: ADMIN_ID } } } } } };

const previousAdminUserIds = process.env.ADMIN_USER_IDS;

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  onConflictDoUpdateCalls.length = 0;
  for (const k of Object.keys(insertedValuesByTable)) {
    delete insertedValuesByTable[k];
  }
  process.env.ADMIN_USER_IDS = ADMIN_ID;
  const mod = await import('./admin');
  app = new Hono();
  app.route('/', mod.default);
});

afterEach(() => {
  if (previousAdminUserIds === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = previousAdminUserIds;
  }
});

function request(path: string, env: unknown) {
  return app.request(path, undefined, env);
}

function post(path: string, body: unknown, env: unknown) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

// ---------------------------------------------------------------------------
// Pure-function unit tests
// ---------------------------------------------------------------------------

import {
  buildQueueConditions,
  buildQueueOrder,
  extractReferenceAnswers,
  safeSeed,
  type QueueQuery,
} from './admin-labeling';

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

// ---------------------------------------------------------------------------
// buildQueueConditions / buildQueueOrder — compiled to REAL SQL text via
// drizzle's own dialect, against the REAL schema objects (no mocked
// `@language-drill/db` in this file — see the harness comment above). This is
// the only way to prove the row-selection predicates reference the right
// tables/columns: a request-level test with a mocked `db.select()` never
// calls `.toSQL()`, so a wrong column reference would pass it silently.
// ---------------------------------------------------------------------------

describe('buildQueueConditions (compiled SQL)', () => {
  const dialect = new PgDialect();

  it('emits the deterministic-source exclusion, the labelable-type restriction, and the per-labeler NOT EXISTS against the real columns', () => {
    const conditions = buildQueueConditions({ stratum: 'random' } as QueueQuery, ADMIN_ID);
    const compiled = dialect.sqlToQuery(and(...conditions)!);
    const lower = compiled.sql.toLowerCase();

    // Deterministic-source exclusion: real qualified column, exact operator.
    expect(compiled.sql).toContain('"user_exercise_history"."response_json"');
    expect(lower).toContain("is distinct from 'deterministic'");

    // LABELABLE_EXERCISE_TYPES restriction: real qualified column, and the
    // exact six curriculum type values bound as params (not inlined).
    expect(compiled.sql).toContain('"exercises"."type" in');
    expect(compiled.params.slice(0, 6)).toEqual([...LABELABLE_EXERCISE_TYPES]);

    // Per-labeler NOT EXISTS: the real table name, the real submission_id/id
    // join column (qualified — proving it isn't correlating on a bare "id"),
    // and labeled_by bound to the passed-in labeler, not inlined or swapped.
    expect(lower).toContain('not exists');
    expect(compiled.sql).toContain('SELECT 1 FROM "submission_labels" sl');
    expect(compiled.sql).toContain('sl.submission_id = "user_exercise_history"."id"');
    expect(compiled.sql).toContain('sl.labeled_by =');
    expect(compiled.params).toContain(ADMIN_ID);
  });

  it('adds the language/type/grammarPoint/hasErrors/nearBoundary/score filters only when requested', () => {
    const conditions = buildQueueConditions(
      {
        stratum: 'targeted',
        language: 'ES',
        type: 'cloze',
        grammarPoint: 'es.b1.preterite-vs-imperfect',
        hasErrors: 'true',
        nearBoundary: 'true',
      } as QueueQuery,
      ADMIN_ID,
    );
    const compiled = dialect.sqlToQuery(and(...conditions)!);
    const lower = compiled.sql.toLowerCase();

    expect(compiled.sql).toContain('"exercises"."language" =');
    expect(compiled.params).toContain('ES');
    expect(compiled.params).toContain('cloze');
    expect(compiled.sql).toContain('"exercises"."grammar_point_key" =');
    expect(compiled.params).toContain('es.b1.preterite-vs-imperfect');
    expect(lower).toContain('jsonb_array_length');
    expect(compiled.sql).toContain('"user_exercise_history"."score" >=');
    expect(compiled.sql).toContain('"user_exercise_history"."score" <=');
  });

  it('omits the near-boundary and explicit score bounds by default', () => {
    const conditions = buildQueueConditions({ stratum: 'random' } as QueueQuery, ADMIN_ID);
    const compiled = dialect.sqlToQuery(and(...conditions)!);
    expect(compiled.sql).not.toContain('"user_exercise_history"."score"');
  });
});

describe('buildQueueOrder (compiled SQL)', () => {
  const dialect = new PgDialect();

  it('pins the md5 random-stratum ordering expression, seed inlined', () => {
    const compiled = dialect.sqlToQuery(buildQueueOrder('random', 'pass2'));
    // Table name derived via getTableName, not spelled out — a hardcoded
    // literal here plus a hardcoded assertion would stay in agreement across
    // a table rename while production broke. See buildQueueOrder's comment.
    expect(compiled.sql).toBe(`md5(${getTableName(userExerciseHistory)}.id::text || 'pass2')`);
  });

  it('orders the targeted stratum by distance from CORRECT_THRESHOLD, then recency', () => {
    const compiled = dialect.sqlToQuery(buildQueueOrder('targeted', '2026-09-29'));
    const lower = compiled.sql.toLowerCase();
    expect(lower).toContain('abs(');
    expect(compiled.sql).toContain('"user_exercise_history"."score"');
    expect(lower).toContain('asc');
    expect(compiled.sql).toContain('"user_exercise_history"."evaluated_at"');
    expect(lower).toContain('desc');
  });
});

// ---------------------------------------------------------------------------
// Request-level tests — real admin.ts, real gate.
// ---------------------------------------------------------------------------

type QueueResponse = {
  items: Array<Record<string, unknown>>;
  remaining: number;
  dropped: number;
};

describe('GET /admin/labeling/queue', () => {
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

  it('401s for an unauthenticated request', async () => {
    const res = await request('/admin/labeling/queue?stratum=random', unauthenticatedEnv);
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin', async () => {
    const res = await request('/admin/labeling/queue?stratum=random', nonAdminEnv);
    expect(res.status).toBe(403);
  });

  it('400s on an unknown stratum', async () => {
    const res = await request('/admin/labeling/queue?stratum=everything', adminEnv);
    expect(res.status).toBe(400);
  });

  it('renders the learner view server-side and returns the evaluation', async () => {
    queryQueue.push([row], [{ count: 42 }]);
    const res = await request('/admin/labeling/queue?stratum=random', adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as QueueResponse;
    expect(body.remaining).toBe(42);
    expect(body.dropped).toBe(0);
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
    const res = await request('/admin/labeling/queue?stratum=random', adminEnv);
    const item = ((await res.json()) as QueueResponse).items[0];
    expect(item.optionsRevealed).toBe(true);
    expect(item.learnerView).toContain('Options:');
  });

  it('omits an item whose content type renderLearnerView cannot render, rather than 500ing, and counts it as dropped', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queryQueue.push([{ ...row, exerciseType: 'dictation', contentJson: { type: 'dictation' } }], [{ count: 1 }]);
    const res = await request('/admin/labeling/queue?stratum=random', adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as QueueResponse;
    expect(body.items).toHaveLength(0);
    expect(body.dropped).toBe(1);
    expect(body.remaining).toBe(1);
    // Finding 3: the drop is logged, not silent — names the submission so a
    // labeler staring at an empty page with remaining > 0 can be diagnosed.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(row.submissionId);
    warnSpy.mockRestore();
  });

  it('accepts the targeted stratum with filters', async () => {
    queryQueue.push([row], [{ count: 3 }]);
    const res = await request(
      '/admin/labeling/queue?stratum=targeted&language=ES&type=cloze&nearBoundary=true',
      adminEnv,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/labeling/:submissionId — save endpoint.
//
// Every authenticated request also fires the auth middleware's own
// `db.insert(users)...` (see the harness comment above), which lands under
// the `users` key in `insertedValuesByTable`. Assertions below read the
// `submission_labels` key specifically, never `Object.values(...)[0]`, so
// they can't be confused by that middleware insert.
// ---------------------------------------------------------------------------

describe('POST /admin/labeling/:submissionId', () => {
  const SUB = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    queryQueue.length = 0;
  });

  it('403s for a non-admin', async () => {
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: true, feedbackOk: true, stratum: 'random' }, nonAdminEnv);
    expect(res.status).toBe(403);
  });

  it('400s when a false verdict carries no critique', async () => {
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: false, feedbackOk: true, stratum: 'random' }, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CRITIQUE_REQUIRED');
  });

  it('accepts a false verdict that explains itself', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: false, feedbackOk: true, stratum: 'random', tags: ['alternative-rejected'], critique: 'me fui is also correct' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    const saved = insertedValuesByTable['submission_labels'] as Record<string, unknown>;
    expect(saved.gradeOk).toBe(false);
    expect(saved.tags).toEqual(['alternative-rejected']);
    expect(saved.labeledBy).toBe(ADMIN_ID);
  });

  it('rejects a body that tries to set promptVersion or labeledBy itself', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random', labeledBy: 'user_someone_else', promptVersion: 'evaluate@1999-01-01' },
      adminEnv,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('404s when the submission does not exist', async () => {
    queryQueue.push([]);
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: true, feedbackOk: true, stratum: 'random' }, adminEnv);
    expect(res.status).toBe(404);
  });

  it('accepts unsure on both axes without a critique', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: null, feedbackOk: null, stratum: 'random' }, adminEnv);
    expect(res.status).toBe(200);
  });

  it('rejects a tag outside the closed vocabulary', async () => {
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random', tags: ['vibes-off'] },
      adminEnv,
    );
    expect(res.status).toBe(400);
  });

  it('rejects duplicate tags, which would double-count in the stats histogram', async () => {
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random', tags: ['other', 'other'] },
      adminEnv,
    );
    expect(res.status).toBe(400);
  });

  it('does not re-stamp stratum on an upsert onto an already-labelled row', async () => {
    // Regression for the finding: a stale-cached `random` queue page can
    // still list a row the labeler already labelled under `targeted`
    // (queue pages are staleTime: Infinity). Re-labelling it must not let
    // the second stratum silently overwrite the first, since first touch is
    // the only correct provenance of which selection mechanism served the
    // row. Assert directly on the captured `set` payload, since a request
    // with a fresh stratum still 200s (the endpoint has no way to know this
    // submission was already labelled by this same labeler) — the row-level
    // guarantee lives entirely in the SQL statement's `set` clause.
    queryQueue.push([{ id: SUB }], []);
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random' },
      adminEnv,
    );
    expect(res.status).toBe(200);
    // The `.values()` capture only records the INSERT values (see the
    // harness comment above) — assert against the chain's onConflictDoUpdate
    // call instead, which is what actually carries the `set` payload.
    const onConflictArg = onConflictDoUpdateCalls[onConflictDoUpdateCalls.length - 1];
    expect(onConflictArg.set).not.toHaveProperty('stratum');
    expect(onConflictArg.set).toMatchObject({ gradeOk: true, feedbackOk: true });
  });
});

type StatsResponse = {
  strata: Array<{ stratum: string; count: number; gradeOkRate: number; feedbackOkRate: number }>;
  tags: Array<{ tag: string; count: number }>;
  labeledToday: number;
};

describe('GET /admin/labeling/stats', () => {
  beforeEach(() => {
    queryQueue.length = 0;
  });

  it('reports each stratum separately so the two are never blended', async () => {
    queryQueue.push(
      [
        { stratum: 'random', count: 40, gradeOk: 34, feedbackOk: 31 },
        { stratum: 'targeted', count: 12, gradeOk: 4, feedbackOk: 6 },
      ],
      [{ tag: 'alternative-rejected', count: 5 }],
      [{ count: 7 }],
    );
    const res = await request('/admin/labeling/stats', adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(body.strata).toEqual([
      { stratum: 'random', count: 40, gradeOkRate: 0.85, feedbackOkRate: 0.775 },
      { stratum: 'targeted', count: 12, gradeOkRate: 1 / 3, feedbackOkRate: 0.5 },
    ]);
    expect(body.tags).toEqual([{ tag: 'alternative-rejected', count: 5 }]);
    expect(body.labeledToday).toBe(7);
  });

  it('reports a 0 rate when every label in a stratum says not-ok', async () => {
    queryQueue.push([{ stratum: 'random', count: 3, gradeOk: 0, feedbackOk: 0 }], [], [{ count: 0 }]);
    const body = (await (await request('/admin/labeling/stats', adminEnv)).json()) as StatsResponse;
    expect(body.strata[0].gradeOkRate).toBe(0);
    expect(body.strata[0].count).toBe(3);
  });

  it('survives an empty table without dividing by zero', async () => {
    queryQueue.push([], [], [{ count: 0 }]);
    const body = (await (await request('/admin/labeling/stats', adminEnv)).json()) as StatsResponse;
    expect(body.strata).toEqual([]);
    expect(body.labeledToday).toBe(0);
  });
});
