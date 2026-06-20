import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { CefrLevel, Language } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
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

const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

// ---------------------------------------------------------------------------
// Update mock — bare db.update(...).set(...).where(...).returning() chain
// Default: returns one full preferences row; override per-test for the 404 case.
// ---------------------------------------------------------------------------

const mockUpdateReturning = vi.fn(() => Promise.resolve([
  {
    primaryLanguage: 'ES',
    goals: ['vocab'],
    dailyMinutes: 30,
    gentleNudges: true,
    notes: '',
  },
]));
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

// ---------------------------------------------------------------------------
// Transaction mock — captures every tx call so DB-level assertions are
// straightforward. The route does:
//   tx.delete(userLanguageProfiles).where(...)
//   tx.insert(userLanguageProfiles).values(rows).returning(cols)
//   tx.insert(userPreferences).values(prefs).onConflictDoUpdate({ ... }).returning(cols)
// ---------------------------------------------------------------------------

type CapturedProfileRow = {
  userId: string;
  language: string;
  proficiencyLevel: string;
  assessedAt: Date;
};

type CapturedPreferences = {
  userId: string;
  primaryLanguage: string;
  dailyMinutes: number;
};

type CapturedUpsertSet = {
  primaryLanguage: string;
  updatedAt: Date;
};

type TxCapture = {
  txDeleteCalls: number;
  txInsertProfilesValues: CapturedProfileRow[][];
  txInsertPreferencesValues: CapturedPreferences[];
  txUpsertSetCalls: CapturedUpsertSet[];
  // What the mocked .returning() should yield for each call (FIFO).
  profileReturningResults: Array<Array<{ language: string; proficiencyLevel: string }>>;
};

const txCapture: TxCapture = {
  txDeleteCalls: 0,
  txInsertProfilesValues: [],
  txInsertPreferencesValues: [],
  txUpsertSetCalls: [],
  profileReturningResults: [],
};

function resetTxCapture(): void {
  txCapture.txDeleteCalls = 0;
  txCapture.txInsertProfilesValues = [];
  txCapture.txInsertPreferencesValues = [];
  txCapture.txUpsertSetCalls = [];
  txCapture.profileReturningResults = [];
}

