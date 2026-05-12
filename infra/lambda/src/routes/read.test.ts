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

const mockWhere = vi.fn(() => ({
  orderBy: mockOrderBy,
  limit: mockLimit,
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
