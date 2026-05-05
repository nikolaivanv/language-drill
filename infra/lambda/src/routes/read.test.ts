import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
// Two read paths in `POST /read/annotate`:
//   1) usage_events count   — `db.select(...).from(...).where(...)` (no .limit)
//   2) userLanguageProfiles — `db.select(...).from(...).where(...).limit(1)`
// `mockSelectAwait` powers (1) by making `where()` thenable; `mockLimit`
// powers (2). Promise.all queues are filled in the order Promise.all fires
// them: first the count, then the profile.
//
// Insert path: `db.insert(usageEvents).values({...})` is awaited directly,
// so `mockValues` returns a Promise. Tasks 13b will append cases that hit
// the transaction / `.returning()` / `.onConflictDoUpdate()` chains.
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));

const mockSelectAwait = vi.fn();
const mockWhere = vi.fn(() => ({
  orderBy: mockOrderBy,
  limit: mockLimit,
  then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    return Promise.resolve(mockSelectAwait()).then(resolve, reject);
  },
}));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockOnConflictDoUpdate = vi.fn(() => Promise.resolve());
const mockReturning = vi.fn();
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & {
    onConflictDoNothing: typeof mockOnConflictDoNothing;
    onConflictDoUpdate: typeof mockOnConflictDoUpdate;
    returning: typeof mockReturning;
  };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  p.onConflictDoUpdate = mockOnConflictDoUpdate;
  p.returning = mockReturning;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

// ---------------------------------------------------------------------------
// Transaction mock — supports two write paths:
//   POST /read/entries        — tx.insert(readEntries).values({...}).returning(...)
//                               + tx.insert(userVocabulary).values([...]).onConflictDoUpdate(...)
//   PUT  /read/entries/:id/bank — tx.update(readEntries).set({...}).where(...)
//                                  + tx.insert(userVocabulary).values([...]).onConflictDoUpdate(...)
// We distinguish read_entries vs user_vocabulary inserts by row shape:
// read_entries inserts pass a single object (or single-row array), vocab
// inserts always pass an array.
// ---------------------------------------------------------------------------

type EntryReturnRow = { id: string; pastedAt: Date };

const txCapture = {
  entryInsertValues: [] as Array<Record<string, unknown>>,
  entryReturning: [] as Array<EntryReturnRow[]>,
  vocabInsertRows: [] as Array<Array<Record<string, unknown>>>,
  vocabUpsertSets: [] as Array<Record<string, unknown>>,
  entryUpdateBank: [] as Array<string[]>,
};

function resetTxCapture(): void {
  txCapture.entryInsertValues = [];
  txCapture.entryReturning = [];
  txCapture.vocabInsertRows = [];
  txCapture.vocabUpsertSets = [];
  txCapture.entryUpdateBank = [];
}

const mockTransaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
  const tx = {
    insert: (_table: unknown) => ({
      values: (rowsOrRow: unknown) => {
        if (Array.isArray(rowsOrRow)) {
          txCapture.vocabInsertRows.push(
            rowsOrRow as Array<Record<string, unknown>>,
          );
          return {
            onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
              txCapture.vocabUpsertSets.push(args.set);
              return Promise.resolve();
            },
          };
        }
        txCapture.entryInsertValues.push(
          rowsOrRow as Record<string, unknown>,
        );
        return {
          returning: () =>
            Promise.resolve(
              txCapture.entryReturning.shift() ?? [
                {
                  id: 'generated-uuid',
                  pastedAt: new Date('2026-05-04T00:00:00.000Z'),
                },
              ],
            ),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (payload: { bank: string[] }) => {
        txCapture.entryUpdateBank.push(payload.bank);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return cb(tx);
});

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  usageEvents: {
    userId: 'user_id',
    eventType: 'event_type',
    createdAt: 'created_at',
  },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  readEntries: {
    id: 'id',
    userId: 'user_id',
    language: 'language',
    title: 'title',
    source: 'source',
    text: 'text',
    flaggedWords: 'flagged_words',
    bank: 'bank',
    pastedAt: 'pasted_at',
  },
  userVocabulary: {
    userId: 'user_id',
    language: 'language',
    word: 'word',
  },
}));

