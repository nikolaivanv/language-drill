import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
// Read paths chain `.where().limit()` (single-entry / bank lookups) or
// `.where().orderBy().limit()` (list endpoint). `mockLimit` is the awaited
// terminator in both cases.
//
// Write paths run through `db.transaction(...)` for the entry / bank routes;
// the auth middleware's user-upsert goes through `db.insert(users).values(...)`
// directly, which is covered by `mockInsert` / `mockValues`.
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));

// `.where()` is both a chain-continuation (list/single-entry routes call
// `.orderBy()`/`.limit()` on it) AND an awaited terminator (no `.limit()`) for
// COUNT-style queries. So the return value is a thenable carrying
// `.orderBy`/`.limit`. `whereResolved` is what an awaited `.where()` resolves
// to (the COUNT row); chains that continue to `.limit()` ignore it and use
// `mockLimit` instead.
let whereResolved: unknown = [{ count: 0 }];
const mockWhere = vi.fn(() => {
  const p = Promise.resolve(whereResolved) as Promise<unknown> & {
    orderBy: typeof mockOrderBy;
    limit: typeof mockLimit;
  };
  p.orderBy = mockOrderBy;
  p.limit = mockLimit;
  return p;
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockReturning = vi.fn();
// `.onConflictDoUpdate()` is awaited directly by the entry/bank routes but
// chained into `.returning()` by `POST /read/vocabulary`; expose both.
const mockOnConflictDoUpdate = vi.fn(() => {
  const p = Promise.resolve() as Promise<void> & {
    returning: typeof mockReturning;
  };
  p.returning = mockReturning;
  return p;
});
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

// UPDATE chain — `db.update(t).set({...}).where(...)`. No read route mutates via
// UPDATE anymore (the span_annotations write-back moved to the annotate-stream
// Lambda); retained so the vocabulary independence test can assert it is never
// called.
const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

// DELETE chain — `db.delete(t).where(...).returning({id})` (vocabulary undo).
const mockDeleteReturning = vi.fn();
const mockDeleteWhere = vi.fn(() => ({ returning: mockDeleteReturning }));
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

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
    update: () => mockUpdate(),
    delete: () => mockDelete(),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  readEntries: {
    id: 'id',
    userId: 'user_id',
    language: 'language',
    title: 'title',
    source: 'source',
    text: 'text',
    flaggedWords: 'flagged_words',
    bank: 'bank',
    spanAnnotations: 'span_annotations',
    pastedAt: 'pasted_at',
  },
  userVocabulary: {
    id: 'id',
    userId: 'user_id',
    language: 'language',
    word: 'word',
    lemma: 'lemma',
    source: 'source',
    sourceReadEntryId: 'source_read_entry_id',
    pos: 'pos',
    gloss: 'gloss',
    exampleSentence: 'example_sentence',
    frequencyRank: 'frequency_rank',
    cefrBand: 'cefr_band',
    card: 'card',
    addedAt: 'added_at',
  },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  usageEvents: {
    userId: 'user_id',
    eventType: 'event_type',
    createdAt: 'created_at',
    metadata: 'metadata',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

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

// ---------------------------------------------------------------------------
// Helpers for the deep-span / vocabulary routes
// ---------------------------------------------------------------------------
// The auth middleware fires `db.insert(users).values({id,email})` on every
// request, so `mockValues` always carries that call too. We pick out the
// route's own inserts by row shape.
// ---------------------------------------------------------------------------

// `mockValues` is declared with no params, so `mock.calls` is typed as empty
// tuples — read the first arg through an `unknown[][]` cast.
function valuesArgs(): Array<Record<string, unknown>> {
  return (mockValues.mock.calls as unknown as unknown[][]).map(
    (call) => call[0] as Record<string, unknown>,
  );
}

function vocabInsertCalls(): Array<Record<string, unknown>> {
  return valuesArgs().filter(
    (arg) =>
      arg != null && typeof arg === 'object' && 'word' in arg && 'card' in arg,
  );
}

const authEnv = {
  event: {
    requestContext: {
      requestId: 'req-test',
      authorizer: { jwt: { claims: { sub: 'user_123' } } },
    },
  },
};

// Minimal valid DeepCards (parsed by the REAL DeepCardSchema — `@language-drill/shared`
// is not mocked here).
const wordCard = {
  type: 'word' as const,
  surface: 'casa',
  lemma: 'casa',
  pos: 'noun',
  contextualSense: 'house (here: the family home)',
  definition: 'edificio para vivir',
  definitionLabel: 'Español',
  cefr: 'A1' as const,
  freq: 120,
};

const phraseCard = {
  type: 'phrase' as const,
  surface: 'de repente',
  literal: 'of sudden',
  idiomaticMeaning: 'suddenly',
  register: 'neutral',
};

const sentenceCard = {
  type: 'sentence' as const,
  surface: 'La casa es bonita.',
  translation: 'The house is pretty.',
  breakdown: [{ chunk: 'La casa', role: 'subject', note: 'definite NP' }],
  grammarNotes: ['ser + adjective'],
};

// ---------------------------------------------------------------------------
// POST /read/vocabulary — save a deep card to the bank (Req 8)
// ---------------------------------------------------------------------------

describe('POST /read/vocabulary', () => {
  let app: Hono;

  const entryUuid = '44444444-4444-4444-4444-444444444444';

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    whereResolved = [{ count: 0 }];
    mockReturning.mockReset();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('saves a word card: persists the lexical core + card snapshot, returns { id }', async () => {
    mockReturning.mockResolvedValueOnce([{ id: 'vocab-1' }]);

    const res = await app.request(
      '/read/vocabulary',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', card: wordCard, sourceReadEntryId: entryUuid }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'vocab-1' });

    const rows = vocabInsertCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'user_123',
      language: 'ES',
      word: 'casa',
      lemma: 'casa',
      source: 'reading',
      sourceReadEntryId: entryUuid,
      pos: 'noun',
      gloss: 'house (here: the family home)',
      frequencyRank: 120,
      cefrBand: 'A1',
      card: wordCard,
    });

    // Independence (Req 11.7): saving to vocabulary never touches an entry's
    // span_annotations.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saves a phrase card: derives lemma←citation??surface, pos="phrase", null freq/cefr', async () => {
    mockReturning.mockResolvedValueOnce([{ id: 'vocab-2' }]);

    const res = await app.request(
      '/read/vocabulary',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', card: phraseCard }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'vocab-2' });

    const rows = vocabInsertCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      word: 'de repente',
      lemma: 'de repente', // no citation → surface
      pos: 'phrase',
      gloss: 'suddenly',
      exampleSentence: '',
      frequencyRank: null,
      cefrBand: null,
      sourceReadEntryId: null,
      card: phraseCard,
    });
  });

  it('rejects a sentence card with 400 (Req 8.6) and writes nothing', async () => {
    const res = await app.request(
      '/read/vocabulary',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', card: sentenceCard }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
    expect(vocabInsertCalls()).toHaveLength(0);
  });

  it('returns 400 VALIDATION_ERROR for a malformed card (bad type)', async () => {
    const res = await app.request(
      '/read/vocabulary',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ES', card: { type: 'bogus' } }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
    expect(vocabInsertCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /read/vocabulary/:id — undo a save (Req 8.5)
// ---------------------------------------------------------------------------

describe('DELETE /read/vocabulary/:id', () => {
  let app: Hono;

  const validUuid = '55555555-5555-5555-5555-555555555555';

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    whereResolved = [{ count: 0 }];
    mockDeleteReturning.mockReset();
    const mod = await import('./read');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('removes the owned record and returns { id }', async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: validUuid }]);

    const res = await app.request(
      `/read/vocabulary/${validUuid}`,
      { method: 'DELETE' },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: validUuid });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('returns 404 VOCAB_NOT_FOUND + no-store when nothing was deleted (cross-user/unknown)', async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);

    const res = await app.request(
      `/read/vocabulary/${validUuid}`,
      { method: 'DELETE' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(((await res.json()) as AnyJson).code).toBe('VOCAB_NOT_FOUND');
  });

  it('returns 404 VOCAB_NOT_FOUND + no-store for a malformed UUID (no DB call)', async () => {
    const res = await app.request(
      '/read/vocabulary/not-a-uuid',
      { method: 'DELETE' },
      authEnv,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(((await res.json()) as AnyJson).code).toBe('VOCAB_NOT_FOUND');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
