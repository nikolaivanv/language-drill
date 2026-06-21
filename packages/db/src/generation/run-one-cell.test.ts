/**
 * Integration tests for the shared `runOneCell` orchestration core.
 *
 * Moved from `packages/db/scripts/generate-exercises.test.ts`'s
 * `Phase 3: validator + dedup` describe block — Phase 4 extracted the
 * orchestration to `packages/db/src/generation/run-one-cell.ts`, so its
 * tests live here next to it. Each test calls `runOneCell` directly
 * (rather than driving the CLI's `main`) so the package surface is
 * exercised independently of the CLI script.
 *
 * Gated on `TEST_DATABASE_URL`; the mock Claude client (loaded from the
 * scripts directory because the fixtures live next to it) is selected
 * by `MOCK_CLAUDE=1`.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import {
  VALIDATION_TOOL_NAME,
  ZERO_USAGE,
  canonicalSurface,
  exerciseDraftId,
  type ExerciseDraft,
  type GenerationSpec,
} from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  GenerationReasonCode,
  Language,
  REJECTED_BRANCH_CODES,
  type LearningLanguage,
} from '@language-drill/shared';
import { and, eq } from 'drizzle-orm';
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

import { createDb, type Db } from '../client';
import { ALL_CURRICULA } from '../curriculum';
import type { CurriculumCefrLevel } from '../curriculum';
import { exerciseTags, exercises, generationJobs, vocabLemma } from '../schema/index';
// The mock client lives in scripts/ because its fixtures do; cross-boundary
// import is acceptable for test infrastructure.
import { createMockAnthropicClient } from '../../scripts/generate-exercises-mock-client';

import type { Cell } from './cells';
import {
  buildSeedWords,
  fetchPriorVocabRecallSurfaces,
  runOneCell,
  seedKindFor,
  tallyCoverageOutcome,
} from './run-one-cell';
import type { CoverageSpec, CoverageTarget, CoverageTags } from '@language-drill/shared';
import { runGeneratorPool } from './generator-pool';
import { runValidatorPool } from './validator-pool';
import { runOutcomePool } from './outcome-pool';
import { VOCAB_MAX_PER_WORD, type DraftOutcome } from './validate-and-insert';

// Partial mocks for the `approvedDictationIds` collection suite below. The
// factories spread the REAL module and wrap each pool entry-point in a spy
// that calls through by default — so the `TEST_DATABASE_URL`-gated integration
// suite (which needs the real pools) is unaffected; only the pool-mocked suite
// overrides them per-test via `mockResolvedValue`.
vi.mock('./generator-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generator-pool')>();
  return { ...actual, runGeneratorPool: vi.fn(actual.runGeneratorPool) };
});
vi.mock('./validator-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./validator-pool')>();
  return { ...actual, runValidatorPool: vi.fn(actual.runValidatorPool) };
});
vi.mock('./outcome-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./outcome-pool')>();
  return { ...actual, runOutcomePool: vi.fn(actual.runOutcomePool) };
});

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const TEST_GRAMMAR_POINT_KEY = 'es-b1-present-subjunctive';
const TEST_CELL_KEY = `es:b1:cloze:${TEST_GRAMMAR_POINT_KEY}`;

const TEST_TIMEOUT_MS = 60_000;

/** Mirrors `packages/db/scripts/__fixtures__/claude-generation/cloze.json` */
const CLOZE_FIXTURES: ReadonlyArray<Record<string, unknown>> = [
  {
    type: ExerciseType.CLOZE,
    instructions: 'Fill in the blank with the correct present subjunctive form.',
    sentence: 'Espero que tú ___ pronto a la fiesta.',
    correctAnswer: 'vengas',
    context: 'Present subjunctive after expressions of hope (esperar que).',
    topicHint: 'social',
  },
  {
    type: ExerciseType.CLOZE,
    instructions: 'Complete the sentence with the appropriate verb form.',
    sentence: 'Cuando ___ tiempo, te llamaré por teléfono.',
    correctAnswer: 'tenga',
    context: 'Subjunctive in adverbial clauses with cuando referring to the future.',
    topicHint: 'everyday',
  },
  {
    type: ExerciseType.CLOZE,
    instructions: 'Fill in the blank using the present subjunctive.',
    sentence: 'Es importante que nosotros ___ a la reunión a tiempo.',
    correctAnswer: 'asistamos',
    options: ['asistimos', 'asistamos', 'asistiremos', 'asistíamos'],
    topicHint: 'work',
  },
];

function buildTestCell(): Cell {
  const grammarPoint = ALL_CURRICULA.find(
    (g) => g.key === TEST_GRAMMAR_POINT_KEY,
  );
  if (!grammarPoint) {
    throw new Error(
      `Test fixture missing: grammar point '${TEST_GRAMMAR_POINT_KEY}' not in ALL_CURRICULA`,
    );
  }
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint,
    cellKey: TEST_CELL_KEY,
  };
}

function buildTestSpec(batchSeed: string, count: number): GenerationSpec {
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: ALL_CURRICULA.find((g) => g.key === TEST_GRAMMAR_POINT_KEY)!,
    topicDomain: null,
    count,
    batchSeed,
  };
}

async function cleanCellRows(db: Db): Promise<void> {
  await db.delete(generationJobs).where(eq(generationJobs.cellKey, TEST_CELL_KEY));
  const generated = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.generationSource, 'claude-realtime'),
        eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
      ),
    );
  for (const row of generated) {
    await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, row.id));
    await db.delete(exercises).where(eq(exercises.id, row.id));
  }
}

async function seedAutoApprovedRow(
  db: Db,
  content: Record<string, unknown>,
): Promise<void> {
  const dedupKey = canonicalSurface(
    content as Parameters<typeof canonicalSurface>[0],
  );
  await db.insert(exercises).values({
    id: randomUUID(),
    type: ExerciseType.CLOZE,
    language: Language.ES,
    difficulty: 'B1',
    contentJson: { ...content, _dedupKey: dedupKey },
    grammarPointKey: TEST_GRAMMAR_POINT_KEY,
    generationSource: 'claude-realtime',
    modelId: 'claude-sonnet-4-5',
    reviewStatus: 'auto-approved',
    generatedAt: new Date('2026-04-01T00:00:00Z'),
  });
}

