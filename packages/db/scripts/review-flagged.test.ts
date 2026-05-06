/**
 * Tests for the `pnpm review:flagged` CLI orchestration.
 *
 * Layered:
 *   - Always-on unit tests for the pure helpers (`printReviewSummary`,
 *     `isUniqueViolation`, `tryApprove`'s catch-and-demote branch via a fake
 *     `Db`) and the production guard.
 *   - DB-touching integration tests (gated on `TEST_DATABASE_URL`) that drive
 *     `main()` with an injected `Readable` stdin and assert the resulting row
 *     state plus printed summary — happy path, quit-early, unknown-key
 *     re-prompt.
 *
 * Parser tests live in `review-flagged-parse-args.test.ts` (Task 20); this
 * file does not duplicate them.
 *
 * Note on the dedup-on-approval branch (Requirement 6.10): the partial UNIQUE
 * index `exercises_dedup_idx` from Requirement 4.1 includes `flagged` in its
 * `WHERE`, so two rows in the same cell with the same `_dedupKey` cannot
 * actually coexist on a real Postgres branch (the second `INSERT` would fail
 * with `23505`). The catch path is exercised here through a fake `Db` whose
 * first `update()` throws a synthetic `23505` error and whose second `update()`
 * succeeds — proving the `tryApprove` catch+demote logic without a contrived
 * schema-bypass.
 */

import { Readable } from 'node:stream';

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema/index';

import {
  isUniqueViolation,
  main,
  printReviewSummary,
  tryApprove,
  type FlaggedRow,
} from './review-flagged';

// ---------------------------------------------------------------------------
// Test stdin helper
// ---------------------------------------------------------------------------

function createTestStdin(): { stdin: Readable; push: (key: string) => void } {
  const stdin = new Readable({ read() {} });
  return {
    stdin,
    push(key: string) {
      // Pushing on a paused readable buffers the chunk; the buffered reader
      // attaches a 'data' listener inside main(), which flips the stream into
      // flowing mode and drains the buffer. Tests can push before OR after
      // main() runs; both work.
      stdin.push(key);
    },
  };
}

// ---------------------------------------------------------------------------
// printReviewSummary
// ---------------------------------------------------------------------------

