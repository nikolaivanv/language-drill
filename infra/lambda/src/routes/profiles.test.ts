import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------

const mockOrderBy = vi.fn();
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => {
  const p = Promise.resolve([]) as Promise<never[]> & { onConflictDoNothing: typeof mockOnConflictDoNothing };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

vi.mock('../db', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    delete: () => mockDelete(),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  userLanguageProfiles: {},
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

// ---------------------------------------------------------------------------
// GET /profiles/languages
// ---------------------------------------------------------------------------

describe('GET /profiles/languages', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
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
      { language: 'EN', proficiencyLevel: 'B1' },
      { language: 'ES', proficiencyLevel: 'A2' },
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
    const mod = await import('./profiles');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('creates profiles for new user and returns 200', async () => {
    const profiles = [
      { language: 'EN', proficiencyLevel: 'B1' },
      { language: 'ES', proficiencyLevel: 'A2' },
    ];

    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ profiles });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('replaces existing profiles atomically', async () => {
    const firstProfiles = [
      { language: 'EN', proficiencyLevel: 'B1' },
    ];

    // First PUT
    await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: firstProfiles }),
      },
      authEnv,
    );

    vi.clearAllMocks();

    const newProfiles = [
      { language: 'DE', proficiencyLevel: 'A1' },
      { language: 'TR', proficiencyLevel: 'C1' },
    ];

    // Second PUT — replaces atomically
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: newProfiles }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ profiles: newProfiles });
    // Should delete old + insert new
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('rejects empty profiles array with 400', async () => {
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: [] }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate languages with 400', async () => {
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: [
            { language: 'EN', proficiencyLevel: 'B1' },
            { language: 'EN', proficiencyLevel: 'A2' },
          ],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid language enum value with 400', async () => {
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: [{ language: 'FR', proficiencyLevel: 'B1' }],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid CEFR level with 400', async () => {
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: [{ language: 'EN', proficiencyLevel: 'D1' }],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/profiles/languages',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: [{ language: 'EN', proficiencyLevel: 'B1' }],
        }),
      },
      unauthEnv,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('MISSING_SUB');
  });
});