async function invokeRunOneCell(
  db: Db,
  count: number,
  batchSeed: string,
): Promise<ReturnType<typeof runOneCell>> {
  const client = createMockAnthropicClient();
  return runOneCell({
    db,
    client,
    cell: buildTestCell(),
    args: {
      count,
      batchSeed,
      topicDomain: null,
      maxCostUsd: 5,
    },
    jobId: randomUUID(),
    trigger: 'cli',
  });
}

/**
 * Bounded-cardinality guard for `rejection_reason_counts` (Req 5.1, 3.3, 3.4):
 * every key must be a canonical reject-branch reason *code*, never free-form
 * prose or a value-interpolated string.
 *
 * - Primary: set-membership in `REJECTED_BRANCH_CODES` — the only codes that
 *   can ever terminate an ordinal `rejected` and thus key this map.
 * - Secondary shape guard: a code never carries a `:` separator (those mark
 *   `formatReason` detail joins, e.g. `cultural issue: <prose>`) and is never
 *   sentence-length, so a regression that leaked `detail` into the key would
 *   trip even if the leaked string happened to collide with a code name.
 */
const REJECTED_CODES = new Set<string>(REJECTED_BRANCH_CODES);
function assertBoundedReasonKeys(counts: Record<string, number>): void {
  for (const key of Object.keys(counts)) {
    expect(REJECTED_CODES.has(key)).toBe(true);
    expect(key).not.toContain(':');
    expect(key.length).toBeLessThan(40);
  }
}

/**
 * Wraps `createMockAnthropicClient` so the test can count generator vs.
 * validator calls by inspecting `args.tool_choice.name`. Used by the Phase A
 * (validator-parallelization) assertions to prove (a) no double-validation
 * on attempt 0, (b) dedup retries still issue live validateDraft calls, and
 * (d) the all-malformed-batch path fail-closes before the worker pool runs.
 */
function createCountingMockClient(): {
  client: Anthropic;
  counts: { validator: number; generator: number };
} {
  const inner = createMockAnthropicClient();
  const counts = { validator: 0, generator: 0 };
  const innerCreate = inner.messages.create.bind(inner.messages);
  const wrappedCreate = (
    args: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ): ReturnType<typeof innerCreate> => {
    const tc = args.tool_choice;
    if (tc && tc.type === 'tool' && tc.name === VALIDATION_TOOL_NAME) {
      counts.validator += 1;
    } else {
      counts.generator += 1;
    }
    return innerCreate(args);
  };
  const client = {
    messages: { create: wrappedCreate },
  } as unknown as Anthropic;
  return { client, counts };
}

async function invokeRunOneCellWithClient(
  db: Db,
  client: Anthropic,
  count: number,
  batchSeed: string,
): Promise<ReturnType<typeof runOneCell>> {
  return runOneCell({
    db,
    client,
    cell: buildTestCell(),
    args: {
      count,
      batchSeed,
      topicDomain: null,
      maxCostUsd: 5,
    },
    jobId: randomUUID(),
    trigger: 'cli',
  });
}

// ---------------------------------------------------------------------------
// seedKindFor — pure type gate (R5.1). Runs without a database.
// ---------------------------------------------------------------------------