describe('printReviewSummary', () => {
  it('omits the "remaining" line when remaining = 0', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      printReviewSummary({ approved: 2, rejected: 1, skipped: 0 }, 3, 0);
      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toContain('Reviewed 3 exercise(s): 2 approved, 1 rejected, 0 skipped');
      expect(out).not.toContain('flagged remain');
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('appends the "remaining" line when remaining > 0', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      printReviewSummary({ approved: 0, rejected: 0, skipped: 0 }, 0, 5);
      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toContain('Reviewed 0 exercise(s): 0 approved, 0 rejected, 0 skipped');
      expect(out).toContain('(5 flagged remain in this slice — re-run to continue)');
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// isUniqueViolation
// ---------------------------------------------------------------------------

describe('isUniqueViolation', () => {
  it('returns true for an Error with code "23505"', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('returns false for an Error with a different code', () => {
    const err = Object.assign(new Error('connection refused'), { code: '08001' });
    expect(isUniqueViolation(err)).toBe(false);
  });

  it('returns false for an Error without a code field', () => {
    expect(isUniqueViolation(new Error('plain'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({ code: '23505' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tryApprove — dedup-on-approval branch (Requirement 6.10)
// ---------------------------------------------------------------------------

describe('tryApprove', () => {
  function makeFlaggedRow(): FlaggedRow {
    return {
      id: '00000000-0000-4000-8000-000000000001',
      language: 'ES',
      difficulty: 'B1',
      type: 'cloze',
      grammarPointKey: 'review-test-gp',
      contentJson: { type: 'cloze', sentence: 'x' },
      qualityScore: 0.6,
      flaggedReasons: ['borderline answer ambiguity'],
      generatedAt: new Date('2026-05-01T00:00:00Z'),
    };
  }

  /**
   * Build a minimal stand-in for the Drizzle `Db` whose `update()` chain
   * resolves through `set()`/`where()` to a Promise. The supplied behaviors
   * fire in order — first `update()` call uses `behaviors[0]`, etc.
   */
  function makeFakeDb(behaviors: Array<() => Promise<void>>): {
    db: Db;
    updateCalls: number;
  } {
    let updateCalls = 0;
    const db = {
      update: (_table: unknown) => {
        const idx = updateCalls;
        updateCalls += 1;
        return {
          set: (_values: unknown) => ({
            where: async (_predicate: unknown) => {
              await behaviors[idx]();
            },
          }),
        };
      },
    } as unknown as Db;
    return {
      db,
      get updateCalls() {
        return updateCalls;
      },
    };
  }

  it('returns "approved" on a clean UPDATE', async () => {
    const fake = makeFakeDb([async () => {}]);
    const result = await tryApprove(fake.db, makeFlaggedRow());
    expect(result).toBe('approved');
    expect(fake.updateCalls).toBe(1);
  });

  it('catches a 23505 unique-violation and demotes to rejected', async () => {
    const fake = makeFakeDb([
      async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint "exercises_dedup_idx"'), {
          code: '23505',
        });
      },
      async () => {},
    ]);
    const result = await tryApprove(fake.db, makeFlaggedRow());
    expect(result).toBe('demoted');
    expect(fake.updateCalls).toBe(2);
  });

  it('rethrows non-unique-violation errors without a second UPDATE', async () => {
    const fake = makeFakeDb([
      async () => {
        throw Object.assign(new Error('connection refused'), { code: '08001' });
      },
    ]);
    await expect(tryApprove(fake.db, makeFlaggedRow())).rejects.toThrow(
      /connection refused/,
    );
    expect(fake.updateCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Production guard
// ---------------------------------------------------------------------------

describe('main — production guard', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('refuses to run without --allow-prod when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production';

    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('__exit__');
      }) as never);

    const { stdin } = createTestStdin();
    try {
      await expect(main(['--lang', 'es'], stdin)).rejects.toThrow('__exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errLines = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(errLines).toMatch(/Refusing to run in production/i);
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// DB-touching integration tests
// ---------------------------------------------------------------------------

const TEST_GP_KEY = 'review-flagged-test-gp';
const ROW_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const ROW_REASONS = [
  ['borderline answer ambiguity'],
  ['level mismatch', 'ambiguous'],
  ['low quality score (<0.7)'],
];
const REVIEW_ARGV = [
  '--lang',
  'es',
  '--level',
  'B1',
  '--type',
  'cloze',
  '--grammar-point',
  TEST_GP_KEY,
];

const DB_TEST_TIMEOUT_MS = 60_000;

async function cleanReviewTestRows(db: Db): Promise<void> {
  await db.delete(exercises).where(eq(exercises.grammarPointKey, TEST_GP_KEY));
}

async function seedFlaggedRows(db: Db): Promise<void> {
  await db.insert(exercises).values(
    ROW_IDS.map((id, idx) => ({
      id,
      type: ExerciseType.CLOZE,
      language: Language.ES,
      difficulty: CefrLevel.B1,
      contentJson: {
        type: ExerciseType.CLOZE,
        instructions: 'Fill in the blank.',
        sentence: `Sentence ${idx} ___ for review.`,
        correctAnswer: 'word',
        _dedupKey: `review-flagged-test-${idx}`,
      },
      grammarPointKey: TEST_GP_KEY,
      generationSource: 'claude-realtime',
      modelId: 'claude-sonnet-4-5',
      qualityScore: 0.6,
      reviewStatus: 'flagged',
      flaggedReasons: ROW_REASONS[idx],
      // Deterministic ordering: row 0 oldest, row 2 newest.
      generatedAt: new Date(`2026-05-01T00:0${idx}:00Z`),
    })),
  );
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'main — interactive review against a real DB',
  () => {
    let db: Db;
    let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null;
    const originalNodeEnv = process.env['NODE_ENV'];

    beforeAll(() => {
      db = createDb(process.env['TEST_DATABASE_URL']!);
      // Inherit DATABASE_URL from TEST_DATABASE_URL so main()'s requireEnv
      // sees a value. Restored in afterAll.
      process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
      delete process.env['NODE_ENV'];
    });

    afterAll(() => {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
    });

    beforeEach(async () => {
      await cleanReviewTestRows(db);
      await seedFlaggedRows(db);
      stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
    });

    afterEach(async () => {
      stdoutSpy?.mockRestore();
      stdoutSpy = null;
      await cleanReviewTestRows(db);
    });

    function readPrintedOutput(): string {
      return (
        stdoutSpy?.mock.calls.map((c) => String(c[0])).join('') ?? ''
      );
    }

    async function fetchSeededRows() {
      const rows = await db
        .select({
          id: exercises.id,
          reviewStatus: exercises.reviewStatus,
          flaggedReasons: exercises.flaggedReasons,
        })
        .from(exercises)
        .where(eq(exercises.grammarPointKey, TEST_GP_KEY));
      return new Map(rows.map((r) => [r.id, r]));
    }

    it(
      'happy path: a/r/s drives approve, reject, skip in order',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        const { stdin, push } = createTestStdin();
        push('a');
        push('r');
        push('s');

        await main(REVIEW_ARGV, stdin);

        const byId = await fetchSeededRows();
        expect(byId.get(ROW_IDS[0])?.reviewStatus).toBe('manual-approved');
        expect(byId.get(ROW_IDS[0])?.flaggedReasons).toBeNull();
        expect(byId.get(ROW_IDS[1])?.reviewStatus).toBe('rejected');
        expect(byId.get(ROW_IDS[1])?.flaggedReasons).toEqual(ROW_REASONS[1]);
        expect(byId.get(ROW_IDS[2])?.reviewStatus).toBe('flagged');
        expect(byId.get(ROW_IDS[2])?.flaggedReasons).toEqual(ROW_REASONS[2]);

        const out = readPrintedOutput();
        expect(out).toContain(
          'Reviewed 3 exercise(s): 1 approved, 1 rejected, 1 skipped',
        );
        // The skipped row is still flagged in the cell, so the remaining count
        // is 1 and the re-run hint should fire.
        expect(out).toContain('(1 flagged remain in this slice — re-run to continue)');
        expect(out).toContain('Approved.');
        expect(out).toContain('Rejected.');
      },
    );

    it(
      'quit early: q exits without modifying any row',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        const { stdin, push } = createTestStdin();
        push('q');

        await main(REVIEW_ARGV, stdin);

        const byId = await fetchSeededRows();
        for (const id of ROW_IDS) {
          expect(byId.get(id)?.reviewStatus).toBe('flagged');
        }

        const out = readPrintedOutput();
        expect(out).toContain('Reviewed 0 exercise(s): 0 approved, 0 rejected, 0 skipped');
        expect(out).toContain('(3 flagged remain in this slice — re-run to continue)');
      },
    );

    it(
      'unknown key re-prompts and the next valid key is consumed',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        // --limit 1 so only the first row is loaded; we drive `x` then `a` to
        // cover the unknown-key branch followed by an approve.
        const { stdin, push } = createTestStdin();
        push('x');
        push('a');

        await main([...REVIEW_ARGV, '--limit', '1'], stdin);

        const byId = await fetchSeededRows();
        expect(byId.get(ROW_IDS[0])?.reviewStatus).toBe('manual-approved');
        // Other rows are untouched (they weren't in the slice).
        expect(byId.get(ROW_IDS[1])?.reviewStatus).toBe('flagged');
        expect(byId.get(ROW_IDS[2])?.reviewStatus).toBe('flagged');

        const out = readPrintedOutput();
        expect(out).toContain('use a/r/s/q');
        expect(out).toContain('Approved.');
        expect(out).toContain(
          'Reviewed 1 exercise(s): 1 approved, 0 rejected, 0 skipped',
        );
        // Two flagged rows still in the cell that weren't pulled into this
        // limited slice → the remaining count picks them up.
        expect(out).toContain('(2 flagged remain in this slice — re-run to continue)');
      },
    );
  },
);
