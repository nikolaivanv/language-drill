/**
 * Tests for the `pnpm generate:exercises` CLI.
 *
 * Pure planning tests (parseGenerateArgs + resolveCells) always run.
 * DB-touching integration tests are gated on TEST_DATABASE_URL being set —
 * matches the convention from Phase 1's seed-exercises.test.ts.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { deterministicUuid } from '../src/lib/deterministic-uuid';
import { exerciseTags, exercises, generationJobs } from '../src/schema/index';

import { main, type CellResult } from './generate-exercises';
import {
  parseGenerateArgs,
  type ParsedArgs,
} from './generate-exercises-parse-args';
import { resolveCells } from './generate-exercises-resolve-cells';

// ---------------------------------------------------------------------------
// parseGenerateArgs
// ---------------------------------------------------------------------------

describe('parseGenerateArgs', () => {
  it('rejects --lang en with the EN exclusion message', () => {
    expect(() => parseGenerateArgs(['--lang', 'en', '--level', 'B1'])).toThrow(
      /not a learning language for generation/i,
    );
  });

  it('rejects --count > 200 naming the cap', () => {
    expect(() =>
      parseGenerateArgs(['--lang', 'es', '--level', 'B1', '--count', '201']),
    ).toThrow(/--count must be in \[1, 200\]/);
  });

  it('returns the canonical defaults for a single-cell invocation', () => {
    const args = parseGenerateArgs([
      '--lang',
      'es',
      '--level',
      'B1',
      '--type',
      'cloze',
      '--grammar-point',
      'es-b1-present-subjunctive',
    ]);
    expect(args).toEqual({
      lang: Language.ES,
      level: CefrLevel.B1,
      type: ExerciseType.CLOZE,
      grammarPoint: 'es-b1-present-subjunctive',
      count: 50,
      topicDomain: null,
      batchSeed: 'phase-2-default',
      maxCostUsd: 5,
      concurrency: 1,
      dryRun: false,
      allowProd: false,
    });
  });

  it('rejects --grammar-point without a concrete --type', () => {
    expect(() =>
      parseGenerateArgs([
        '--lang',
        'es',
        '--level',
        'B1',
        '--grammar-point',
        'es-b1-present-subjunctive',
      ]),
    ).toThrow(/scope --type/);
  });

  it('accepts --allow-prod outside production but emits a stderr warning', () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const args = parseGenerateArgs([
        '--lang',
        'es',
        '--level',
        'B1',
        '--allow-prod',
      ]);
      expect(args.allowProd).toBe(true);
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) => /--allow-prod ignored: not running in production/.test(line)),
      ).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// resolveCells
// ---------------------------------------------------------------------------

const baseArgs: ParsedArgs = {
  lang: Language.ES,
  level: CefrLevel.B1,
  type: ExerciseType.CLOZE,
  grammarPoint: null,
  count: 50,
  topicDomain: null,
  batchSeed: 'phase-2-default',
  maxCostUsd: 5,
  concurrency: 1,
  dryRun: false,
  allowProd: false,
};

describe('resolveCells', () => {
  it('returns one cell with a valid cellKey for a single grammar point', () => {
    const cells = resolveCells(
      {
        ...baseArgs,
        type: ExerciseType.CLOZE,
        grammarPoint: 'es-b1-present-subjunctive',
      },
      ALL_CURRICULA,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKey).toBe('es:b1:cloze:es-b1-present-subjunctive');
    expect(cells[0].language).toBe(Language.ES);
    expect(cells[0].cefrLevel).toBe(CefrLevel.B1);
    expect(cells[0].exerciseType).toBe(ExerciseType.CLOZE);
    expect(cells[0].grammarPoint.key).toBe('es-b1-present-subjunctive');
  });

  it("respects kind compatibility for --type all (vocab umbrellas only with vocab_recall)", () => {
    const cells = resolveCells(
      { ...baseArgs, type: 'all', grammarPoint: null },
      ALL_CURRICULA,
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      if (cell.grammarPoint.kind === 'vocab') {
        expect(cell.exerciseType).toBe(ExerciseType.VOCAB_RECALL);
      } else {
        expect([ExerciseType.CLOZE, ExerciseType.TRANSLATION]).toContain(cell.exerciseType);
      }
    }
  });

  it('throws when --grammar-point is unknown', () => {
    expect(() =>
      resolveCells(
        {
          ...baseArgs,
          type: ExerciseType.CLOZE,
          grammarPoint: 'es-b1-no-such-thing',
        },
        ALL_CURRICULA,
      ),
    ).toThrow(/not in curriculum/);
  });
});

// ---------------------------------------------------------------------------
// DB-touching integration tests
// ---------------------------------------------------------------------------

const TEST_GRAMMAR_POINT_KEY = 'es-b1-present-subjunctive';
const TEST_CELL_KEY = `es:b1:cloze:${TEST_GRAMMAR_POINT_KEY}`;
const TEST_SKILL_TOPIC_ID = deterministicUuid(`skill-topic:${TEST_GRAMMAR_POINT_KEY}`);

const HAPPY_PATH_ARGV = [
  '--lang', 'es',
  '--level', 'B1',
  '--type', 'cloze',
  '--grammar-point', TEST_GRAMMAR_POINT_KEY,
  '--count', '6',
];

async function cleanCellRows(db: Db): Promise<void> {
  // generation_jobs: scoped by cellKey.
  await db.delete(generationJobs).where(eq(generationJobs.cellKey, TEST_CELL_KEY));

  // exercises + exercise_tags: scoped by (generationSource = claude-realtime
  // AND grammarPointKey = ?) so we never delete the manual seed exercises
  // (which use generationSource = 'manual').
  const generated = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.generationSource, 'claude-realtime'),
        eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
      ),
    );
  if (generated.length > 0) {
    const ids = generated.map((r) => r.id);
    await db.delete(exerciseTags).where(inArray(exerciseTags.exerciseId, ids));
    await db.delete(exercises).where(inArray(exercises.id, ids));
  }
}

// Neon serverless roundtrips for 6–12 drafts + audit-row writes can exceed
// vitest's default 5s timeout on a cold connection.
const DB_TEST_TIMEOUT_MS = 60_000;

describe.skipIf(!process.env['TEST_DATABASE_URL'])('main + DB writes (MOCK_CLAUDE)', () => {
  let db: Db;
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalMockClaude = process.env['MOCK_CLAUDE'];
  const originalFixturesDir = process.env['MOCK_CLAUDE_FIXTURES_DIR'];

  beforeAll(() => {
    db = createDb(process.env['TEST_DATABASE_URL']!);
    process.env['MOCK_CLAUDE'] = '1';
    delete process.env['NODE_ENV'];
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalMockClaude === undefined) delete process.env['MOCK_CLAUDE'];
    else process.env['MOCK_CLAUDE'] = originalMockClaude;
    if (originalFixturesDir === undefined) delete process.env['MOCK_CLAUDE_FIXTURES_DIR'];
    else process.env['MOCK_CLAUDE_FIXTURES_DIR'] = originalFixturesDir;
  });

  afterEach(async () => {
    await cleanCellRows(db);
    delete process.env['MOCK_CLAUDE_FIXTURES_DIR'];
    process.exitCode = 0;
  });

  it('inserts 6 drafts and one succeeded audit row on the happy path', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    await main(HAPPY_PATH_ARGV);

    const exerciseRows = await db
      .select()
      .from(exercises)
      .where(
        and(
          eq(exercises.generationSource, 'claude-realtime'),
          eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
        ),
      );
    expect(exerciseRows).toHaveLength(6);
    for (const row of exerciseRows) {
      expect(row.language).toBe(Language.ES);
      expect(row.difficulty).toBe('B1');
      expect(row.type).toBe(ExerciseType.CLOZE);
      expect(row.modelId).toBe('claude-sonnet-4-5');
      expect(row.reviewStatus).toBe('auto-approved');
      expect(row.qualityScore).toBeNull();
      expect(row.flaggedReasons).toBeNull();
      expect(row.audioS3Key).toBeNull();
    }

    const tagRows = await db
      .select()
      .from(exerciseTags)
      .where(inArray(exerciseTags.exerciseId, exerciseRows.map((r) => r.id)));
    expect(tagRows).toHaveLength(6);
    for (const tag of tagRows) {
      expect(tag.skillTopicId).toBe(TEST_SKILL_TOPIC_ID);
    }

    const jobRows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
    expect(jobRows).toHaveLength(1);
    const job = jobRows[0];
    expect(job.status).toBe('succeeded');
    expect(job.producedCount).toBe(6);
    expect(job.approvedCount).toBe(6);
    expect(job.flaggedCount).toBe(0);
    expect(job.rejectedCount).toBe(0);
    expect(job.inputTokensUsed ?? 0).toBeGreaterThan(0);
    expect(job.outputTokensUsed ?? 0).toBeGreaterThan(0);
    expect(Number(job.costUsdEstimate ?? 0)).toBeGreaterThan(0);
    expect(job.errorMessage).toBeNull();
  });

  it('is idempotent on re-run (append-only audit, no new exercise rows)', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    await main(HAPPY_PATH_ARGV);
    await main(HAPPY_PATH_ARGV);

    const exerciseRows = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.generationSource, 'claude-realtime'),
          eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
        ),
      );
    expect(exerciseRows).toHaveLength(6);

    const tagRows = await db
      .select()
      .from(exerciseTags)
      .where(inArray(exerciseTags.exerciseId, exerciseRows.map((r) => r.id)));
    expect(tagRows).toHaveLength(6);

    const jobRows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
    expect(jobRows).toHaveLength(2);
    for (const job of jobRows) {
      expect(job.status).toBe('succeeded');
      expect(job.producedCount).toBe(6);
      expect(job.approvedCount).toBe(6);
    }
  });

  it('rolls back on parser failure: no exercise rows, audit row marked failed', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    // Inject a malformed third cloze fixture into a temp dir, point the mock
    // there via MOCK_CLAUDE_FIXTURES_DIR. The mock loads its fixtures fresh on
    // each createMockAnthropicClient call, so this isolates from the default
    // fixtures used by the prior tests.
    const tempDir = mkdtempSync(join(tmpdir(), 'gen-exercises-fixtures-'));
    try {
      writeFileSync(
        join(tempDir, 'cloze.json'),
        JSON.stringify([
          // ordinal 0 — valid
          {
            type: 'cloze',
            instructions: 'Fill in the blank.',
            sentence: 'Espero que tú ___ pronto.',
            correctAnswer: 'vengas',
          },
          // ordinal 1 — valid
          {
            type: 'cloze',
            instructions: 'Fill in the blank.',
            sentence: 'Cuando ___ tiempo, te llamaré.',
            correctAnswer: 'tenga',
          },
          // ordinal 2 — malformed (empty correctAnswer fails the parser invariant)
          {
            type: 'cloze',
            instructions: 'Fill in the blank.',
            sentence: 'Es importante que nosotros ___ a la reunión.',
            correctAnswer: '',
          },
        ]),
        'utf8',
      );
      // Translation + vocab fixtures aren't loaded for this argv (--type cloze
      // only), but write empty-but-valid placeholders so an accidental load
      // doesn't crash on ENOENT.
      writeFileSync(join(tempDir, 'translation.json'), JSON.stringify([]), 'utf8');
      writeFileSync(join(tempDir, 'vocab_recall.json'), JSON.stringify([]), 'utf8');
      process.env['MOCK_CLAUDE_FIXTURES_DIR'] = tempDir;

      await main(HAPPY_PATH_ARGV);

      const exerciseRows = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(
          and(
            eq(exercises.generationSource, 'claude-realtime'),
            eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
          ),
        );
      expect(exerciseRows).toHaveLength(0);

      const jobRows = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
      expect(jobRows).toHaveLength(1);
      const job = jobRows[0];
      expect(job.status).toBe('failed');
      expect(job.errorMessage).not.toBeNull();
      expect(job.errorMessage ?? '').toMatch(/ordinal=2/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('production guard exits 1 and skips DB writes', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    process.env['NODE_ENV'] = 'production';
    // Mock exit to throw rather than no-op, so main() actually halts before
    // touching the DB (real runs terminate the process; tests need an
    // alternative bail mechanism).
    const exitError = new Error('process.exit called');
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((..._args: unknown[]) => {
        throw exitError;
      }) as typeof process.exit);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(main(HAPPY_PATH_ARGV)).rejects.toBe(exitError);
      expect(exitSpy).toHaveBeenCalledWith(1);

      const exerciseRows = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(
          and(
            eq(exercises.generationSource, 'claude-realtime'),
            eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
          ),
        );
      expect(exerciseRows).toHaveLength(0);

      const jobRows = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
      expect(jobRows).toHaveLength(0);
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      delete process.env['NODE_ENV'];
    }
  });

  // Touch CellResult so the import is not dropped — printSummary's row shape
  // is asserted indirectly via the audit-row + insert-row contents above.
  it('exports the CellResult type', () => {
    const sample: CellResult = {
      cell: {
        language: Language.ES,
        cefrLevel: CefrLevel.B1,
        exerciseType: ExerciseType.CLOZE,
        grammarPoint: ALL_CURRICULA.find((g) => g.key === TEST_GRAMMAR_POINT_KEY)!,
        cellKey: TEST_CELL_KEY,
      },
      jobId: 'sentinel',
      status: 'succeeded',
      insertedCount: 0,
      skippedCount: 0,
      tokenUsage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
      },
      costUsd: 0,
      durationMs: 0,
      inBatchDuplicateCount: 0,
    };
    expect(sample.status).toBe('succeeded');
  });
});
