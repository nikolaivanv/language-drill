/**
 * Tests for the `pnpm review:flagged-theory` CLI orchestration.
 *
 * Layered (mirrors `review-flagged.test.ts`):
 *   - Always-on unit tests for the pure helpers (`printTheoryReviewSummary`,
 *     `renderTheoryRow` happy + broken-content branches).
 *   - DB-touching integration tests (gated on `TEST_DATABASE_URL`) that drive
 *     `main()` with an injected `Readable` stdin, plus dedicated
 *     `tryApproveTheory` demote and concurrent-write tests.
 *
 * Parser tests live in `review-flagged-theory-parse-args.test.ts` (Task 16);
 * this file does not duplicate them.
 */

import { Readable } from 'node:stream';

import { CefrLevel, Language, type TheoryTopicJson } from '@language-drill/shared';
import { and, eq, inArray } from 'drizzle-orm';
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
import { theoryTopics } from '../src/schema/index';

import {
  printTheoryReviewSummary,
  renderTheoryRow,
  tryApproveTheory,
  type FlaggedTheoryRow,
} from './review-flagged-theory';

// ---------------------------------------------------------------------------
// Test stdin helper
// ---------------------------------------------------------------------------

function createTestStdin(): {
  stdin: Readable;
  push: (key: string) => void;
} {
  const stdin = new Readable({ read() {} });
  return {
    stdin,
    push(key: string) {
      stdin.push(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal valid TheoryTopicJson literal — shared by unit + integration tests.
// ---------------------------------------------------------------------------

function makeTopicJson(suffix: string): TheoryTopicJson {
  return {
    id: `test-${suffix}`,
    title: `test topic ${suffix}`,
    subtitle: 'a test page',
    cefr: 'B1',
    sections: [
      {
        id: 'what',
        title: 'what is it?',
        body: [
          {
            kind: 'paragraph',
            text: [
              { kind: 'text', text: `this is page ${suffix} content` },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// printTheoryReviewSummary
// ---------------------------------------------------------------------------

describe('printTheoryReviewSummary', () => {
  function captureStdout(): {
    write: NodeJS.WriteStream['write'];
    output: string[];
  } {
    const output: string[] = [];
    const write = ((chunk: string | Buffer) => {
      output.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as NodeJS.WriteStream['write'];
    return { write, output };
  }

  it('omits the "remaining" line when remaining = 0', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    printTheoryReviewSummary(
      { approved: 2, rejected: 1, skipped: 0, demoted: 0 },
      3,
      0,
      stdout,
    );

    const out = captured.output.join('');
    expect(out).toContain(
      'Reviewed 3 theory page(s): 2 approved, 1 rejected, 0 skipped, 0 demoted',
    );
    expect(out).not.toContain('flagged remain');
  });

  it('appends the "remaining" line when remaining > 0', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    printTheoryReviewSummary(
      { approved: 0, rejected: 0, skipped: 0, demoted: 0 },
      0,
      5,
      stdout,
    );

    const out = captured.output.join('');
    expect(out).toContain(
      'Reviewed 0 theory page(s): 0 approved, 0 rejected, 0 skipped, 0 demoted',
    );
    expect(out).toContain(
      '(5 flagged remain in this slice — re-run to continue)',
    );
  });

  it('reports demoted count when tryApproveTheory falls back to rejected', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    printTheoryReviewSummary(
      { approved: 0, rejected: 0, skipped: 0, demoted: 2 },
      2,
      0,
      stdout,
    );

    const out = captured.output.join('');
    expect(out).toContain(
      'Reviewed 2 theory page(s): 0 approved, 0 rejected, 0 skipped, 2 demoted',
    );
  });
});

// ---------------------------------------------------------------------------
// renderTheoryRow
// ---------------------------------------------------------------------------

describe('renderTheoryRow', () => {
  function captureStdout(): {
    write: NodeJS.WriteStream['write'];
    output: string[];
  } {
    const output: string[] = [];
    const write = ((chunk: string | Buffer) => {
      output.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as NodeJS.WriteStream['write'];
    return { write, output };
  }

  function makeRow(overrides: Partial<FlaggedTheoryRow> = {}): FlaggedTheoryRow {
    return {
      id: '11111111-2222-4333-8444-555555555555',
      language: 'ES',
      cefrLevel: 'B1',
      grammarPointKey: 'es-b1-test-grammar',
      topicId: 'test-topic-id',
      contentJson: makeTopicJson('a'),
      qualityScore: 0.62,
      flaggedReasons: ['low quality score (<0.7)', 'voice is too encouraging'],
      generatedAt: new Date('2026-05-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('renders header, plain-text body, and bulleted flagged-reasons footer', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    renderTheoryRow(makeRow(), stdout);
    const out = captured.output.join('');

    // Header: id-prefix (8 chars) + lang/level/grammarPointKey + qualityScore
    expect(out).toContain('11111111... ───  ES B1 es-b1-test-grammar  qualityScore=0.62');
    // Body: plain-text dump of the topic (header + section).
    expect(out).toContain('test topic a');
    expect(out).toContain('## what is it?');
    expect(out).toContain('this is page a content');
    // Footer: bulleted flagged reasons.
    expect(out).toContain('Flagged reasons:');
    expect(out).toContain('  - low quality score (<0.7)');
    expect(out).toContain('  - voice is too encouraging');
  });

  it('renders "(none recorded)" when flaggedReasons is empty or null', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    renderTheoryRow(makeRow({ flaggedReasons: [] }), stdout);
    renderTheoryRow(makeRow({ flaggedReasons: null }), stdout);
    const out = captured.output.join('');
    // Both calls should fall through to the "(none recorded)" branch.
    const matches = out.match(/\(none recorded\)/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('renders qualityScore as "null" when missing', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    renderTheoryRow(makeRow({ qualityScore: null }), stdout);
    expect(captured.output.join('')).toContain('qualityScore=null');
  });

  it('prints a "(content render error: ...)" line for malformed contentJson', () => {
    const captured = captureStdout();
    const stdout = { write: captured.write } as unknown as NodeJS.WriteStream;

    const malformed = {
      id: 'broken',
      title: 'broken topic',
      subtitle: '',
      cefr: 'B1',
      // Empty sections array → `parseTheoryTopicJson` throws on the empty
      // check (parses sections after the string fields).
      sections: [],
    } as unknown as TheoryTopicJson;

    renderTheoryRow(makeRow({ contentJson: malformed }), stdout);
    const out = captured.output.join('');
    expect(out).toContain('(content render error:');
    // Footer still prints — render failure must not abort the row's emission.
    expect(out).toContain('Flagged reasons:');
  });
});

// ---------------------------------------------------------------------------
// DB-touching integration tests
// ---------------------------------------------------------------------------

const TEST_GP_PREFIX = 'review-test-theory-';
const ROW_GP_KEYS = [
  `${TEST_GP_PREFIX}walk-1`,
  `${TEST_GP_PREFIX}walk-2`,
  `${TEST_GP_PREFIX}walk-3`,
];
const ROW_IDS = [
  '11111111-1111-4111-8111-100000000001',
  '22222222-2222-4222-8222-200000000002',
  '33333333-3333-4333-8333-300000000003',
];
const ROW_REASONS = [
  ['borderline voice'],
  ['level mismatch', 'low quality score (<0.7)'],
  ['examples off-target'],
];

const DEMOTE_GP_KEY = `${TEST_GP_PREFIX}demote-cell`;
const DEMOTE_APPROVED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEMOTE_FLAGGED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const CONCURRENT_GP_KEY = `${TEST_GP_PREFIX}concurrent-cell`;
const CONCURRENT_FLAGGED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const DB_TEST_TIMEOUT_MS = 60_000;

async function cleanTheoryReviewTestRows(db: Db): Promise<void> {
  await db.delete(theoryTopics).where(
    inArray(theoryTopics.grammarPointKey, [
      ...ROW_GP_KEYS,
      DEMOTE_GP_KEY,
      CONCURRENT_GP_KEY,
    ]),
  );
}

async function seedFlaggedWalkRows(db: Db): Promise<void> {
  await db.insert(theoryTopics).values(
    ROW_IDS.map((id, idx) => ({
      id,
      language: Language.ES,
      grammarPointKey: ROW_GP_KEYS[idx],
      topicId: `review-test-walk-${idx}`,
      cefrLevel: CefrLevel.B1,
      contentJson: makeTopicJson(String(idx)),
      generationSource: 'claude-realtime' as const,
      modelId: 'claude-sonnet-4-5',
      qualityScore: 0.6,
      reviewStatus: 'flagged',
      flaggedReasons: ROW_REASONS[idx],
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
      // sees a value.
      process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
      delete process.env['NODE_ENV'];
    });

    afterAll(() => {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
    });

    beforeEach(async () => {
      await cleanTheoryReviewTestRows(db);
      await seedFlaggedWalkRows(db);
      stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
    });

    afterEach(async () => {
      stdoutSpy?.mockRestore();
      stdoutSpy = null;
      await cleanTheoryReviewTestRows(db);
    });

    function readPrintedOutput(): string {
      return (
        stdoutSpy?.mock.calls.map((c) => String(c[0])).join('') ?? ''
      );
    }

    async function fetchSeededWalkRows() {
      const rows = await db
        .select({
          id: theoryTopics.id,
          reviewStatus: theoryTopics.reviewStatus,
          flaggedReasons: theoryTopics.flaggedReasons,
        })
        .from(theoryTopics)
        .where(inArray(theoryTopics.grammarPointKey, ROW_GP_KEYS));
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

        // Lazy import to defer module-init until after env wiring above.
        const { main } = await import('./review-flagged-theory');
        await main(['--lang', 'es', '--grammar-point', ROW_GP_KEYS[0]], stdin);

        let byId = await fetchSeededWalkRows();
        expect(byId.get(ROW_IDS[0])?.reviewStatus).toBe('manual-approved');
        expect(byId.get(ROW_IDS[0])?.flaggedReasons).toBeNull();
        // Other rows untouched by this scoped invocation.
        expect(byId.get(ROW_IDS[1])?.reviewStatus).toBe('flagged');
        expect(byId.get(ROW_IDS[2])?.reviewStatus).toBe('flagged');

        // Now run unscoped over the remaining two flagged rows.
        const { stdin: stdin2, push: push2 } = createTestStdin();
        push2('r');
        push2('s');
        await main(['--lang', 'es'], stdin2);

        byId = await fetchSeededWalkRows();
        // The order is generatedAt ASC, so row 1 comes before row 2.
        expect(byId.get(ROW_IDS[1])?.reviewStatus).toBe('rejected');
        // flaggedReasons preserved on reject.
        expect(byId.get(ROW_IDS[1])?.flaggedReasons).toEqual(ROW_REASONS[1]);
        expect(byId.get(ROW_IDS[2])?.reviewStatus).toBe('flagged');

        const out = readPrintedOutput();
        expect(out).toContain('✓ approved');
        expect(out).toContain('✗ rejected');
        // The summary line for the first scoped run.
        expect(out).toContain(
          'Reviewed 1 theory page(s): 1 approved, 0 rejected, 0 skipped, 0 demoted',
        );
        // The summary line for the second unscoped run (1 rejected, 1 skipped).
        expect(out).toContain(
          'Reviewed 2 theory page(s): 0 approved, 1 rejected, 1 skipped, 0 demoted',
        );
      },
    );

    it(
      'quit early: q exits without modifying any row',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        const { stdin, push } = createTestStdin();
        push('q');

        const { main } = await import('./review-flagged-theory');
        await main(['--lang', 'es', '--grammar-point', ROW_GP_KEYS[0]], stdin);

        const byId = await fetchSeededWalkRows();
        expect(byId.get(ROW_IDS[0])?.reviewStatus).toBe('flagged');
        expect(byId.get(ROW_IDS[1])?.reviewStatus).toBe('flagged');
        expect(byId.get(ROW_IDS[2])?.reviewStatus).toBe('flagged');

        const out = readPrintedOutput();
        expect(out).toContain(
          'Reviewed 0 theory page(s): 0 approved, 0 rejected, 0 skipped, 0 demoted',
        );
        expect(out).toContain(
          '(1 flagged remain in this slice — re-run to continue)',
        );
      },
    );

    it(
      'empty slice: prints the no-matches message and exits without prompting',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        const { stdin } = createTestStdin();

        const { main } = await import('./review-flagged-theory');
        // Use a grammar-point key that doesn't exist in any row.
        await main(
          ['--lang', 'es', '--grammar-point', `${TEST_GP_PREFIX}no-such-key`],
          stdin,
        );

        const out = readPrintedOutput();
        expect(out).toContain('No flagged theory pages match the filter.');
      },
    );

    it(
      'tryApproveTheory demotes to rejected when the partial unique index fires',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        // Seed an auto-approved row in the demote cell.
        await db.insert(theoryTopics).values({
          id: DEMOTE_APPROVED_ID,
          language: Language.ES,
          grammarPointKey: DEMOTE_GP_KEY,
          topicId: 'review-test-demote-approved',
          cefrLevel: CefrLevel.B1,
          contentJson: makeTopicJson('approved'),
          generationSource: 'claude-realtime' as const,
          modelId: 'claude-sonnet-4-5',
          qualityScore: 0.9,
          reviewStatus: 'auto-approved',
          flaggedReasons: null,
          generatedAt: new Date('2026-04-01T00:00:00Z'),
        });

        // Seed a flagged duplicate in the same cell. The partial unique
        // index excludes flagged rows, so this INSERT succeeds.
        await db.insert(theoryTopics).values({
          id: DEMOTE_FLAGGED_ID,
          language: Language.ES,
          grammarPointKey: DEMOTE_GP_KEY,
          topicId: 'review-test-demote-flagged',
          cefrLevel: CefrLevel.B1,
          contentJson: makeTopicJson('flagged'),
          generationSource: 'claude-realtime' as const,
          modelId: 'claude-sonnet-4-5',
          qualityScore: 0.6,
          reviewStatus: 'flagged',
          flaggedReasons: ['voice mismatch'],
          generatedAt: new Date('2026-05-01T00:00:00Z'),
        });

        const flaggedRow: FlaggedTheoryRow = {
          id: DEMOTE_FLAGGED_ID,
          language: 'ES',
          cefrLevel: 'B1',
          grammarPointKey: DEMOTE_GP_KEY,
          topicId: 'review-test-demote-flagged',
          contentJson: makeTopicJson('flagged'),
          qualityScore: 0.6,
          flaggedReasons: ['voice mismatch'],
          generatedAt: new Date('2026-05-01T00:00:00Z'),
        };

        const result = await tryApproveTheory(db, flaggedRow);
        expect(result).toBe('demoted');

        const rows = await db
          .select({
            id: theoryTopics.id,
            reviewStatus: theoryTopics.reviewStatus,
          })
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, DEMOTE_GP_KEY));
        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(DEMOTE_APPROVED_ID)?.reviewStatus).toBe('auto-approved');
        expect(byId.get(DEMOTE_FLAGGED_ID)?.reviewStatus).toBe('rejected');
      },
    );

    it(
      'tryApproveTheory no-ops cleanly when the row has been concurrently resolved',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        // Seed a flagged row, then UPDATE it directly to 'rejected' to
        // simulate a concurrent reviewer/Lambda having already resolved it.
        await db.insert(theoryTopics).values({
          id: CONCURRENT_FLAGGED_ID,
          language: Language.ES,
          grammarPointKey: CONCURRENT_GP_KEY,
          topicId: 'review-test-concurrent',
          cefrLevel: CefrLevel.B1,
          contentJson: makeTopicJson('concurrent'),
          generationSource: 'claude-realtime' as const,
          modelId: 'claude-sonnet-4-5',
          qualityScore: 0.6,
          reviewStatus: 'flagged',
          flaggedReasons: ['concurrent test'],
          generatedAt: new Date('2026-05-01T00:00:00Z'),
        });

        await db
          .update(theoryTopics)
          .set({ reviewStatus: 'rejected' })
          .where(
            and(
              eq(theoryTopics.id, CONCURRENT_FLAGGED_ID),
              eq(theoryTopics.reviewStatus, 'flagged'),
            ),
          );

        const flaggedRow: FlaggedTheoryRow = {
          id: CONCURRENT_FLAGGED_ID,
          language: 'ES',
          cefrLevel: 'B1',
          grammarPointKey: CONCURRENT_GP_KEY,
          topicId: 'review-test-concurrent',
          contentJson: makeTopicJson('concurrent'),
          qualityScore: 0.6,
          flaggedReasons: ['concurrent test'],
          generatedAt: new Date('2026-05-01T00:00:00Z'),
        };

        // The first UPDATE fires WHERE review_status = 'flagged' but the row
        // is now 'rejected' — Postgres reports 0 affected rows. No 23505 is
        // thrown, so the function returns 'approved' (clean UPDATE path)
        // without actually mutating anything.
        const result = await tryApproveTheory(db, flaggedRow);
        expect(result).toBe('approved');

        // The row's state is still 'rejected' — the guarded UPDATE matched
        // zero rows and did nothing.
        const rows = await db
          .select({ reviewStatus: theoryTopics.reviewStatus })
          .from(theoryTopics)
          .where(eq(theoryTopics.id, CONCURRENT_FLAGGED_ID));
        expect(rows[0]?.reviewStatus).toBe('rejected');
      },
    );
  },
);