describe('seedKindFor', () => {
  const cellOf = (exerciseType: ExerciseType): Cell => ({
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType,
    grammarPoint: ALL_CURRICULA.find((g) => g.key === TEST_GRAMMAR_POINT_KEY)!,
    cellKey: 'es:b1:x:es-test',
  });

  it('returns frequency for cloze and translation', () => {
    expect(seedKindFor(cellOf(ExerciseType.CLOZE))).toBe('frequency');
    expect(seedKindFor(cellOf(ExerciseType.TRANSLATION))).toBe('frequency');
  });

  it('returns verb for conjugation', () => {
    expect(seedKindFor(cellOf(ExerciseType.CONJUGATION))).toBe('verb');
  });

  it('returns null for a conjugation cell of a nominal point (conjugationSeedKind: none)', () => {
    // Nominal-inflection points (possessive/case/copula) decline a noun, not a
    // verb — a verb seed + the strict "use exactly this verb" directive would
    // contradict the grammar point, so they must generate unseeded.
    const base = ALL_CURRICULA.find((g) => g.key === TEST_GRAMMAR_POINT_KEY)!;
    const nominalCell: Cell = {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      exerciseType: ExerciseType.CONJUGATION,
      grammarPoint: { ...base, conjugationSeedKind: 'none' },
      cellKey: 'es:b1:conjugation:es-test',
    };
    expect(seedKindFor(nominalCell)).toBeNull();
  });

  it('returns null for vocab_recall', () => {
    expect(seedKindFor(cellOf(ExerciseType.VOCAB_RECALL))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'runOneCell — validator + dedup integration',
  () => {
    let db: Db;
    const originalNodeEnv = process.env['NODE_ENV'];
    const originalMockClaude = process.env['MOCK_CLAUDE'];

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
    });

    beforeEach(async () => {
      await cleanCellRows(db);
    });

    afterEach(async () => {
      await cleanCellRows(db);
      delete process.env['MOCK_VALIDATION_OUTCOMES'];
      delete process.env['MOCK_VALIDATION_PERSONS'];
      delete process.env['MOCK_VALIDATION_THROW_ORDINAL'];
      delete process.env['MOCK_VALIDATION_MALFORM_ORDINAL'];
      delete process.env['MOCK_CLAUDE_FIXTURES_DIR'];
      delete process.env['MOCK_CLAUDE_VALIDATION_FIXTURES_DIR'];
      process.exitCode = 0;
    });

    it(
      'mixed-outcome batch: routes approved/flagged/rejected and pins token totals',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        process.env['MOCK_VALIDATION_OUTCOMES'] = JSON.stringify({
          '0': 'approved',
          '1': 'flagged',
          '2': 'rejected',
        });

        const batchSeed = 'phase-4-test-mixed';
        const result = await invokeRunOneCell(db, 3, batchSeed);

        const spec = buildTestSpec(batchSeed, 3);
        const id0 = exerciseDraftId(spec, 0);
        const id1 = exerciseDraftId(spec, 1);
        const id2 = exerciseDraftId(spec, 2);

        const row0 = await db.select().from(exercises).where(eq(exercises.id, id0));
        expect(row0).toHaveLength(1);
        expect(row0[0].reviewStatus).toBe('auto-approved');
        expect(row0[0].qualityScore ?? 0).toBeCloseTo(0.85, 2);
        expect(row0[0].flaggedReasons).toBeNull();
        expect(
          (row0[0].contentJson as Record<string, unknown>)['_dedupKey'],
        ).toEqual(expect.any(String));

        const row1 = await db.select().from(exercises).where(eq(exercises.id, id1));
        expect(row1).toHaveLength(1);
        expect(row1[0].reviewStatus).toBe('flagged');
        expect(row1[0].qualityScore ?? 0).toBeCloseTo(0.6, 2);
        expect(Array.isArray(row1[0].flaggedReasons)).toBe(true);
        expect((row1[0].flaggedReasons as unknown[]).length).toBeGreaterThan(0);

        const row2 = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(eq(exercises.id, id2));
        expect(row2).toHaveLength(0);

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.status).toBe('succeeded');
        expect(job.producedCount).toBe(3);
        expect(job.approvedCount).toBe(1);
        expect(job.flaggedCount).toBe(1);
        expect(job.rejectedCount).toBe(1);
        expect(Number(job.costUsdEstimate ?? 0)).toBeGreaterThan(0);

        // Rejection-reason distribution: ordinal 2's fixture is sub-0.5
        // quality, so the routed reason is captured (keyed on the canonical
        // `code`) both on the CellResult and persisted to the audit row.
        expect(result.rejectionReasonCounts).toEqual({
          [GenerationReasonCode.LowQualityReject]: 1,
        });
        expect(job.rejectionReasonCounts).toEqual({
          [GenerationReasonCode.LowQualityReject]: 1,
        });
        // Every key is a bounded reject-branch code (Req 5.1).
        assertBoundedReasonKeys(result.rejectionReasonCounts);
        assertBoundedReasonKeys(
          job.rejectionReasonCounts as Record<string, number>,
        );

        // Token regression guard. Mock token shape:
        //   1 generator call (cache-write):   input=1500 cacheRead=0    output=400
        //   1 validator call (cache-write):   input=1500 cacheRead=0    output=400
        //   2 validator calls (cache-read):   input=100  cacheRead=1400 output=400 each
        // Totals → input=1500+1500+100+100=3200, cacheRead=2800, output=4*400=1600.
        expect(job.outputTokensUsed).toBe(1600);
        expect(job.inputTokensUsed).toBe(3200 + 0 + 2800);
      },
    );

    it(
      'parity: 5-ordinal mixed batch counters land in the right buckets under the parallel outcome pool',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Regression guard for the parallel outcome pool (PR #124). Five
        // ordinals span every non-dedup terminalStatus the post-walk
        // accumulator handles:
        //   - 0 → auto-approved (insert path)
        //   - 1 → flagged       (insert path)
        //   - 2 → rejected      (no insert)
        //   - 3 → flagged       (insert path)
        //   - 4 → auto-approved (insert path)
        // The pool can complete these in any order, but the post-walk in
        // run-one-cell.ts iterates by ordinal so the final counters must
        // be deterministic. (Dedup-given-up is covered separately by the
        // count=1 test below.)
        process.env['MOCK_VALIDATION_OUTCOMES'] = JSON.stringify({
          '0': 'approved',
          '1': 'flagged',
          '2': 'rejected',
          '3': 'flagged',
          '4': 'approved',
        });

        const batchSeed = 'phase-parity-test-pool';
        const result = await invokeRunOneCell(db, 5, batchSeed);

        expect(result.status).toBe('succeeded');
        expect(result.insertedCount).toBe(4);
        expect(result.skippedCount).toBe(0);
        expect(result.dedupGivenUpCount).toBe(0);

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.status).toBe('succeeded');
        expect(job.producedCount).toBe(5);
        expect(job.approvedCount).toBe(2);
        expect(job.flaggedCount).toBe(2);
        expect(job.rejectedCount).toBe(1);
        expect(job.dedupGivenUpCount).toBe(0);

        // Per-ordinal exercise-row spot check — confirms the precomputed
        // first-validation was forwarded by ordinal (not shuffled by the
        // pool's worker dispatch).
        const spec = buildTestSpec(batchSeed, 5);
        const rowByOrd = await Promise.all(
          [0, 1, 2, 3, 4].map((ord) =>
            db
              .select()
              .from(exercises)
              .where(eq(exercises.id, exerciseDraftId(spec, ord))),
          ),
        );
        expect(rowByOrd[0][0]?.reviewStatus).toBe('auto-approved');
        expect(rowByOrd[1][0]?.reviewStatus).toBe('flagged');
        expect(rowByOrd[2]).toHaveLength(0); // rejected → no row
        expect(rowByOrd[3][0]?.reviewStatus).toBe('flagged');
        expect(rowByOrd[4][0]?.reviewStatus).toBe('auto-approved');
      },
    );

    it(
      'dedup-retry happy path: ordinal-0 collides, retry-1 inserts',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Seed an auto-approved row whose _dedupKey matches the canonical
        // surface of cloze.json[0] (the first generator response). The writer's
        // first INSERT will collide on the dedup index → the retry loop fires.
        await seedAutoApprovedRow(db, CLOZE_FIXTURES[0]);

        const batchSeed = 'phase-4-test-retry';
        await invokeRunOneCell(db, 1, batchSeed);

        const baseSpec = buildTestSpec(batchSeed, 1);
        const originalId = exerciseDraftId(baseSpec, 0);
        const retryId = exerciseDraftId(
          { ...baseSpec, batchSeed: `${batchSeed}::retry-1` },
          0,
        );

        // Original draft id should NOT have a row — the writer's INSERT was
        // a no-op against the seeded row's _dedupKey.
        const originalRow = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(eq(exercises.id, originalId));
        expect(originalRow).toHaveLength(0);

        // Retry-1 draft id should have an inserted auto-approved row.
        const retryRow = await db
          .select()
          .from(exercises)
          .where(eq(exercises.id, retryId));
        expect(retryRow).toHaveLength(1);
        expect(retryRow[0].reviewStatus).toBe('auto-approved');

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.status).toBe('succeeded');
        expect(job.producedCount).toBe(2); // 1 original + 1 retry
        expect(job.approvedCount).toBe(1);
        expect(job.flaggedCount).toBe(0);
        expect(job.rejectedCount).toBe(0);
      },
    );

    it(
      'dedup-given-up: all 3 retries collide, audit row marks rejected',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Seed auto-approved rows whose _dedupKeys match the canonical surface
        // of every cloze fixture (3 entries). The mock cycles fixtures
        // mod-length, so generator calls 1..4 yield surfaces (0,1,2,0) — every
        // attempt collides, ordinal 0 routes to dedup-given-up.
        for (const fixture of CLOZE_FIXTURES) {
          await seedAutoApprovedRow(db, fixture);
        }

        const result = await invokeRunOneCell(db, 1, 'phase-4-test-given-up');

        // The CellResult should report dedup-given-up via dedupGivenUpCount.
        expect(result.dedupGivenUpCount).toBe(1);
        expect(result.rejectedCount).toBe(1);
        expect(result.insertedCount).toBe(0);
        // dedup-given-up is search-space exhaustion, NOT a validator veto, so
        // it must not contribute to the rejection-reason distribution.
        expect(result.rejectionReasonCounts).toEqual({});

        // No new rows inserted by the writer (every attempt collided).
        const inserted = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(
            and(
              eq(exercises.generationSource, 'claude-realtime'),
              eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
            ),
          );
        // Three seeded rows + zero writer inserts.
        expect(inserted).toHaveLength(CLOZE_FIXTURES.length);

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.status).toBe('succeeded');
        // 1 original generator call + 3 retries = 4 drafts produced.
        expect(job.producedCount).toBe(4);
        expect(job.approvedCount).toBe(0);
        expect(job.flaggedCount).toBe(0);
        // dedup-given-up rolls into rejectedCount per the writer.
        expect(job.rejectedCount).toBe(1);
        // …and is also persisted separately so the admin approval-rate
        // metric can back it out (search-space exhaustion, not a quality
        // signal).
        expect(job.dedupGivenUpCount).toBe(1);
        // No genuine validator rejection → the column is NULL, not `{}`.
        expect(job.rejectionReasonCounts).toBeNull();
      },
    );

    it(
      'validator failure marks the cell as failed with no inserts',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        process.env['MOCK_VALIDATION_THROW_ORDINAL'] = '0';

        const result = await invokeRunOneCell(
          db,
          3,
          'phase-4-test-validator-fail',
        );

        expect(result.status).toBe('failed');
        expect(result.errorMessage ?? '').toMatch(
          /Mock validator: synthetic failure/,
        );

        // No rows inserted into exercises for this cell.
        const inserted = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(
            and(
              eq(exercises.generationSource, 'claude-realtime'),
              eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
            ),
          );
        expect(inserted).toHaveLength(0);

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.status).toBe('failed');
        expect(job.errorMessage).not.toBeNull();
        expect(job.errorMessage ?? '').toMatch(
          /Mock validator: synthetic failure/,
        );
      },
    );

    it(
      'R8.3: a malformed validator response isolates to one ordinal — cell still succeeds',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Unlike a transport throw (which fails the cell closed, above), a
        // malformed validator RESPONSE on ordinal 1 must cost only that
        // ordinal: the cell still succeeds, ordinal 1 is rejected + counted as
        // a validator-parse failure, and the other two ordinals insert.
        process.env['MOCK_VALIDATION_MALFORM_ORDINAL'] = '1';

        const result = await invokeRunOneCell(
          db,
          3,
          'phase-4-test-validator-malform',
        );

        expect(result.status).toBe('succeeded');
        expect(result.validatorParseFailedCount).toBe(1);
        // The malformed ordinal terminates `rejected` (folded into the count).
        expect(result.rejectedCount).toBeGreaterThanOrEqual(1);
        // The other two ordinals survived validation and were inserted.
        expect(result.insertedCount).toBe(2);

        // The synthetic reason is folded into the rejection distribution,
        // keyed on its canonical code.
        expect(
          result.rejectionReasonCounts[
            GenerationReasonCode.ValidatorParseFailure
          ],
        ).toBe(1);
        // Bounded-cardinality guard: the synthetic code is a reject-branch code.
        assertBoundedReasonKeys(result.rejectionReasonCounts);

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        expect(jobs[0].status).toBe('succeeded');
        expect(jobs[0].rejectedCount).toBeGreaterThanOrEqual(1);
      },
    );

    it(
      'collapses same-code-different-detail reasons into one summed bucket',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // A single rejected ordinal whose validation surfaces TWO distinct
        // cultural issues. Routing emits two `{ code: cultural-issue, detail }`
        // reasons with different prose; because the frequency map keys on
        // `code` only, both must collapse into a single `cultural-issue: 2`
        // bucket rather than two free-form buckets (the unbounded-cardinality
        // bug this feature fixes — Req 3.3, 3.4, 5.1).
        const tmpValidationDir = mkdtempSync(
          join(tmpdir(), 'reason-collapse-validation-'),
        );
        try {
          writeFileSync(
            join(tmpValidationDir, 'cloze-rejected.json'),
            JSON.stringify({
              qualityScore: 0.8, // >= floor: NOT a low-quality reject…
              ambiguous: false,
              contextSpoilsAnswer: false,
              levelMatch: true,
              grammarPointMatch: true,
              // …two distinct cultural issues are the sole veto, so both
              // reasons share the `cultural-issue` code with different detail.
              culturalIssues: [
                'Assumes familiarity with a regional festival not taught at B1.',
                'References a dated brand name unfamiliar to many learners.',
              ],
              flaggedReasons: [],
            }),
          );
          process.env['MOCK_CLAUDE_VALIDATION_FIXTURES_DIR'] = tmpValidationDir;
          process.env['MOCK_VALIDATION_OUTCOMES'] = JSON.stringify({
            '0': 'rejected',
          });

          const result = await invokeRunOneCell(
            db,
            1,
            'phase-4-test-reason-collapse',
          );

          expect(result.rejectedCount).toBe(1);
          // Two different details, ONE summed bucket keyed on the code.
          expect(result.rejectionReasonCounts).toEqual({
            [GenerationReasonCode.CulturalIssue]: 2,
          });
          assertBoundedReasonKeys(result.rejectionReasonCounts);
        } finally {
          rmSync(tmpValidationDir, { recursive: true, force: true });
        }
      },
    );

    // -----------------------------------------------------------------------
    // Phase A — validator-parallelization invariants.
    //
    // Each `validateAndInsertWithRetry` attempt still increments
    // `validatedCount`, but attempt 0 now consumes Phase A's pre-computed
    // result instead of calling `validateDraft` live. Therefore: total live
    // validator calls (counted by the wrapping client) should equal
    // `result.validatedCount`. Under the pre-spec serial loop the live count
    // would be `drafts.length + result.validatedCount` (Phase A's calls + a
    // second wave from attempt 0). The four cases below pin the new
    // contract end-to-end through Neon + the mock client.
    // -----------------------------------------------------------------------

    it(
      'Phase A: no double-validation — precomputed result is consumed at attempt 0',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const { client, counts } = createCountingMockClient();
        const result = await invokeRunOneCellWithClient(
          db,
          client,
          10,
          'phase-A-test-no-double-validation',
        );

        // With the pre-computed value consumed, every counter++ inside
        // validateAndInsertWithRetry maps 1:1 to either a Phase A live call
        // (attempt 0) or a dedup-retry live call (attempts 1+). Total live
        // validator calls therefore equals validatedCount.
        expect(counts.validator).toBe(result.validatedCount);
        // Sanity floor: Phase A alone must issue one call per surviving draft.
        expect(counts.validator).toBeGreaterThanOrEqual(10);
      },
    );

    it(
      'Phase A: dedup retry still issues a live validateDraft (pre-existing row collision)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Seed an auto-approved row whose _dedupKey matches CLOZE_FIXTURES[0].
        // Drafts at ordinals 0, 3, 6, 9 share that canonical surface (3-fixture
        // mod-cycle) — each will collide on first INSERT and enter the
        // retry-generate path, which must call validateDraft live.
        await seedAutoApprovedRow(db, CLOZE_FIXTURES[0]);

        const { client, counts } = createCountingMockClient();
        const result = await invokeRunOneCellWithClient(
          db,
          client,
          10,
          'phase-A-test-retry-live',
        );

        // 10 Phase A live calls + at least one live retry call.
        expect(counts.validator).toBeGreaterThan(10);
        expect(result.skippedCount).toBeGreaterThanOrEqual(1);
        // Same no-double-validation invariant as the previous test, under
        // retries this time.
        expect(counts.validator).toBe(result.validatedCount);
      },
    );

    it(
      'Phase A: parallel-draft canonical-surface collision resolves to exactly one INSERT',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Two fixtures with the same `sentence` produce the same canonical
        // surface. Both validate in parallel under Phase A; Phase B must
        // serialize the INSERTs via `onConflictDoNothing` so exactly one row
        // lands, and the second draft enters the retry-generate path.
        const tmpFixturesDir = mkdtempSync(
          join(tmpdir(), 'phase-A-canonical-collision-'),
        );
        try {
          writeFileSync(
            join(tmpFixturesDir, 'cloze.json'),
            JSON.stringify([
              {
                type: ExerciseType.CLOZE,
                instructions:
                  'Fill in the blank with the correct present subjunctive form.',
                sentence: 'Espero que tú ___ pronto a la fiesta.',
                correctAnswer: 'vengas',
                context: 'first context',
                topicHint: 'social',
              },
              {
                type: ExerciseType.CLOZE,
                instructions:
                  'Complete the sentence with the appropriate verb form.',
                sentence: 'Espero que tú ___ pronto a la fiesta.',
                correctAnswer: 'vengas',
                context: 'second context',
                topicHint: 'everyday',
              },
            ]),
          );
          process.env['MOCK_CLAUDE_FIXTURES_DIR'] = tmpFixturesDir;

          const result = await invokeRunOneCell(
            db,
            2,
            'phase-A-test-canonical-collision',
          );

          // Exactly one row survives for the shared canonical surface.
          const inserted = await db
            .select({ id: exercises.id })
            .from(exercises)
            .where(
              and(
                eq(exercises.generationSource, 'claude-realtime'),
                eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY),
              ),
            );
          expect(inserted).toHaveLength(1);

          // The second draft must have collided on first INSERT and entered
          // the retry path — fingerprinted by firstAttemptSkippedCount (==
          // result.skippedCount via the CellResult shape).
          expect(result.skippedCount).toBe(1);
        } finally {
          rmSync(tmpFixturesDir, { recursive: true, force: true });
        }
      },
    );

    it(
      'pre-aborted signal: audit row finalizes as failed with the soft-deadline error message',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const controller = new AbortController();
        controller.abort();

        const client = createMockAnthropicClient();
        const result = await runOneCell({
          db,
          client,
          cell: buildTestCell(),
          args: {
            count: 3,
            batchSeed: 'phase-soft-deadline-pre-abort',
            topicDomain: null,
            maxCostUsd: 5,
          },
          jobId: randomUUID(),
          trigger: 'scheduled',
          signal: controller.signal,
        });

        expect(result.status).toBe('failed');

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        expect(jobs[0].status).toBe('failed');
        expect(jobs[0].finishedAt).not.toBeNull();
        // No exercises should have been inserted before the abort fired at
        // the top of the try block (line 469 in run-one-cell.ts).
        const inserted = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(eq(exercises.grammarPointKey, TEST_GRAMMAR_POINT_KEY));
        expect(inserted).toHaveLength(0);
      },
    );

    it(
      'Phase A: all-malformed batch fail-closes before the worker pool runs',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Fixtures that fail the cloze parser (missing `correctAnswer`, no
        // `___` blank). `generateBatch` returns `drafts: []` +
        // `malformedDrafts: [...]`; `runOneCell` throws "All N drafts
        // malformed" BEFORE Phase A is reached — so the wrapped client's
        // validator counter stays at 0.
        const tmpFixturesDir = mkdtempSync(
          join(tmpdir(), 'phase-A-all-malformed-'),
        );
        try {
          writeFileSync(
            join(tmpFixturesDir, 'cloze.json'),
            JSON.stringify([
              { instructions: 'broken fixture', sentence: 'no blank' },
            ]),
          );
          process.env['MOCK_CLAUDE_FIXTURES_DIR'] = tmpFixturesDir;

          const { client, counts } = createCountingMockClient();
          const result = await invokeRunOneCellWithClient(
            db,
            client,
            1,
            'phase-A-test-all-malformed',
          );

          expect(result.status).toBe('failed');
          expect(result.errorMessage ?? '').toMatch(/All 1 drafts malformed/);
          // Phase A short-circuits: no validator calls were issued.
          expect(counts.validator).toBe(0);

          const jobs = await db
            .select()
            .from(generationJobs)
            .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
          expect(jobs).toHaveLength(1);
          expect(jobs[0].status).toBe('failed');
        } finally {
          rmSync(tmpFixturesDir, { recursive: true, force: true });
        }
      },
    );

    // -----------------------------------------------------------------------
    // Phase 2 coverage controller — per-axis coverage_outcome tally.
    //
    // `args.coverageTargets` carries the scheduler's per-ordinal axis targets.
    // `runOneCell` tallies `{requested, approved}` per axis value: `requested`
    // counts every targeted slot (incl. rejected drafts); `approved` counts
    // auto-approved inserts by their REALIZED coverage tags (the validator's
    // `coverage`, surfaced as `DraftOutcome.realizedCoverage`). The realized
    // person per draft is driven by the mock's `MOCK_VALIDATION_PERSONS` env
    // var, which is keyed on a substring of the draft's `correctAnswer` (see
    // parseValidationPersons) — not on validator-call ordinal.
    // -----------------------------------------------------------------------

    it(
      'tallies coverage_outcome by requested target vs. realized coverage tags',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Self-contained validation fixtures (the shared __fixtures__ approved
        // fixture omits the now-required `contextSpoilsAnswer`). `coverage` is
        // injected per-draft below via MOCK_VALIDATION_PERSONS.
        const tmpValidationDir = mkdtempSync(
          join(tmpdir(), 'coverage-tally-validation-'),
        );
        try {
          writeFileSync(
            join(tmpValidationDir, 'cloze-approved.json'),
            JSON.stringify({
              qualityScore: 0.85,
              ambiguous: false,
              contextSpoilsAnswer: false,
              levelMatch: true,
              grammarPointMatch: true,
              culturalIssues: [],
              flaggedReasons: [],
            }),
          );
          writeFileSync(
            join(tmpValidationDir, 'cloze-rejected.json'),
            JSON.stringify({
              qualityScore: 0.3,
              ambiguous: false,
              contextSpoilsAnswer: false,
              levelMatch: false,
              grammarPointMatch: false,
              culturalIssues: [],
              flaggedReasons: [],
            }),
          );
          process.env['MOCK_CLAUDE_VALIDATION_FIXTURES_DIR'] = tmpValidationDir;

          // ordinal 0 → approved, realized '2pl'; ordinal 1 → rejected (no
          // realized person); ordinal 2 → approved, realized '1pl'.
          process.env['MOCK_VALIDATION_OUTCOMES'] = JSON.stringify({
            '0': 'approved',
            '1': 'rejected',
            '2': 'approved',
          });
          // Person is keyed on each draft's `correctAnswer` (content-stable),
          // so it tracks the draft regardless of the validator pool's dispatch
          // order: CLOZE_FIXTURES[0] (`vengas`) → '2pl', [2] (`asistamos`) →
          // '1pl'. [1] (`tenga`) is the rejected ordinal (no person key).
          process.env['MOCK_VALIDATION_PERSONS'] = JSON.stringify({
            vengas: '2pl',
            asistamos: '1pl',
          });

          const result = await runOneCell({
            db,
            client: createMockAnthropicClient(),
            cell: buildTestCell(),
            args: {
              count: 3,
              batchSeed: 'phase-2-coverage-tally',
              topicDomain: null,
              maxCostUsd: 5,
              // requested: 2pl twice, 1pl once (Phase 2 multi-axis targets).
              coverageTargets: [
                { person: '2pl' },
                { person: '2pl' },
                { person: '1pl' },
              ],
            },
            jobId: randomUUID(),
            trigger: 'scheduled',
          });

          expect(result.coverageOutcome).toEqual({
            person: {
              '2pl': { requested: 2, approved: 1 },
              '1pl': { requested: 1, approved: 1 },
            },
          });

          // …and the same value is persisted to the audit row.
          const jobs = await db
            .select()
            .from(generationJobs)
            .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
          expect(jobs).toHaveLength(1);
          expect(jobs[0].coverageOutcome).toEqual({
            person: {
              '2pl': { requested: 2, approved: 1 },
              '1pl': { requested: 1, approved: 1 },
            },
          });
        } finally {
          rmSync(tmpValidationDir, { recursive: true, force: true });
        }
      },
    );

    it(
      'leaves coverage_outcome null when the batch is not coverage-targeted',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // No `args.coverageTargets` → blind rotation, no tally.
        const result = await invokeRunOneCell(db, 3, 'phase-2-coverage-untargeted');

        expect(result.status).toBe('succeeded');
        expect(result.coverageOutcome).toBeNull();

        const jobs = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.cellKey, TEST_CELL_KEY));
        expect(jobs).toHaveLength(1);
        expect(jobs[0].coverageOutcome).toBeNull();
      },
    );

  },
);

