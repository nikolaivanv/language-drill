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
  users: {},
  exercises: {},
  userExerciseHistory: {},
  usageEvents: {},
  userProfiles: {},
}));

vi.mock('@language-drill/ai', () => ({
  createClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: vi.fn(),
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
