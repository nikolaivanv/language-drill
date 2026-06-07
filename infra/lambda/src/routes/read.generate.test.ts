import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Tailored db mock for POST /read/generate.
//
// The route issues, in order:
//   - db.select().from(generatedReadingTexts).where().limit()   (cache lookup)
//   - db.update().set().where()                                 (hit_count bump, HIT only)
//   - db.select({count}).from(usageEvents).where()              (24h usage count, MISS only)
//   - db.insert(generatedReadingTexts).values().onConflictDoUpdate()   (MISS only)
//   - db.insert(usageEvents).values()                           (MISS only)
//
// We distinguish the two SELECT shapes by call order: the FIRST select is the
// cache lookup (resolves via .limit), the SECOND is the count (resolves via the
// awaited .where). `cacheRow` and `usageCount` configure the scenarios.
// ---------------------------------------------------------------------------

let cacheRow: Record<string, unknown> | undefined;
let usageCount = 0;

const mockLimit = vi.fn(() =>
  Promise.resolve(cacheRow ? [cacheRow] : []),
);

const mockWhere = vi.fn(() => {
  // First select() call = cache lookup (chains to .limit()).
  // Second select() call = count query (awaited directly).
  const p = Promise.resolve([{ count: usageCount }]) as Promise<unknown> & {
    limit: typeof mockLimit;
  };
  p.limit = mockLimit;
  return p;
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn((..._args: unknown[]) => ({ from: mockFrom }));

const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
// `db.insert(...).values(...)` is awaited directly (usageEvents) AND chained
// into `.onConflictDoNothing()` (generatedReadingTexts). Expose both.
// The noCache path uses `.onConflictDoUpdate()` on the same chain.
const insertValuesCalls: Array<Record<string, unknown>> = [];
const mockValues = vi.fn((row: Record<string, unknown>) => {
  insertValuesCalls.push(row);
  const p = Promise.resolve() as Promise<void> & {
    onConflictDoNothing: typeof mockOnConflictDoNothing;
    onConflictDoUpdate: typeof mockOnConflictDoUpdate;
  };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  p.onConflictDoUpdate = mockOnConflictDoUpdate;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: () => mockInsert(),
    update: () => mockUpdate(),
  },
}));

vi.mock('@language-drill/db', () => ({
  // Auth middleware inserts a user row; harmless with the insert mock above.
  users: { id: 'id' },
  generatedReadingTexts: {
    cacheKey: 'cache_key',
    title: 'title',
    text: 'text',
    cefr: 'cefr',
    difficultyScore: 'difficulty_score',
    hitCount: 'hit_count',
  },
  usageEvents: {
    userId: 'user_id',
    eventType: 'event_type',
    createdAt: 'created_at',
    metadata: 'metadata',
  },
  // Other tables imported by read.ts but unused on this route.
  readEntries: {},
  userVocabulary: {},
  vocabularyReviewState: {},
}));

const mockGenerateReadingText = vi.fn();
vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  generateReadingText: (...args: unknown[]) => mockGenerateReadingText(...args),
}));

// Deterministic plan resolution; the cap logic is exercised via `usageCount`.
vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(() => Promise.resolve('free')),
  isAdmin: vi.fn(() => false),
}));

// Global cost brake. `capacityVerdict` configures the scenario; beforeEach
// resets it to 'ok' so the existing tests reach the generate/return paths.
let capacityVerdict: 'ok' | 'killed' | 'capped' = 'ok';
const mockCheckGlobalCapacity = vi.fn(
  (_args: { plan: string; admin: boolean }) => Promise.resolve(capacityVerdict),
);
vi.mock('../usage/global-capacity', () => ({
  checkGlobalCapacity: (args: { plan: string; admin: boolean }) =>
    mockCheckGlobalCapacity(args),
}));

// For noCache tests: expose a chained `.onConflictDoUpdate` mock.
const mockOnConflictDoUpdate = vi.fn(() => Promise.resolve());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

const authEnv = {
  event: {
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user_123' } } },
    },
  },
};

const validBody = {
  language: 'ES',
  cefr: 'B1',
  length: 'short',
  topic: 'A day at the market',
};

function buildRequest(app: Hono, body: unknown) {
  return app.request(
    '/read/generate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    authEnv,
  );
}