// ---------------------------------------------------------------------------
// buildSeedWords — DB-backed band selection (R5.1). Separate suite (no
// beforeEach/afterEach exercises cleanup) so it's isolated from the FK
// constraint failures in the main integration suite when running against a
// production-forked test DB. Seeds vocab_lemma with ES B1 lemmas.
// ---------------------------------------------------------------------------

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'buildSeedWords — DB-backed band selection',
  () => {
    let seedDb: Db;

    beforeAll(async () => {
      seedDb = createDb(process.env['TEST_DATABASE_URL']!);
      await seedDb.delete(vocabLemma);
      await seedDb.insert(vocabLemma).values([
        { language: 'ES', lemma: 'hablar', rank: 2600, posAll: ['VERB'], source: 'wiktextract' },
        { language: 'ES', lemma: 'comer', rank: 2700, posAll: ['VERB'], source: 'wiktextract' },
        { language: 'ES', lemma: 'vivir', rank: 2800, posAll: ['VERB'], source: 'wiktextract' },
        { language: 'ES', lemma: 'beber', rank: 2900, posAll: ['VERB'], source: 'wiktextract' },
        { language: 'ES', lemma: 'libro', rank: 2650, posAll: ['NOUN'], source: 'wiktextract' },
        { language: 'ES', lemma: 'mesa', rank: 2750, posAll: ['NOUN'], source: 'wiktextract' },
      ]);
    });

    afterAll(async () => {
      if (seedDb) await seedDb.delete(vocabLemma);
    });

    it('seeds a cloze cell with one slot per ordinal from DB band', async () => {
      const clozeCell = buildTestCell(); // ES B1 cloze
      const seeds = await buildSeedWords(seedDb, clozeCell, 5, 'seed-batch', new Set());
      expect(seeds).toBeDefined();
      expect(seeds).toHaveLength(5);
      // The seeded band is non-empty, so at least some ordinals get a real seed.
      expect(seeds!.some((s) => s !== null)).toBe(true);
    });

    it('seeds a translation cell from DB band', async () => {
      const clozeCell = buildTestCell();
      const translationCell: Cell = {
        ...clozeCell,
        exerciseType: ExerciseType.TRANSLATION,
      };
      const seeds = await buildSeedWords(seedDb, translationCell, 3, 'seed-batch', new Set());
      expect(seeds).toHaveLength(3);
    });

    it('does NOT seed a vocab_recall cell (returns undefined)', async () => {
      const clozeCell = buildTestCell();
      const vocabCell: Cell = {
        ...clozeCell,
        exerciseType: ExerciseType.VOCAB_RECALL,
      };
      expect(await buildSeedWords(seedDb, vocabCell, 5, 'seed-batch', new Set())).toBeUndefined();
    });

    it('excludes prior seeds (cross-run dedup, R5.3)', async () => {
      const clozeCell = buildTestCell();
      const all = (await buildSeedWords(seedDb, clozeCell, 10, 'seed-batch', new Set()))!;
      const firstNonNull = all.find((s): s is string => s !== null)!;
      const reseeded = (await buildSeedWords(seedDb, clozeCell, 10, 'seed-batch', new Set([firstNonNull])))!;
      expect(reseeded).not.toContain(firstNonNull);
    });

    it('seeds conjugation cells (any language) with verbs from DB band', async () => {
      const clozeCell = buildTestCell();
      const conjCell: Cell = {
        ...clozeCell,
        exerciseType: ExerciseType.CONJUGATION,
        cellKey: 'es:b1:conjugation:es-b1-present-subjunctive',
      };
      const targets = [{ person: '1sg' }, { person: '2sg' }, { person: '3sg' }];
      const seeds = await buildSeedWords(seedDb, conjCell, 3, 'seed-b', new Set(), targets);
      expect(seeds).toBeDefined();
      expect(seeds!.filter((s) => typeof s === 'string').length).toBeGreaterThan(0);
    });
  },
);

