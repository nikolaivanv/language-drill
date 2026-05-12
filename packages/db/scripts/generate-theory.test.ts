/**
 * CLI integration test for `pnpm generate:theory`.
 *
 * Drives the real `main()` against `MOCK_CLAUDE=1` end-to-end. The DB block
 * is gated on `TEST_DATABASE_URL` and skipped silently when the env var is
 * unset — same convention as `generate-exercises.test.ts`.
 *
 * Three branches exercised:
 *   1. Happy path: empty cell → one approved row in `theory_topics`, one
 *      succeeded audit row in `theory_generation_jobs`.
 *   2. Skip path: rerun the same cell → second audit row marked
 *      approved=false with the partial-index collision message.
 *   3. Dry run: no DB writes, stdout shows the cost estimate.
 */

import { and, eq, like } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { theoryGenerationJobs, theoryTopics } from '../src/schema';

import { main } from './generate-theory';

// Fail fast in test setup if the curriculum loses every ES grammar entry —
// this suite's three branches all key off one.
const testEntry = ALL_CURRICULA.find(
  (e) => e.language === 'ES' && e.kind === 'grammar',
)!;
if (!testEntry) {
  throw new Error(
    "ALL_CURRICULA has no ES grammar entry — generate-theory.test.ts can't pick a test cell",
  );
}

// Neon serverless roundtrips on a cold connection can exceed vitest's
// default 5s.
const DB_TEST_TIMEOUT_MS = 60_000;

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'generate-theory CLI (MOCK_CLAUDE, DB-touching)',
  () => {
    const db = createDb(process.env['TEST_DATABASE_URL']!);

    const originalNodeEnv = process.env['NODE_ENV'];
    const originalMockClaude = process.env['MOCK_CLAUDE'];

    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    const capturedStdout = (): string =>
      stdoutSpy.mock.calls.map((c) => String(c[0])).join('');

    beforeEach(() => {
      process.env['MOCK_CLAUDE'] = '1';
      delete process.env['NODE_ENV'];
      stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      process.exitCode = undefined;
    });

    afterEach(async () => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
      if (originalMockClaude === undefined) delete process.env['MOCK_CLAUDE'];
      else process.env['MOCK_CLAUDE'] = originalMockClaude;

      await db
        .delete(theoryTopics)
        .where(eq(theoryTopics.grammarPointKey, testEntry.key));
      await db
        .delete(theoryGenerationJobs)
        .where(like(theoryGenerationJobs.cellKey, `%${testEntry.key}`));

      process.exitCode = undefined;
    });

    it(
      'happy path — inserts one approved topic and one succeeded audit row',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        await main([
          '--lang',
          'es',
          '--level',
          testEntry.cefrLevel,
          '--grammar-point',
          testEntry.key,
        ]);

        const stdout = capturedStdout();
        expect(stdout).toContain(testEntry.key);
        expect(stdout).toContain('inserted');
        expect(stdout).toContain('Total runtime:');
        expect(process.exitCode === undefined || process.exitCode === 0).toBe(
          true,
        );

        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, testEntry.key));
        expect(topicRows).toHaveLength(1);
        const topic = topicRows[0];
        expect(topic.reviewStatus).toBe('auto-approved');
        expect(topic.modelId).toBe('claude-sonnet-4-5');
        expect(topic.generationSource).toBe('claude-realtime');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(
            like(theoryGenerationJobs.cellKey, `%${testEntry.key}`),
          );
        expect(jobRows).toHaveLength(1);
        const job = jobRows[0];
        expect(job.status).toBe('succeeded');
        expect(job.approved).toBe(true);
        expect(job.flagged).toBe(false);
        expect(job.rejected).toBe(false);
        expect(job.inputTokensUsed ?? 0).toBeGreaterThan(0);
        expect(Number(job.costUsdEstimate ?? 0)).toBeGreaterThan(0);
      },
    );

    it(
      'skip path — second run hits the partial-index collision and appends a no-op audit row',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        const argv = [
          '--lang',
          'es',
          '--level',
          testEntry.cefrLevel,
          '--grammar-point',
          testEntry.key,
        ];

        await main(argv);
        // Drop everything the first run wrote to stdout so the second-run
        // assertions only see the rerun's output.
        stdoutSpy.mockClear();

        await main(argv);

        const stdout = capturedStdout();
        expect(stdout).toContain('0/1 inserted (1 skipped)');
        expect(stdout).toContain('cell already filled');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(
            and(
              eq(theoryGenerationJobs.status, 'succeeded'),
              like(theoryGenerationJobs.cellKey, `%${testEntry.key}`),
            ),
          );
        expect(jobRows).toHaveLength(2);

        const skipped = jobRows.find((r) => r.approved === false);
        expect(skipped).toBeDefined();
        expect(skipped!.errorMessage).toContain('cell already filled');
      },
    );

    it(
      'dry run — no DB writes, stdout shows the cost estimate',
      { timeout: DB_TEST_TIMEOUT_MS },
      async () => {
        await main([
          '--lang',
          'es',
          '--level',
          testEntry.cefrLevel,
          '--grammar-point',
          testEntry.key,
          '--dry-run=true',
        ]);

        const stdout = capturedStdout();
        expect(stdout).toContain('~5,000 input');
        expect(stdout).toContain('Total estimated cost');

        const topicRows = await db
          .select({ id: theoryTopics.id })
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, testEntry.key));
        expect(topicRows).toHaveLength(0);
      },
    );
  },
);
