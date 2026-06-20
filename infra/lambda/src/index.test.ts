import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock transitive imports so loading ./index doesn't try to open a real DB
// connection. ./index imports route modules that import ./db, which throws
// at module-load time when DATABASE_URL is unset.
// ---------------------------------------------------------------------------

vi.mock('./db', () => ({
  db: {},
}));

vi.mock('@language-drill/db', () => ({
  // Tables used directly by routes mounted in index (exercises, me, etc.)
  users: {},
  exercises: {},
  userExerciseHistory: {},
  usageEvents: {},
  userProfiles: {},
  // Tables referenced in USER_EXPORT_TABLES (user-export.ts, imported by me.ts).
  // Only the table objects need to exist; .userId is read at call time, not module load.
  userLanguageProfiles: {},
  userPreferences: {},
  spacedRepetitionCards: {},
  fluencyAttempts: {},
  userGrammarMastery: {},
  errorObservations: {},
  practiceSessions: {},
  readEntries: {},
  userVocabulary: {},
  vocabularyReviewState: {},
  vocabularyReviewSessions: {},
  vocabularyReviewLog: {},
  playlists: {},
  playlistItems: {},
  exerciseFlags: {},
}));

vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  createObservedClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: vi.fn(),
  flushObservability: vi.fn().mockResolvedValue(undefined),
  withLlmTrace: vi.fn(<T,>(_ctx: unknown, fn: () => T | Promise<T>) =>
    Promise.resolve(fn()),
  ),
  EVALUATION_SYSTEM_PROMPT_VERSION: 'evaluate@test',
}));

describe('matchOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('dev-stack allowlist', () => {
    let matchOrigin: (origin: string) => string | null;

    beforeEach(async () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://*.vercel.app,http://localhost:3000');
      vi.resetModules();
      ({ matchOrigin } = await import('./index'));
    });

    it('allows wildcard-matched Vercel preview origin', () => {
      expect(matchOrigin('https://pr-1.vercel.app')).toBe('https://pr-1.vercel.app');
    });

    it('allows multi-segment Vercel preview subdomain', () => {
      expect(matchOrigin('https://pr-123-foo.vercel.app')).toBe(
        'https://pr-123-foo.vercel.app'
      );
    });

    it('allows explicit localhost origin', () => {
      expect(matchOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('rejects production origin (cross-env probe)', () => {
      expect(matchOrigin('https://langdrill.app')).toBeNull();
    });

    it('rejects unrelated origin', () => {
      expect(matchOrigin('https://evil.com')).toBeNull();
    });
  });

  describe('single exact origin', () => {
    let matchOrigin: (origin: string) => string | null;

    beforeEach(async () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://langdrill.app');
      vi.resetModules();
      ({ matchOrigin } = await import('./index'));
    });

    it('allows the exact configured origin', () => {
      expect(matchOrigin('https://langdrill.app')).toBe('https://langdrill.app');
    });

    it('rejects www subdomain when not listed', () => {
      expect(matchOrigin('https://www.langdrill.app')).toBeNull();
    });

    it('rejects unrelated origin', () => {
      expect(matchOrigin('https://evil.com')).toBeNull();
    });
  });

  describe('fallback when ALLOWED_ORIGINS is empty', () => {
    let matchOrigin: (origin: string) => string | null;

    beforeEach(async () => {
      vi.stubEnv('ALLOWED_ORIGINS', '');
      vi.resetModules();
      ({ matchOrigin } = await import('./index'));
    });

    it('allows production apex via fallback list', () => {
      expect(matchOrigin('https://langdrill.app')).toBe('https://langdrill.app');
    });

    it('allows production www via fallback list', () => {
      expect(matchOrigin('https://www.langdrill.app')).toBe('https://www.langdrill.app');
    });

    it('allows Vercel preview via fallback wildcard', () => {
      expect(matchOrigin('https://pr-1.vercel.app')).toBe('https://pr-1.vercel.app');
    });

    it('rejects localhost — not in fallback list', () => {
      expect(matchOrigin('http://localhost:3000')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// flushMiddleware — drains Langfuse buffer after every request (Req 6.1)
// ---------------------------------------------------------------------------

describe('flushMiddleware', () => {
  let flushMiddleware: typeof import('./index').flushMiddleware;
  let flushObservability: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    ({ flushMiddleware } = await import('./index'));
    const ai = await import('@language-drill/ai');
    flushObservability = vi.mocked(ai.flushObservability);
    flushObservability.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('calls flushObservability exactly once after a successful next()', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await flushMiddleware({} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(flushObservability).toHaveBeenCalledTimes(1);
  });

  it('still flushes when next() throws, and propagates the throw', async () => {
    const next = vi.fn().mockRejectedValue(new Error('handler boom'));
    await expect(flushMiddleware({} as never, next)).rejects.toThrow('handler boom');
    expect(flushObservability).toHaveBeenCalledTimes(1);
  });

  it('runs flushObservability AFTER next() — not before', async () => {
    const order: string[] = [];
    const next = vi.fn().mockImplementation(async () => {
      order.push('next');
    });
    flushObservability.mockImplementation(async () => {
      order.push('flush');
    });
    await flushMiddleware({} as never, next);
    expect(order).toEqual(['next', 'flush']);
  });
});