// ---------------------------------------------------------------------------
// fetchPriorVocabRecallSurfaces — R6.5 at-cap avoid-set. Under the `word::cue`
// dedup key a word may carry up to VOCAB_MAX_PER_WORD exercises, so the
// generator's avoid-set must contain ONLY words that have reached the cap;
// under-cap words are intentionally omitted so they can be re-proposed with a
// new cue. The grouping/HAVING is SQL-side, so this is a DB-gated integration
// test like its siblings above.
// ---------------------------------------------------------------------------

const VOCAB_CAP_GP_KEY = 'es-a1-vocab-cap-test';

const vocabCapCell: Cell = {
  language: Language.ES as LearningLanguage,
  cefrLevel: CefrLevel.A1 as CurriculumCefrLevel,
  exerciseType: ExerciseType.VOCAB_RECALL,
  grammarPoint: { key: VOCAB_CAP_GP_KEY } as unknown as Cell['grammarPoint'],
  cellKey: `es:a1:vocab_recall:${VOCAB_CAP_GP_KEY}`,
};

async function seedVocabRow(
  db: Db,
  expectedWord: string,
  prompt: string,
): Promise<void> {
  const content = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: 'Recall the word.',
    prompt,
    expectedWord,
    hints: [],
    exampleSentence: 'x',
  };
  const dedupKey = canonicalSurface(
    content as Parameters<typeof canonicalSurface>[0],
  );
  await db.insert(exercises).values({
    id: randomUUID(),
    type: ExerciseType.VOCAB_RECALL,
    language: Language.ES,
    difficulty: 'A1',
    contentJson: { ...content, _dedupKey: dedupKey },
    grammarPointKey: VOCAB_CAP_GP_KEY,
    generationSource: 'claude-realtime',
    modelId: 'claude-sonnet-4-5',
    reviewStatus: 'auto-approved',
    generatedAt: new Date('2026-04-01T00:00:00Z'),
  });
}