describe('POST /read/generate', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheRow = undefined;
    usageCount = 0;
    capacityVerdict = 'ok';
    insertValuesCalls.length = 0;
    // ANTHROPIC_API_KEY is read at module scope from process.env; set it before
    // the dynamic import so the generate path is reachable.
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('cache MISS → generates, 200, fromCache false, meters one text_generation event', async () => {
    cacheRow = undefined;
    usageCount = 0;
    mockGenerateReadingText.mockResolvedValue({
      title: 'Un día en el mercado',
      text: 'El mercado estaba lleno de gente.',
      difficultyScore: 0.08,
      regenerated: false,
      runsHard: false,
    });

    const res = await buildRequest(app, validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body).toMatchObject({
      title: 'Un día en el mercado',
      text: 'El mercado estaba lleno de gente.',
      cefr: 'B1',
      difficultyScore: 0.08,
      fromCache: false,
      runsHard: false,
    });

    expect(mockGenerateReadingText).toHaveBeenCalledTimes(1);
    expect(mockGenerateReadingText).toHaveBeenCalledWith(expect.anything(), {
      language: 'ES',
      cefr: 'B1',
      length: 'short',
      topic: 'A day at the market',
    });

    // A usageEvents insert with eventType text_generation occurred.
    const usageInsert = insertValuesCalls.find(
      (r) => r.eventType === 'text_generation',
    );
    expect(usageInsert).toBeDefined();
    expect(usageInsert).toMatchObject({
      userId: 'user_123',
      eventType: 'text_generation',
    });

    // The generated passage was persisted (idempotent on cacheKey).
    const passageInsert = insertValuesCalls.find((r) => 'cacheKey' in r);
    expect(passageInsert).toMatchObject({
      title: 'Un día en el mercado',
      difficultyScore: 0.08,
      prompt: 'A day at the market',
    });
    // Auth middleware still uses onConflictDoNothing for the user upsert;
    // the passage insert now uses onConflictDoUpdate (idempotent on cacheKey).
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('cache HIT → 200, fromCache true, no generation, no usage insert', async () => {
    cacheRow = {
      title: 'Cached title',
      text: 'Cached body text.',
      cefr: 'B1',
      difficultyScore: 0.2,
    };

    const res = await buildRequest(app, validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body).toEqual({
      title: 'Cached title',
      text: 'Cached body text.',
      cefr: 'B1',
      difficultyScore: 0.2,
      fromCache: true,
      // 0.2 > READING_TOO_HARD_THRESHOLD (0.15)
      runsHard: true,
    });

    expect(mockGenerateReadingText).not.toHaveBeenCalled();
    // hit_count bumped, nothing metered.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const usageInsert = insertValuesCalls.find(
      (r) => r.eventType === 'text_generation',
    );
    expect(usageInsert).toBeUndefined();
    // A cache HIT is free — the global brake must never be consulted.
    expect(mockCheckGlobalCapacity).not.toHaveBeenCalled();
  });

  it('global capacity denied on a miss → 503 GLOBAL_CAPACITY, no generation, no usage insert', async () => {
    cacheRow = undefined;
    usageCount = 0;
    // Below the per-user cap (free limit is 20) so the denial is attributable
    // to the global brake, not the per-user cap.
    capacityVerdict = 'killed';

    const res = await buildRequest(app, validBody);
    expect(res.status).toBe(503);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('GLOBAL_CAPACITY');

    // The brake ran before the per-user cap with the resolved plan + admin flag.
    expect(mockCheckGlobalCapacity).toHaveBeenCalledWith({
      plan: 'free',
      admin: false,
    });
    expect(mockGenerateReadingText).not.toHaveBeenCalled();
    const usageInsert = insertValuesCalls.find(
      (r) => r.eventType === 'text_generation',
    );
    expect(usageInsert).toBeUndefined();
  });

  it('daily limit reached on a miss → 429 RATE_LIMIT_EXCEEDED, no generation', async () => {
    cacheRow = undefined;
    // free plan limit for text_generation is 20.
    usageCount = 20;

    const res = await buildRequest(app, validBody);
    expect(res.status).toBe(429);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');

    expect(mockGenerateReadingText).not.toHaveBeenCalled();
    const usageInsert = insertValuesCalls.find(
      (r) => r.eventType === 'text_generation',
    );
    expect(usageInsert).toBeUndefined();
  });

  it('forces a fresh generation when noCache is true (ignores cache)', async () => {
    // Arrange: cache lookup would return a row, but noCache must skip it.
    cacheRow = {
      title: 'Cached title',
      text: 'Cached body text.',
      cefr: 'A2',
      difficultyScore: 0.05,
    };
    usageCount = 0;
    mockGenerateReadingText.mockResolvedValue({
      title: 'Fresh title',
      text: 'Brand new text.',
      difficultyScore: 0.07,
      regenerated: true,
      runsHard: false,
    });

    const res = await buildRequest(app, {
      language: 'TR',
      cefr: 'A2',
      length: 'short',
      topic: 'a cat',
      noCache: true,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // Must return fresh generation, not cached values.
    expect(body).toMatchObject({
      title: 'Fresh title',
      text: 'Brand new text.',
      fromCache: false,
      difficultyScore: 0.07,
    });

    // Generation ran despite the cache row being present.
    expect(mockGenerateReadingText).toHaveBeenCalledTimes(1);

    // A usageEvents insert with eventType text_generation occurred.
    const usageInsert = insertValuesCalls.find(
      (r) => r.eventType === 'text_generation',
    );
    expect(usageInsert).toBeDefined();
    expect(usageInsert).toMatchObject({
      userId: 'user_123',
      eventType: 'text_generation',
    });

    // The passage was upserted (onConflictDoUpdate called, not onConflictDoNothing only).
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);

    // Global-capacity check must run on the noCache path (it's a miss that generates).
    expect(mockCheckGlobalCapacity).toHaveBeenCalled();
  });

  it('over-long topic → 400 VALIDATION_ERROR, no db or AI calls', async () => {
    const res = await buildRequest(app, {
      ...validBody,
      topic: 'x'.repeat(201),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');

    expect(mockGenerateReadingText).not.toHaveBeenCalled();
    // No cache lookup / count select for the generate route (auth middleware
    // does not select), and no inserts beyond the auth user upsert.
    expect(mockSelect).not.toHaveBeenCalled();
    expect(
      insertValuesCalls.find((r) => r.eventType === 'text_generation'),
    ).toBeUndefined();
  });
});
