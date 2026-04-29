import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  CefrLevel,
  DAILY_MINUTES,
  GOAL_IDS,
  Language,
  NOTES_MAX_LENGTH,
} from '@language-drill/shared';

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
  goals: string[];
  dailyMinutes: number;
  gentleNudges: boolean;
  notes: string;
};

type CapturedUpsertSet = {
  primaryLanguage: string;
  goals: string[];
  dailyMinutes: number;
  gentleNudges: boolean;
  notes: string;
  updatedAt: Date;
};

type TxCapture = {
  txDeleteCalls: number;
  txInsertProfilesValues: CapturedProfileRow[][];
  txInsertPreferencesValues: CapturedPreferences[];
  txUpsertSetCalls: CapturedUpsertSet[];
  // What the mocked .returning() should yield for each call (FIFO).
  profileReturningResults: Array<Array<{ language: string; proficiencyLevel: string }>>;
  preferencesReturningResults: Array<
    Array<{
      primaryLanguage: string;
      goals: string[];
      dailyMinutes: number;
      gentleNudges: boolean;
      notes: string;
    }>
  >;
};

const txCapture: TxCapture = {
  txDeleteCalls: 0,
  txInsertProfilesValues: [],
  txInsertPreferencesValues: [],
  txUpsertSetCalls: [],
  profileReturningResults: [],
  preferencesReturningResults: [],
};

function resetTxCapture(): void {
  txCapture.txDeleteCalls = 0;
  txCapture.txInsertProfilesValues = [];
  txCapture.txInsertPreferencesValues = [];
  txCapture.txUpsertSetCalls = [];
  txCapture.profileReturningResults = [];
  txCapture.preferencesReturningResults = [];
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
              return {
                returning: () =>
                  Promise.resolve(
                    txCapture.preferencesReturningResults.shift() ?? [
                      {
                        primaryLanguage: rows.primaryLanguage,
                        goals: rows.goals,
                        dailyMinutes: rows.dailyMinutes,
                        gentleNudges: rows.gentleNudges,
                        notes: rows.notes,
                      },
                    ],
                  ),
              };
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
  goals: string[];
  dailyMinutes: number;
  gentleNudges: boolean;
  notes: string;
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
    goals: [],
    dailyMinutes: 10,
    gentleNudges: true,
    notes: '',
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

  it('creates profiles for new user and returns 200 with profiles + preferences', async () => {
    const body = validBody({
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
      primaryLanguage: Language.ES,
      goals: ['grammar', 'speaking'],
      dailyMinutes: 20,
      gentleNudges: false,
      notes: 'I keep mixing up preterite vs imperfect.',
    });

    const res = await putProfiles(app, body);

    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json).toEqual({
      profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
      preferences: {
        primaryLanguage: 'ES',
        goals: ['grammar', 'speaking'],
        dailyMinutes: 20,
        gentleNudges: false,
        notes: 'I keep mixing up preterite vs imperfect.',
      },
    });
    // Atomic delete-then-insert pattern.
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

  it('persists a userPreferences row with all 5 columns', async () => {
    const body = validBody({
      goals: ['vocab', 'travel'],
      dailyMinutes: 30,
      gentleNudges: false,
      notes: 'focus on travel phrases',
    });

    const res = await putProfiles(app, body);

    expect(res.status).toBe(200);
    expect(txCapture.txInsertPreferencesValues).toHaveLength(1);
    const inserted = txCapture.txInsertPreferencesValues[0];
    expect(inserted).toMatchObject({
      userId: 'user_123',
      primaryLanguage: Language.ES,
      goals: ['vocab', 'travel'],
      dailyMinutes: 30,
      gentleNudges: false,
      notes: 'focus on travel phrases',
    });
  });

  it('replaces existing profiles atomically and upserts the userPreferences row on second call', async () => {
    // First PUT
    const first = await putProfiles(
      app,
      validBody({
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }],
        primaryLanguage: Language.ES,
        goals: ['grammar'],
        dailyMinutes: 10,
        notes: 'first',
      }),
    );
    expect(first.status).toBe(200);

    vi.clearAllMocks();
    resetTxCapture();

    // Second PUT — replaces atomically, upserts preferences
    const second = await putProfiles(
      app,
      validBody({
        profiles: [
          { language: Language.DE, proficiencyLevel: CefrLevel.A1 },
          { language: Language.TR, proficiencyLevel: CefrLevel.C1 },
        ],
        primaryLanguage: Language.TR,
        goals: ['speaking', 'listening'],
        dailyMinutes: 30,
        gentleNudges: false,
        notes: 'second',
      }),
    );

    expect(second.status).toBe(200);
    const json = (await second.json()) as AnyJson;
    expect(json).toEqual({
      profiles: [
        { language: 'DE', proficiencyLevel: 'A1' },
        { language: 'TR', proficiencyLevel: 'C1' },
      ],
      preferences: {
        primaryLanguage: 'TR',
        goals: ['speaking', 'listening'],
        dailyMinutes: 30,
        gentleNudges: false,
        notes: 'second',
      },
    });

    // Single transaction, single delete, two inserts (profiles + preferences).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(txCapture.txDeleteCalls).toBe(1);
    expect(txCapture.txInsertProfilesValues).toHaveLength(1);
    expect(txCapture.txInsertPreferencesValues).toHaveLength(1);

    // The upsert path was exercised — onConflictDoUpdate.set carries new values.
    expect(txCapture.txUpsertSetCalls).toHaveLength(1);
    const upsertSet = txCapture.txUpsertSetCalls[0];
    expect(upsertSet).toMatchObject({
      primaryLanguage: 'TR',
      goals: ['speaking', 'listening'],
      dailyMinutes: 30,
      gentleNudges: false,
      notes: 'second',
    });
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

  it('rejects invalid goal id with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({ goals: ['not-a-real-goal'] }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    // Sanity-check the canonical list still includes the expected ids — if a
    // future change adds 'not-a-real-goal' to GOAL_IDS this test would break
    // and we'd notice.
    expect(GOAL_IDS).not.toContain('not-a-real-goal');
  });

  it('rejects notes longer than 500 characters with 400', async () => {
    const res = await putProfiles(
      app,
      validBody({ notes: 'x'.repeat(NOTES_MAX_LENGTH + 1) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects dailyMinutes not in {5, 10, 20, 30} with 400', async () => {
    const res = await putProfiles(app, validBody({ dailyMinutes: 15 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
    // Sanity: the canonical set is what we think it is.
    expect([...DAILY_MINUTES]).toEqual([5, 10, 20, 30]);
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