async function cleanVocabCapRows(db: Db): Promise<void> {
  const rows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.grammarPointKey, VOCAB_CAP_GP_KEY));
  for (const row of rows) {
    await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, row.id));
    await db.delete(exercises).where(eq(exercises.id, row.id));
  }
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'fetchPriorVocabRecallSurfaces — R6.5 at-cap avoid-set',
  () => {
    let db: Db;

    beforeAll(() => {
      db = createDb(process.env['TEST_DATABASE_URL']!);
    });

    beforeEach(async () => {
      await cleanVocabCapRows(db);
    });

    afterEach(async () => {
      await cleanVocabCapRows(db);
    });

    it('returns only words that have reached the per-word cap', async () => {
      // "casa": VOCAB_MAX_PER_WORD distinct (word, cue) rows → at cap.
      for (let i = 0; i < VOCAB_MAX_PER_WORD; i++) {
        await seedVocabRow(db, 'casa', `cue número ${i}`);
      }
      // "perro": one short of the cap → still re-proposable with a new cue.
      for (let i = 0; i < VOCAB_MAX_PER_WORD - 1; i++) {
        await seedVocabRow(db, 'perro', `cue número ${i}`);
      }

      const surfaces = await fetchPriorVocabRecallSurfaces(db, vocabCapCell);

      expect(surfaces).toContain('casa');
      expect(surfaces).not.toContain('perro');
    });

    it('returns an empty avoid-set when no word has reached the cap', async () => {
      await seedVocabRow(db, 'gato', 'sólo una pista');

      const surfaces = await fetchPriorVocabRecallSurfaces(db, vocabCapCell);

      expect(surfaces).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// approvedDictationIds — pure (pool-mocked) coverage of the PR 2 collection
// logic. The three Claude pools are spied with a call-through default (so the
// integration suite above, gated on TEST_DATABASE_URL and run first in file
// order, sees the real pools); a hand-rolled mock `Db` satisfies the
// skill-topic precheck + audit-row insert/update, so this suite runs WITHOUT a
// live database (dictation generation isn't wired into the fixture mock client
// yet, so a real-DB integration path for it doesn't exist).
//
// Asserts: a DICTATION cell where N drafts terminate on an inserting status
// surfaces those inserted ids on `CellResult.approvedDictationIds` (length N,
// covering approved + flagged + dedup-then-success); a CLOZE cell with the
// same outcomes surfaces `[]`.
// ---------------------------------------------------------------------------

describe('runOneCell — approvedDictationIds collection (pool-mocked)', () => {
  /** Minimal chainable `Db` stub: skill-topic precheck returns one row; all
   *  other selects resolve to that same single-row array (harmless for the
   *  seed/prior-pool queries, which only run on seedable/vocab cells anyway);
   *  insert/update are no-op spies. */
  function makeMockDb(): { db: Db } {
    const selectResult = Promise.resolve([{ id: 'skill-topic-row' }]);
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      groupBy: () => selectChain,
      having: () => selectChain,
      orderBy: () => selectChain,
      limit: () => selectResult,
      then: (...a: Parameters<Promise<unknown[]>['then']>) =>
        selectResult.then(...a),
    };
    const db = {
      select: () => selectChain,
      insert: () => ({ values: () => Promise.resolve() }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
    } as unknown as Db;
    return { db };
  }

  function buildCell(exerciseType: ExerciseType): Cell {
    return {
      language: Language.ES as LearningLanguage,
      cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
      exerciseType,
      // A bare grammar point — `coverageSpec` is read on the success path and
      // tolerated as undefined; the cell key just has to pass the regex.
      grammarPoint: { key: 'es-b1-dictation' } as unknown as Cell['grammarPoint'],
      cellKey: `es:b1:${exerciseType}:es-b1-dictation`,
    };
  }

  function makeDraft(ordinal: number): ExerciseDraft {
    return {
      id: `draft-${ordinal}`,
      contentJson: {} as ExerciseDraft['contentJson'],
      metadata: {
        grammarPointKey: 'es-b1-dictation',
        topicDomain: null,
        modelId: 'claude-sonnet-4-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inBatchDuplicate: false,
      },
    };
  }

  /** Outcomes spanning all three inserting terminal statuses. */
  function insertingOutcomes(): Map<number, DraftOutcome> {
    return new Map<number, DraftOutcome>([
      [
        0,
        {
          terminalStatus: 'inserted-approved',
          terminalReviewStatus: 'auto-approved',
          insertedExerciseId: 'draft-0',
          extraUsage: ZERO_USAGE,
          extraProduced: 0,
          validatedCount: 1,
        },
      ],
      [
        1,
        {
          terminalStatus: 'inserted-flagged',
          terminalReviewStatus: 'flagged',
          insertedExerciseId: 'draft-1',
          extraUsage: ZERO_USAGE,
          extraProduced: 0,
          validatedCount: 1,
        },
      ],
      [
        2,
        {
          terminalStatus: 'first-attempt-dedup-then-success',
          terminalReviewStatus: 'auto-approved',
          insertedExerciseId: 'draft-2-retry',
          extraUsage: ZERO_USAGE,
          extraProduced: 1,
          validatedCount: 2,
        },
      ],
    ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    const drafts = [makeDraft(0), makeDraft(1), makeDraft(2)];
    vi.mocked(runGeneratorPool).mockResolvedValue({
      drafts,
      malformedDrafts: [],
      tokenUsage: ZERO_USAGE,
    });
    vi.mocked(runValidatorPool).mockResolvedValue(new Map());
    vi.mocked(runOutcomePool).mockResolvedValue({
      results: insertingOutcomes(),
      earlyBailed: false,
    });
  });

  it('surfaces every inserted dictation id (approved + flagged + dedup-then-success)', async () => {
    const { db } = makeMockDb();
    const result = await runOneCell({
      db,
      client: {} as never,
      cell: buildCell(ExerciseType.DICTATION),
      args: { count: 3, batchSeed: 'dictation-ids', topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(),
      trigger: 'scheduled',
    });

    expect(result.status).toBe('succeeded');
    expect(result.insertedCount).toBe(3);
    expect(result.approvedDictationIds).toEqual([
      'draft-0',
      'draft-1',
      'draft-2-retry',
    ]);
  });

  it('surfaces [] for a non-dictation (cloze) cell with the same inserting outcomes', async () => {
    const { db } = makeMockDb();
    const result = await runOneCell({
      db,
      client: {} as never,
      cell: buildCell(ExerciseType.CLOZE),
      args: { count: 3, batchSeed: 'cloze-ids', topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(),
      trigger: 'scheduled',
    });

    expect(result.status).toBe('succeeded');
    expect(result.insertedCount).toBe(3);
    expect(result.approvedDictationIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tallyCoverageOutcome — pure per-axis tally helper (Phase 2).
// ---------------------------------------------------------------------------

describe('tallyCoverageOutcome', () => {
  const spec: CoverageSpec = {
    axes: [
      { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
      { name: 'polarity', floors: { affirmative: 5, negative: 5 } },
    ],
  };
  it('counts requested by target and approved by realized value, per axis', () => {
    const targets: CoverageTarget[] = [
      { person: '2pl', polarity: 'negative' },
      { person: '1sg', polarity: 'affirmative' },
    ];
    const realized: (CoverageTags | undefined)[] = [
      { person: '3sg', polarity: 'negative' },
      { person: '1sg', polarity: 'affirmative' },
    ];
    const out = tallyCoverageOutcome(spec, targets, realized);
    expect(out).toEqual({
      person: {
        '2pl': { requested: 1, approved: 0 },
        '1sg': { requested: 1, approved: 1 },
        '3sg': { requested: 0, approved: 1 },
      },
      polarity: {
        negative: { requested: 1, approved: 1 },
        affirmative: { requested: 1, approved: 1 },
      },
    });
  });
  it('returns null when there were no targets', () => {
    expect(tallyCoverageOutcome(spec, undefined, [])).toBeNull();
  });
});