const mockAnnotateText = vi.fn();
vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  annotateText: (...args: unknown[]) => mockAnnotateText(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// POST /read/annotate
// ---------------------------------------------------------------------------

describe('POST /read/annotate', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const unauthEnv = { event: { requestContext: {} } };

  const sampleFlagged = {
    aldea: {
      lemma: 'aldea',
      pos: 'noun',
      gloss: 'small village',
      example: 'Visitamos la aldea ayer.',
      freq: 4200,
      cefr: 'B2' as const,
    },
    indiferencia: {
      lemma: 'indiferencia',
      pos: 'noun',
      gloss: 'indifference',
      example: 'Su indiferencia me sorprendió.',
      freq: 5800,
      cefr: 'B2' as const,
    },
  };

  const passage =
    'La aldea recibió al pintor con cierta indiferencia.';

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      unauthEnv,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
    expect(mockAnnotateText).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when text is missing', async () => {
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockAnnotateText).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when text exceeds 2,000 characters', async () => {
    const tooLong = 'a'.repeat(2001);
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tooLong, language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockAnnotateText).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when text is whitespace-only (empty after trim)', async () => {
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '    \n\t  ', language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 UNSUPPORTED_LANGUAGE when language=EN', async () => {
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'EN' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('UNSUPPORTED_LANGUAGE');
    expect(mockAnnotateText).not.toHaveBeenCalled();
    // The auth middleware's user-upsert is the only allowed insert before EN-rejection.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 400 VALIDATION_ERROR for an unrecognized language code', async () => {
    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'FR' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Rate limiting (Req 5.6)
  // -------------------------------------------------------------------------

  it('returns 429 RATE_LIMIT_EXCEEDED when 50 mixed usage rows exist in the rolling 24h window', async () => {
    // count() of usage_events (where-thenable) → cap reached. Mix of
    // ai_evaluation + read_annotation rows is the realistic shape; the
    // server-side IN clause counts both event types together.
    mockSelectAwait.mockResolvedValueOnce([{ count: 50 }]);
    // userLanguageProfiles lookup runs in parallel via Promise.all but should
    // not affect the rate-limit decision; queue something benign.
    mockLimit.mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mockAnnotateText).not.toHaveBeenCalled();
    // Only the auth middleware user-upsert is allowed when the cap is hit.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('returns 429 even if the limit is exceeded above 50', async () => {
    mockSelectAwait.mockResolvedValueOnce([{ count: 51 }]);
    mockLimit.mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);

    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(429);
  });

  // -------------------------------------------------------------------------
  // Claude failure (Req 5.7)
  // -------------------------------------------------------------------------

  it('returns 502 AI_UNAVAILABLE when Claude throws, and writes zero usage rows', async () => {
    mockSelectAwait.mockResolvedValueOnce([{ count: 0 }]);
    mockLimit.mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);
    mockAnnotateText.mockRejectedValueOnce(new Error('upstream timeout'));

    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('AI_UNAVAILABLE');
    // Only the auth middleware user-upsert. The route MUST NOT insert into
    // usage_events when Claude fails (Requirement 5.7).
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Happy path (Req 5.1, 5.10)
  // -------------------------------------------------------------------------

  it('returns 200 with flagged + calibration AND inserts one usage_events row on success', async () => {
    mockSelectAwait.mockResolvedValueOnce([{ count: 5 }]);
    // Profile is B1 — calibration.top should be 3000 per READ_CEFR_TOP_RANK.
    mockLimit.mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]);
    mockAnnotateText.mockResolvedValueOnce({ flagged: sampleFlagged });

    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.flagged).toEqual(sampleFlagged);
    expect(body.calibration).toEqual({ cefr: 'B1', top: 3000 });

    // Exactly two inserts: 1) auth user-upsert, 2) usage_events row.
    expect(mockInsert).toHaveBeenCalledTimes(2);
    // The usage_events insert is the second .values() call.
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'read_annotation',
        userId: 'user_123',
        metadata: expect.objectContaining({
          language: 'ES',
          textLength: passage.length,
          flaggedCount: 2,
        }),
      }),
    );
    expect(mockAnnotateText).toHaveBeenCalledTimes(1);
  });

  it('passes the passage and the user proficiency level to annotateText', async () => {
    mockSelectAwait.mockResolvedValueOnce([{ count: 0 }]);
    mockLimit.mockResolvedValueOnce([{ proficiencyLevel: 'A2' }]);
    mockAnnotateText.mockResolvedValueOnce({ flagged: {} });

    await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'ES' }),
      },
      authEnv,
    );

    expect(mockAnnotateText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: passage,
        language: 'ES',
        proficiencyLevel: 'A2',
        topRank: 1500,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Profile fallback (Req 5.8)
  // -------------------------------------------------------------------------

  it('falls back to B1 calibration when no userLanguageProfiles row exists', async () => {
    mockSelectAwait.mockResolvedValueOnce([{ count: 0 }]);
    // No profile row for (user, language)
    mockLimit.mockResolvedValueOnce([]);
    mockAnnotateText.mockResolvedValueOnce({ flagged: {} });

    const res = await app.request(
      '/read/annotate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage, language: 'DE' }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.calibration).toEqual({ cefr: 'B1', top: 3000 });
    expect(mockAnnotateText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proficiencyLevel: 'B1',
        topRank: 3000,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /read/entries — persist annotated passage + bank (Req 8.1, 9.3, 12.3)
// ---------------------------------------------------------------------------

describe('POST /read/entries', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const validFlag = {
    aldea: {
      lemma: 'aldea',
      pos: 'noun',
      gloss: 'small village',
      example: 'Visitamos la aldea ayer.',
      freq: 4200,
      cefr: 'B2' as const,
    },
    indiferencia: {
      lemma: 'indiferencia',
      pos: 'noun',
      gloss: 'indifference',
      example: 'Su indiferencia me sorprendió.',
      freq: 5800,
      cefr: 'B2' as const,
    },
  };

  const validBody = {
    language: 'ES',
    title: 'Pintor en la aldea',
    source: 'El País',
    text: 'La aldea recibió al pintor con cierta indiferencia.',
    flagged: validFlag,
    bank: ['aldea'],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 201 with id+pastedAt and writes to both read_entries and user_vocabulary atomically', async () => {
    const fixedDate = new Date('2026-05-04T08:00:00.000Z');
    txCapture.entryReturning.push([{ id: 'entry-uuid-1', pastedAt: fixedDate }]);

    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      authEnv,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as AnyJson;
    expect(body).toEqual({
      id: 'entry-uuid-1',
      pastedAt: fixedDate.toISOString(),
    });

    // Both writes happen inside a single transaction.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(txCapture.entryInsertValues).toHaveLength(1);
    expect(txCapture.entryInsertValues[0]).toMatchObject({
      userId: 'user_123',
      language: 'ES',
      title: 'Pintor en la aldea',
      source: 'El País',
      text: validBody.text,
      flaggedWords: validFlag,
      bank: ['aldea'],
    });

    // Bulk vocab upsert with one row per bank entry.
    expect(txCapture.vocabInsertRows).toHaveLength(1);
    expect(txCapture.vocabInsertRows[0]).toHaveLength(1);
    expect(txCapture.vocabInsertRows[0][0]).toMatchObject({
      userId: 'user_123',
      language: 'ES',
      word: 'aldea',
      lemma: 'aldea',
      source: 'reading',
      sourceReadEntryId: 'entry-uuid-1',
      pos: 'noun',
      gloss: 'small village',
      exampleSentence: 'Visitamos la aldea ayer.',
      frequencyRank: 4200,
      cefrBand: 'B2',
    });
    // The upsert SET clause was supplied (idempotent re-add semantics).
    expect(txCapture.vocabUpsertSets).toHaveLength(1);
  });

  it('persists multiple bank words in one bulk vocab upsert', async () => {
    txCapture.entryReturning.push([
      { id: 'entry-uuid-2', pastedAt: new Date() },
    ]);

    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, bank: ['aldea', 'indiferencia'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(201);
    expect(txCapture.vocabInsertRows[0]).toHaveLength(2);
    const words = txCapture.vocabInsertRows[0].map((r) => r.word);
    expect(words).toEqual(['aldea', 'indiferencia']);
  });

  it('scopes the entry to the request language (cross-language safety)', async () => {
    txCapture.entryReturning.push([
      { id: 'entry-uuid-3', pastedAt: new Date() },
    ]);

    const deBody = {
      ...validBody,
      language: 'DE',
      text: 'Der Wirtschaftsaufschwung überraschte die Analysten.',
      flagged: {
        wirtschaftsaufschwung: {
          lemma: 'Wirtschaftsaufschwung',
          pos: 'noun',
          gloss: 'economic upswing',
          example: 'Der Wirtschaftsaufschwung war stark.',
          freq: 8800,
          cefr: 'C1' as const,
        },
      },
      bank: ['wirtschaftsaufschwung'],
    };

    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deBody),
      },
      authEnv,
    );

    expect(res.status).toBe(201);
    expect(txCapture.entryInsertValues[0].language).toBe('DE');
    expect(txCapture.vocabInsertRows[0][0].language).toBe('DE');
  });

  it('returns 400 VALIDATION_ERROR when bank is empty', async () => {
    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, bank: [] }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when a bank entry is not a key of flagged', async () => {
    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          bank: ['aldea', 'unknown_word'],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual({ word: 'unknown_word' });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when text exceeds 2,000 characters', async () => {
    const res = await app.request(
      '/read/entries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          text: 'a'.repeat(2001),
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /read/entries — list endpoint (Req 10.1)
// ---------------------------------------------------------------------------

describe('GET /read/entries', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns the entries list with summary fields for the active language', async () => {
    const pastedAt1 = new Date('2026-05-04T10:00:00.000Z');
    const pastedAt2 = new Date('2026-05-03T10:00:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: 'entry-1',
        title: 'most recent',
        source: '',
        pastedAt: pastedAt1,
        preview: 'short text',
        savedCount: 2,
        flaggedCount: 5,
      },
      {
        id: 'entry-2',
        title: 'older',
        source: 'BBC',
        pastedAt: pastedAt2,
        preview: 'a'.repeat(120),
        savedCount: 0,
        flaggedCount: 3,
      },
    ]);

    const res = await app.request(
      '/read/entries?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toEqual({
      id: 'entry-1',
      title: 'most recent',
      source: '',
      pastedAt: pastedAt1.toISOString(),
      preview: 'short text',
      savedCount: 2,
      flaggedCount: 5,
    });
    // The 120-char preview round-trips intact (server SQL truncates to
    // READ_PREVIEW_CHARS — the route returns whatever the column query
    // produces).
    expect(body.entries[1].preview).toHaveLength(120);
  });

  it('caps the SELECT at READ_HISTORY_LIMIT (50)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await app.request('/read/entries?language=ES', { method: 'GET' }, authEnv);

    expect(mockLimit).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  it('uses orderBy (pasted_at DESC, id DESC) on the SELECT chain', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await app.request('/read/entries?language=ES', { method: 'GET' }, authEnv);

    expect(mockOrderBy).toHaveBeenCalledTimes(1);
  });

  it('returns 400 VALIDATION_ERROR when language query param is missing', async () => {
    const res = await app.request('/read/entries', { method: 'GET' }, authEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for language=EN', async () => {
    const res = await app.request(
      '/read/entries?language=EN',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /read/entries/:id — single-entry endpoint (Req 10.2, 9.5)
// ---------------------------------------------------------------------------

describe('GET /read/entries/:id', () => {
  let app: Hono;

  const validUuid = '11111111-1111-1111-1111-111111111111';

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 200 with the full entry shape on a hit', async () => {
    const pastedAt = new Date('2026-05-04T08:00:00.000Z');
    mockLimit.mockResolvedValueOnce([
      {
        id: validUuid,
        language: 'ES',
        title: 'aldea',
        source: '',
        text: 'La aldea ...',
        flaggedWords: { aldea: { lemma: 'aldea', pos: 'noun', gloss: '', example: '', freq: 1, cefr: 'B2' } },
        bank: ['aldea'],
        pastedAt,
      },
    ]);

    const res = await app.request(
      `/read/entries/${validUuid}`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body).toEqual({
      id: validUuid,
      language: 'ES',
      title: 'aldea',
      source: '',
      text: 'La aldea ...',
      flaggedWords: { aldea: { lemma: 'aldea', pos: 'noun', gloss: '', example: '', freq: 1, cefr: 'B2' } },
      bank: ['aldea'],
      pastedAt: pastedAt.toISOString(),
    });
  });

  it('returns 404 ENTRY_NOT_FOUND + Cache-Control: no-store when the entry is owned by another user', async () => {
    // Cross-user is indistinguishable from "no row at all" because the WHERE
    // predicate filters by user_id; both yield an empty array.
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      `/read/entries/${validUuid}`,
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('ENTRY_NOT_FOUND');
  });

  it('returns 404 ENTRY_NOT_FOUND + Cache-Control: no-store for a malformed UUID (no DB call)', async () => {
    const res = await app.request(
      '/read/entries/not-a-uuid',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('ENTRY_NOT_FOUND');
    expect(mockLimit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT /read/entries/:id/bank — bank update endpoint (Req 9.1–9.6)
// ---------------------------------------------------------------------------

describe('PUT /read/entries/:id/bank', () => {
  let app: Hono;

  const validUuid = '22222222-2222-2222-2222-222222222222';

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const flaggedFixture = {
    aldea: {
      lemma: 'aldea',
      pos: 'noun',
      gloss: 'small village',
      example: 'Visitamos la aldea.',
      freq: 4200,
      cefr: 'B2',
    },
    indiferencia: {
      lemma: 'indiferencia',
      pos: 'noun',
      gloss: 'indifference',
      example: 'Su indiferencia me sorprendió.',
      freq: 5800,
      cefr: 'B2',
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('upserts only the added words and updates the entry bank in one transaction', async () => {
    // Pre-check SELECT: entry exists with bank=['aldea'] (so 'aldea' is the
    // pre-existing word; only 'indiferencia' counts as added).
    mockLimit.mockResolvedValueOnce([
      {
        flaggedWords: flaggedFixture,
        bank: ['aldea'],
        language: 'ES',
      },
    ]);

    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: ['aldea', 'indiferencia'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body).toEqual({
      id: validUuid,
      bank: ['aldea', 'indiferencia'],
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The entry's bank column is updated with the FULL new bank, not a delta.
    expect(txCapture.entryUpdateBank).toEqual([['aldea', 'indiferencia']]);
    // Vocab upsert receives ONLY the added word — Requirement 9.3.
    expect(txCapture.vocabInsertRows).toHaveLength(1);
    expect(txCapture.vocabInsertRows[0]).toHaveLength(1);
    expect(txCapture.vocabInsertRows[0][0]).toMatchObject({
      userId: 'user_123',
      language: 'ES',
      word: 'indiferencia',
      lemma: 'indiferencia',
      source: 'reading',
      sourceReadEntryId: validUuid,
    });
  });

  it('does NOT delete vocab rows for removed words (Req 9.3)', async () => {
    // Old bank had 2 words, new bank has only 1.
    mockLimit.mockResolvedValueOnce([
      {
        flaggedWords: flaggedFixture,
        bank: ['aldea', 'indiferencia'],
        language: 'ES',
      },
    ]);

    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: ['aldea'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    // Bank column updated to the new (shorter) array.
    expect(txCapture.entryUpdateBank).toEqual([['aldea']]);
    // CRITICAL: zero new vocab inserts (no upsert, no delete) — vocab rows
    // for 'indiferencia' remain in user_vocabulary.
    expect(txCapture.vocabInsertRows).toHaveLength(0);
  });

  it('supports clear-bank (Req 8.8): empty array updates the entry, no vocab writes', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        flaggedWords: flaggedFixture,
        bank: ['aldea', 'indiferencia'],
        language: 'ES',
      },
    ]);

    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: [] }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(txCapture.entryUpdateBank).toEqual([[]]);
    expect(txCapture.vocabInsertRows).toHaveLength(0);
  });

  it('returns 404 ENTRY_NOT_FOUND + Cache-Control: no-store for cross-user entry', async () => {
    // Entry exists but is owned by someone else — WHERE filter yields no row.
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: ['aldea'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('ENTRY_NOT_FOUND');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 UNKNOWN_FLAGGED_WORD when the new bank contains a word not in flagged_words', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        flaggedWords: flaggedFixture,
        bank: ['aldea'],
        language: 'ES',
      },
    ]);

    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: ['aldea', 'no_such_word'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('UNKNOWN_FLAGGED_WORD');
    expect(body.details).toEqual({ word: 'no_such_word' });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 + Cache-Control: no-store for a malformed UUID (no DB call)', async () => {
    const res = await app.request(
      '/read/entries/not-a-uuid/bank',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: ['aldea'] }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('ENTRY_NOT_FOUND');
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a malformed body (bank not an array)', async () => {
    const res = await app.request(
      `/read/entries/${validUuid}/bank`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: 'not an array' }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockLimit).not.toHaveBeenCalled();
  });
});