// Distinguish profiles-table vs preferences-table inserts by the `target`
// passed to `onConflictDoUpdate` (preferences only) and by the row shape.
// The mock identifies the table by the absence/presence of `assessedAt` in
// the values payload — profile rows have it, preference rows do not.
const mockTransaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
  const tx = {
    delete: () => {
      txCapture.txDeleteCalls += 1;
      return { where: () => Promise.resolve() };
    },
    insert: () => {
      return {
        values: (rows: CapturedProfileRow[] | CapturedPreferences) => {
          // Profile inserts pass an array; preference inserts pass a single row.
          if (Array.isArray(rows)) {
            txCapture.txInsertProfilesValues.push(rows);
            return {
              returning: () =>
                Promise.resolve(
                  txCapture.profileReturningResults.shift() ??
                    rows.map((r) => ({
                      language: r.language,
                      proficiencyLevel: r.proficiencyLevel,
                    })),
                ),
            };
          }
          // Single-row preferences insert with onConflictDoUpdate.
          txCapture.txInsertPreferencesValues.push(rows);
          return {
            onConflictDoUpdate: (args: { set: CapturedUpsertSet }) => {
              txCapture.txUpsertSetCalls.push(args.set);
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return cb(tx);
});

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    delete: () => mockDelete(),
    update: () => mockUpdate(),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  userLanguageProfiles: {
    userId: 'user_id',
    language: 'language',
    proficiencyLevel: 'proficiency_level',
  },
  userPreferences: {
    userId: 'user_id',
    primaryLanguage: 'primary_language',
    goals: 'goals',
    dailyMinutes: 'daily_minutes',
    gentleNudges: 'gentle_nudges',
    notes: 'notes',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Helpers
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

type ValidBody = {
  profiles: Array<{ language: string; proficiencyLevel: string }>;
  primaryLanguage: string;
};

/**
 * Canonical "valid full payload" for PUT /profiles/languages. Every test that
 * needs a valid body builds from this helper and spreads `overrides` to
 * invalidate exactly one field. This keeps rejection tests minimal and the
 * full-payload contract authoritative in one place.
 */
function validBody(overrides: Partial<ValidBody> = {}): ValidBody {
  return {
    profiles: [
      { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
      { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
    ],
    primaryLanguage: Language.ES,
    ...overrides,
  };
}

async function putProfiles(
  app: Hono,
  body: unknown,
  env: typeof authEnv | typeof unauthEnv = authEnv,
): Promise<Response> {
  return app.request(
    '/profiles/languages',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

// ---------------------------------------------------------------------------
// GET /profiles/languages
// ---------------------------------------------------------------------------

describe('GET /profiles/languages', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./profiles');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns { profiles: [] } for user with no profiles', async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const res = await app.request('/profiles/languages', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ profiles: [] });
  });

  it('returns saved profiles after PUT', async () => {
    const savedProfiles = [
      { language: 'ES', proficiencyLevel: 'B1' },
      { language: 'DE', proficiencyLevel: 'A2' },
    ];
    mockOrderBy.mockResolvedValueOnce(savedProfiles);

    const res = await app.request('/profiles/languages', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ profiles: savedProfiles });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/profiles/languages', undefined, unauthEnv);

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

// ---------------------------------------------------------------------------
// PUT /profiles/languages
// ---------------------------------------------------------------------------

describe('PUT /profiles/languages', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./profiles');
    app = new Hono();
    app.route('/', mod.default);
  });

  // -------------------------------------------------------------------------
  // Happy paths (rewritten to send the new full payload)
  // -------------------------------------------------------------------------

  it('creates profiles for new user and returns 200 with profiles + primaryLanguage', async () => {
    const res = await putProfiles(app, {
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.ES,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json).toEqual({
      profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
      primaryLanguage: 'ES',
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(txCapture.txDeleteCalls).toBe(1);
    expect(txCapture.txInsertProfilesValues).toHaveLength(1);
  });

  it('sets assessedAt: new Date() on every inserted profile row', async () => {
    const before = Date.now();
    const res = await putProfiles(app, validBody());
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(txCapture.txInsertProfilesValues).toHaveLength(1);
    const insertedRows = txCapture.txInsertProfilesValues[0];
    expect(insertedRows).toHaveLength(2);
    for (const row of insertedRows) {
      expect(row.assessedAt).toBeInstanceOf(Date);
      const ts = row.assessedAt.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }
  });

  it('seeds dailyMinutes default on insert and only touches primaryLanguage on update', async () => {
    const res = await putProfiles(app, validBody());

    expect(res.status).toBe(200);
    expect(txCapture.txInsertPreferencesValues).toHaveLength(1);
    const inserted = txCapture.txInsertPreferencesValues[0];
    expect(inserted).toMatchObject({
      userId: 'user_123',
      primaryLanguage: Language.ES,
      dailyMinutes: 10,
    });
    // The insert values must NOT include goals/gentleNudges/notes so the
    // DB default / PATCH-set values are not overwritten.
    expect(inserted).not.toHaveProperty('goals');
    expect(inserted).not.toHaveProperty('gentleNudges');
    expect(inserted).not.toHaveProperty('notes');
    // The upsert set must only update primaryLanguage (+ updatedAt).
    expect(txCapture.txUpsertSetCalls).toHaveLength(1);
    const upsertSet = txCapture.txUpsertSetCalls[0];
    expect(upsertSet).toMatchObject({ primaryLanguage: Language.ES });
    expect(upsertSet).not.toHaveProperty('goals');
    expect(upsertSet).not.toHaveProperty('dailyMinutes');
    expect(upsertSet).not.toHaveProperty('gentleNudges');
    expect(upsertSet).not.toHaveProperty('notes');
    expect(upsertSet.updatedAt).toBeInstanceOf(Date);
  });

  it('replaces existing profiles atomically and upserts the userPreferences row on second call', async () => {
    // First PUT
    const first = await putProfiles(
      app,
      validBody({
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }],
        primaryLanguage: Language.ES,
      }),
    );
    expect(first.status).toBe(200);

    vi.clearAllMocks();
    resetTxCapture();

    // Second PUT — replaces atomically, upserts primaryLanguage only
    const second = await putProfiles(
      app,
      validBody({
        profiles: [
          { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
          { language: Language.TR, proficiencyLevel: CefrLevel.C1 },
        ],
        primaryLanguage: Language.TR,
      }),
    );

    expect(second.status).toBe(200);
    const json = (await second.json()) as AnyJson;
    expect(json).toEqual({
      profiles: [
        { language: 'DE', proficiencyLevel: 'A1' },
        { language: 'TR', proficiencyLevel: 'C1' },
      ],
      primaryLanguage: 'TR',
    });

    // Single transaction, single delete, two inserts (profiles + preferences).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(txCapture.txDeleteCalls).toBe(1);
    expect(txCapture.txInsertProfilesValues).toHaveLength(1);
    expect(txCapture.txInsertPreferencesValues).toHaveLength(1);

    // The upsert path was exercised — onConflictDoUpdate.set carries only
    // primaryLanguage (goals/dailyMinutes/gentleNudges/notes are NOT touched).
    expect(txCapture.txUpsertSetCalls).toHaveLength(1);
    const upsertSet = txCapture.txUpsertSetCalls[0];
    expect(upsertSet).toMatchObject({ primaryLanguage: 'TR' });
    expect(upsertSet.updatedAt).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------------
  // Validation rejections — each builds from validBody() with one field swapped
  // -------------------------------------------------------------------------

  it('rejects empty profiles array with 400', async () => {
    const res = await putProfiles(app, validBody({ profiles: [], primaryLanguage: Language.ES }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects EN in profiles[] with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({
        profiles: [
          { language: Language.EN, proficiencyLevel: CefrLevel.B1 },
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects more than 3 profiles with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({
        profiles: [
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
          { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
          // Fourth duplicate — exceeds max(3)
          { language: Language.ES, proficiencyLevel: CefrLevel.B1 },
        ],
        primaryLanguage: Language.ES,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate languages with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({
        profiles: [
          { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
          { language: Language.ES, proficiencyLevel: CefrLevel.A2 },
        ],
        primaryLanguage: Language.ES,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects primaryLanguage not in profiles[] with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
        primaryLanguage: Language.DE,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid CEFR level with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({
        profiles: [{ language: Language.ES, proficiencyLevel: 'D1' }],
        primaryLanguage: Language.ES,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing required field with 400 (representative: omits primaryLanguage)', async () => {
    const body = validBody();
    delete (body as Partial<ValidBody>).primaryLanguage;
    const res = await putProfiles(app, body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as AnyJson;
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it('returns 401 for unauthenticated requests', async () => {
    const res = await putProfiles(app, validBody(), unauthEnv);

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

// ---------------------------------------------------------------------------
// GET /profiles/preferences
// ---------------------------------------------------------------------------

describe('GET /profiles/preferences', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    const mod = await import('./profiles');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns documented defaults when no row exists', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await app.request('/profiles/preferences', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      primaryLanguage: null,
      goals: [],
      dailyMinutes: null,
      gentleNudges: true,
      notes: '',
    });
  });

  it('returns stored values when a row exists', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        userId: 'user_123',
        primaryLanguage: 'ES',
        goals: ['grammar', 'speaking'],
        dailyMinutes: 10,
        gentleNudges: false,
        notes: 'practice subjunctive',
        updatedAt: new Date(),
      },
    ]);

    const res = await app.request('/profiles/preferences', undefined, authEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      primaryLanguage: 'ES',
      goals: ['grammar', 'speaking'],
      dailyMinutes: 10,
      gentleNudges: false,
      notes: 'practice subjunctive',
    });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/profiles/preferences', undefined, unauthEnv);

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});

// ---------------------------------------------------------------------------
// PATCH /profiles/preferences
// ---------------------------------------------------------------------------

async function patchPrefs(
  app: Hono,
  body: unknown,
  env: typeof authEnv | typeof unauthEnv = authEnv,
): Promise<Response> {
  return app.request(
    '/profiles/preferences',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('PATCH /profiles/preferences', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTxCapture();
    // Re-apply the default update mock after clearAllMocks resets it.
    mockUpdateReturning.mockResolvedValue([
      {
        primaryLanguage: 'ES',
        goals: ['vocab'],
        dailyMinutes: 30,
        gentleNudges: true,
        notes: '',
      },
    ]);
    const mod = await import('./profiles');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('updates only the provided fields and returns the full preferences', async () => {
    const res = await patchPrefs(app, { dailyMinutes: 30, goals: ['vocab'] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.dailyMinutes).toBe(30);
    expect(json.goals).toEqual(['vocab']);
    // The .set() call must contain only the provided keys + updatedAt, not
    // fields that were not sent (e.g. gentleNudges, notes).
    const setArg = (mockUpdateSet.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(setArg).toHaveProperty('dailyMinutes', 30);
    expect(setArg).toHaveProperty('goals', ['vocab']);
    expect(setArg).toHaveProperty('updatedAt');
    expect(setArg).not.toHaveProperty('gentleNudges');
    expect(setArg).not.toHaveProperty('notes');
  });

  it('rejects an empty body with 400', async () => {
    const res = await patchPrefs(app, {});
    expect(res.status).toBe(400);
  });

  it('rejects an invalid dailyMinutes with 400', async () => {
    const res = await patchPrefs(app, { dailyMinutes: 7 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the user has no preferences row', async () => {
    // Override the update mock to return [] (no row updated).
    mockUpdateReturning.mockResolvedValueOnce([]);
    const res = await patchPrefs(app, { gentleNudges: false });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await patchPrefs(app, { gentleNudges: false }, unauthEnv);
    expect(res.status).toBe(401);
  });
});
