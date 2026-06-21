import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(async () => 'free'),
  isAdmin: vi.fn(() => false),
}));

// db.select().from().where().groupBy() → usage rows
const mockGroupBy = vi.fn();
const mockWhere = vi.fn(() => ({ groupBy: mockGroupBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => {
  const col = (name: string) => ({ name });
  const t = () => ({ id: col('id'), userId: col('user_id'), playlistId: col('playlist_id') });
  return {
    // usageEvents is directly queried by the /me route (userId, eventType, createdAt).
    usageEvents: { userId: 'user_id', eventType: 'event_type', createdAt: 'created_at' },
    // The remaining tables are imported by user-export.ts (transitively via me.ts).
    // Vitest's strict mock validation requires every named export referenced in the
    // module graph to be present, even though .userId is never read at module load.
    users: t(), userLanguageProfiles: t(), userPreferences: t(), userExerciseHistory: t(),
    spacedRepetitionCards: t(), fluencyAttempts: t(), userGrammarMastery: t(), errorObservations: t(),
    practiceSessions: t(), readEntries: t(), userVocabulary: t(), vocabularyReviewState: t(),
    vocabularyReviewSessions: t(), vocabularyReviewLog: t(), playlists: t(), playlistItems: t(),
    exerciseFlags: t(),
  };
});

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

describe('GET /me', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGroupBy.mockResolvedValue([
      { eventType: 'ai_evaluation', count: 3 },
      { eventType: 'read_annotation', count: 1 },
    ]);
    const mod = await import('./me');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns plan, isAdmin, limits, and usageToday', async () => {
    const res = await app.request('/me', undefined, authEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.plan).toBe('free');
    expect(body.isAdmin).toBe(false);
    expect(body.limits.evaluation).toBe(50);
    expect(body.usageToday.evaluation).toBe(3);
    expect(body.usageToday.annotation).toBe(1);
    expect(body.usageToday.deepSpan).toBe(0);
  });

  it('reflects a boosted plan in the limits', async () => {
    const { getEffectivePlan } = await import('../usage/plan');
    vi.mocked(getEffectivePlan).mockResolvedValueOnce('boosted');
    const res = await app.request('/me', undefined, authEnv);
    const body = await res.json() as AnyJson;
    expect(body.plan).toBe('boosted');
    expect(body.limits.evaluation).toBe(500);
  });
});
