import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Each db.select().from(table).where(cond) resolves to a canned array keyed by call order.
// We record the cond objects so we can assert every query was filtered by the user id.
const recordedConds: unknown[] = [];
const makeChain = (rows: unknown[]) => ({
  from: () => ({
    where: (cond: unknown) => {
      recordedConds.push(cond);
      return Promise.resolve(rows);
    },
    // playlistItems uses innerJoin(...).where(...)
    innerJoin: () => ({
      where: (cond: unknown) => {
        recordedConds.push(cond);
        return Promise.resolve(rows);
      },
    }),
  }),
});

let selectCalls = 0;
const cannedRows = [{ id: 'row1', userId: 'user_1' }];
vi.mock('../db', () => ({
  db: {
    select: () => {
      selectCalls += 1;
      return makeChain(cannedRows);
    },
  },
}));

// eq returns a tagged object so we can assert the value passed.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Minimal schema stubs — each is just an object with a userId/id field.
vi.mock('@language-drill/db', () => {
  const col = (name: string) => ({ name });
  const t = () => ({ id: col('id'), userId: col('user_id'), playlistId: col('playlist_id') });
  return {
    users: t(), userLanguageProfiles: t(), userPreferences: t(), userExerciseHistory: t(),
    spacedRepetitionCards: t(), fluencyAttempts: t(), userGrammarMastery: t(), errorObservations: t(),
    practiceSessions: t(), readEntries: t(), userVocabulary: t(), vocabularyReviewState: t(),
    vocabularyReviewSessions: t(), vocabularyReviewLog: t(), playlists: t(), playlistItems: t(),
    usageEvents: t(), exerciseFlags: t(),
  };
});

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

describe('GET /me/export', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    recordedConds.length = 0;
    selectCalls = 0;
    const mod = await import('./me');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('requires auth', async () => {
    const res = await app.request('/me/export'); // no authorizer claims
    expect(res.status).toBe(401);
  });

  it('returns every user-keyed section as JSON', async () => {
    const res = await app.request('/me/export', undefined, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of [
      'exportedAt', 'user', 'userLanguageProfiles', 'userPreferences', 'userExerciseHistory',
      'spacedRepetitionCards', 'fluencyAttempts', 'userGrammarMastery', 'errorObservations',
      'practiceSessions', 'readEntries', 'userVocabulary', 'vocabularyReviewState',
      'vocabularyReviewSessions', 'vocabularyReviewLog', 'playlists', 'playlistItems',
      'usageEvents', 'exerciseFlags',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  it('sets a download attachment header', async () => {
    const res = await app.request('/me/export', undefined, authEnv);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="drill-data-export-.*\.json"/);
  });

  it('filters every query by the authenticated user id', async () => {
    await app.request('/me/export', undefined, authEnv);
    // Each recorded cond came from eq(col, val); all vals must be 'user_1'.
    expect(recordedConds.length).toBeGreaterThan(0);
    for (const cond of recordedConds as Array<{ val: unknown }>) {
      expect(cond.val).toBe('user_1');
    }
  });
});
