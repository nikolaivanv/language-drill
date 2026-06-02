/**
 * Integration tests for `runOneTheoryCell` against a real Postgres.
 *
 * Gated on `TEST_DATABASE_URL` (matches `seed-exercises.test.ts` /
 * `run-one-cell.test.ts` on the exercise side). Each test exercises one of
 * the orchestrator's five terminal paths (Req 8.5.a–e) using a synthetic
 * grammar point that does NOT appear in `ALL_CURRICULA` — proving the
 * orchestrator never consults the curriculum.
 *
 * Cleanup is keyed on a per-suite `TEST_KEY_PREFIX` so the dev Neon branch
 * sees no row leaks (Req 8.12). Phase 1's `subjunctive.json` fixture is
 * loaded via ESM-derived `__dirname` and replayed as the tool_use input by
 * an inline mock Anthropic client; we deliberately do NOT import the Task
 * 19 `createTheoryMockClient` script because that lands later in the
 * sequence.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  THEORY_TOOL_NAME,
  THEORY_VALIDATION_TOOL_NAME,
} from '@language-drill/ai';
import { CefrLevel, Language, type LearningLanguage } from '@language-drill/shared';
import { eq, like } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createDb, type Db } from '../client';
import type { CurriculumCefrLevel, GrammarPoint } from '../curriculum';
import { buildTheoryCellKey } from '../lib/theory-cell-key';
import { theoryGenerationJobs, theoryTopics } from '../schema/index';

import { routeTheoryValidationResult } from './routing';
import { runOneTheoryCell, type TheoryCellResult } from './run-one-cell';
import type { TheoryCell } from './cells';

// Wrap `routeTheoryValidationResult` so per-test `mockReturnValueOnce`
// can force the defensive empty-reasons branch in `run-one-cell.ts` —
// the real router never produces a rejected verdict with an empty
// `flaggedReasons` array, so the only way to pin that code path is to
// override the routing decision for one specific call. The default
// passes through to the real implementation, so other tests are
// unaffected.
vi.mock('./routing', async () => {
  const actual = await vi.importActual<typeof import('./routing')>('./routing');
  return {
    ...actual,
    routeTheoryValidationResult: vi.fn(actual.routeTheoryValidationResult),
  };
});

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Phase 1's well-formed sample theory page. Replayed verbatim by the inline
 * mock Anthropic client below as the `tool_use.input` for the generator
 * call.
 */
const subjunctiveFixture: Record<string, unknown> = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../scripts/__fixtures__/theory-json/subjunctive.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * Phase 3 validation fixtures (loaded from the same on-disk fixtures the
 * mock client uses in `MOCK_CLAUDE=1` mode). Replayed verbatim by the
 * inline mock as the validator's `tool_use.input`.
 */
const VALIDATION_FIXTURES_DIR = resolve(
  __dirname,
  '../../scripts/__fixtures__/claude-theory-validation',
);

function loadValidationFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(VALIDATION_FIXTURES_DIR, name), 'utf8'),
  ) as Record<string, unknown>;
}

const VALIDATION_AUTO_APPROVED = loadValidationFixture('auto-approved.json');
const VALIDATION_FLAGGED = loadValidationFixture('flagged-quality.json');
const VALIDATION_REJECTED = loadValidationFixture('rejected-factual.json');

const TEST_TIMEOUT_MS = 60_000;

/**
 * Prefix all synthetic grammar-point keys (and therefore all
 * theory_topics.grammar_point_key + theory_generation_jobs.cell_key values
 * created by this suite) so `afterEach` can wipe them with a single LIKE.
 * `rotc` = run-one-theory-cell.
 */
const TEST_KEY_PREFIX = 'es-b1-test-rotc-';

// ---------------------------------------------------------------------------
// Inline mock client
// ---------------------------------------------------------------------------

type MockClientOpts = {
  /** Generator response payload. Default: `subjunctiveFixture`. */
  generatorInput?: unknown;
  /** Validator response payload. Default: auto-approved fixture. */
  validatorInput?: unknown;
  /**
   * When set, overrides the validator response's `tool_use.name` —
   * triggers `validateTheoryDraft`'s "Unexpected tool name" branch.
   */
  validatorToolName?: string;
  /**
   * When true, `client.messages.create` throws for the validator call —
   * simulates a network/API failure on the second Claude round-trip.
   */
  validatorThrows?: boolean;
  /**
   * Fires once, AFTER the generator response is built, BEFORE it is
   * returned. Used by the SIGINT-between test to abort the controller in
   * the window between the generator awaiting and the orchestrator
   * checking `signal.aborted`.
   */
  onGeneratorReturn?: () => void;
};

/**
 * Build a fresh `Anthropic`-shaped mock whose `messages.create` dispatches
 * on `tool_choice.name`: generator vs validator. Each call returns a fresh
 * `vi.fn()` so per-test spy assertions don't bleed across tests.
 *
 * After Phase 3, every cell triggers two Claude round-trips (generator +
 * validator). The mock returns auto-approved for the validator by default
 * so existing Phase 2 happy-path tests continue to pass without changes.
 */
function makeMockClient(
  opts: MockClientOpts = {},
): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const generatorInput = opts.generatorInput ?? subjunctiveFixture;
  const validatorInput = opts.validatorInput ?? VALIDATION_AUTO_APPROVED;
  const validatorToolName =
    opts.validatorToolName ?? THEORY_VALIDATION_TOOL_NAME;

  const create = vi
    .fn()
    .mockImplementation(
      async (args: { tool_choice?: { name?: string } }) => {
        const toolName = args.tool_choice?.name;

        if (toolName === THEORY_VALIDATION_TOOL_NAME) {
          if (opts.validatorThrows) {
            throw new Error('Mock validator: synthetic API failure');
          }
          return {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test_v',
                name: validatorToolName,
                input: validatorInput,
              },
            ],
            usage: {
              input_tokens: 800,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 200,
            },
            stop_reason: 'tool_use',
            id: 'msg_test_v',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            stop_sequence: null,
          };
        }

        // Generator branch (default — covers unknown tool names too, which
        // is the Phase 2 behavior any pre-existing caller relied on).
        opts.onGeneratorReturn?.();
        return {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_g',
              name: THEORY_TOOL_NAME,
              input: generatorInput,
            },
          ],
          usage: {
            input_tokens: 1500,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 800,
          },
          stop_reason: 'tool_use',
          id: 'msg_test_g',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          stop_sequence: null,
        };
      },
    );
  const client = { messages: { create } } as unknown as Anthropic;
  return { client, create };
}

// ---------------------------------------------------------------------------
// Synthetic-cell helpers
// ---------------------------------------------------------------------------

/**
 * Build a `TheoryCell` whose grammar-point key starts with
 * `TEST_KEY_PREFIX`. The key does NOT appear in `ALL_CURRICULA` — the
 * orchestrator must not validate against the curriculum (it works off the
 * cell payload alone).
 */
function buildTestCell(suffix: string = randomUUID().slice(0, 8)): TheoryCell {
  const grammarKey = `${TEST_KEY_PREFIX}${suffix}`;
  const grammarPoint: GrammarPoint = {
    key: grammarKey,
    kind: 'grammar',
    name: 'test',
    description: 'd',
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    language: Language.ES as LearningLanguage,
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['e'],
  };
  const cellKey = buildTheoryCellKey({
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    grammarPointKey: grammarKey,
  });
  return {
    language: Language.ES as LearningLanguage,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    grammarPoint,
    cellKey,
  };
}

// ---------------------------------------------------------------------------
// Tests (DB-gated)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'runOneTheoryCell (DB-gated)',
  () => {
    let db: Db;

    beforeAll(() => {
      db = createDb(process.env['TEST_DATABASE_URL']!);
    });

    beforeEach(async () => {
      await db
        .delete(theoryTopics)
        .where(like(theoryTopics.grammarPointKey, `${TEST_KEY_PREFIX}%`));
      await db
        .delete(theoryGenerationJobs)
        .where(like(theoryGenerationJobs.cellKey, `%${TEST_KEY_PREFIX}%`));
    });

    afterEach(async () => {
      await db
        .delete(theoryTopics)
        .where(like(theoryTopics.grammarPointKey, `${TEST_KEY_PREFIX}%`));
      await db
        .delete(theoryGenerationJobs)
        .where(like(theoryGenerationJobs.cellKey, `%${TEST_KEY_PREFIX}%`));
    });

    // -----------------------------------------------------------------------
    // Req 8.5.a — Happy path
    // -----------------------------------------------------------------------

    it(
      'inserts an auto-approved row and closes the audit row on the happy path (Req 8.5.a)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client } = makeMockClient();
        const jobId = randomUUID();

        const result: TheoryCellResult = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');
        expect(result.insertedCount).toBe(1);
        expect(result.skippedCount).toBe(0);

        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(1);
        expect(topicRows[0].reviewStatus).toBe('auto-approved');
        expect(topicRows[0].modelId).toBe('claude-sonnet-4-5');
        expect(topicRows[0].generationSource).toBe('claude-realtime');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.cellKey, cell.cellKey));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('succeeded');
        expect(jobRows[0].approved).toBe(true);
        expect(jobRows[0].flagged).toBe(false);
        expect(jobRows[0].rejected).toBe(false);
        expect(jobRows[0].inputTokensUsed ?? 0).toBeGreaterThan(0);
        expect(jobRows[0].outputTokensUsed ?? 0).toBeGreaterThan(0);
        expect(Number(jobRows[0].costUsdEstimate ?? 0)).toBeGreaterThan(0);
      },
    );

    // -----------------------------------------------------------------------
    // Req 8.5.b — Dedup skip
    // -----------------------------------------------------------------------

    it(
      'reports skipped-cell when the partial unique index rejects the INSERT (Req 8.5.b)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client: client1 } = makeMockClient();
        const { client: client2 } = makeMockClient();

        // First run lands the row.
        const first = await runOneTheoryCell({
          db,
          client: client1,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: randomUUID(),
          trigger: 'cli',
        });
        expect(first.status).toBe('succeeded');
        expect(first.insertedCount).toBe(1);

        // Second run on the same cell hits the partial unique index.
        const secondJobId = randomUUID();
        const second = await runOneTheoryCell({
          db,
          client: client2,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: secondJobId,
          trigger: 'cli',
        });
        expect(second.status).toBe('succeeded');
        expect(second.insertedCount).toBe(0);
        expect(second.skippedCount).toBe(1);
        expect(second.errorMessage).toContain('cell already filled');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, secondJobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].approved).toBe(false);
        expect(jobRows[0].errorMessage).toContain('cell already filled');
      },
    );

    // -----------------------------------------------------------------------
    // Req 8.5.c — Audit-row ID collision
    // -----------------------------------------------------------------------

    it(
      'fails closed when the caller re-uses a jobId across different cells (Req 8.5.c)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cellA = buildTestCell('aaaaaaaa');
        const cellB = buildTestCell('bbbbbbbb');
        const sharedJobId = randomUUID();

        const { client, create } = makeMockClient();

        // First call: succeeds and writes audit row keyed on sharedJobId.
        const first = await runOneTheoryCell({
          db,
          client,
          cell: cellA,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: sharedJobId,
          trigger: 'cli',
        });
        expect(first.status).toBe('succeeded');

        // Second call on a DIFFERENT cell with the SAME jobId: audit-row PK
        // collides on INSERT, orchestrator short-circuits before the Claude
        // call.
        const second = await runOneTheoryCell({
          db,
          client,
          cell: cellB,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: sharedJobId,
          trigger: 'cli',
        });
        expect(second.status).toBe('failed');
        expect(second.errorMessage).toContain('Audit row id collision');

        // Spy assertion: the second call MUST short-circuit before reaching
        // the generator. Claude was called exactly twice for cellA — once
        // for the generator, once for the validator (Phase 3) — and zero
        // additional times for cellB.
        expect(create).toHaveBeenCalledTimes(2);
      },
    );

    // -----------------------------------------------------------------------
    // Req 8.5.d — Claude failure path (malformed tool_use input)
    // -----------------------------------------------------------------------

    it(
      'fails closed when the generator throws on a malformed draft (Req 8.5.d)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // `parseTheoryTopicJson` validates `id`, `title`, `subtitle`, `cefr`
        // before reaching `sections`, so we feed a payload that satisfies the
        // string-field checks and trips the empty-array check on `sections`.
        const malformed = {
          id: 'x',
          title: 't',
          subtitle: 's',
          cefr: 'B1',
          sections: [],
        };
        const cell = buildTestCell();
        const { client } = makeMockClient({ generatorInput: malformed });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('failed');
        expect(result.errorMessage ?? '').toMatch(
          /^Theory draft malformed: Invalid sections/,
        );

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('failed');
      },
    );

    // -----------------------------------------------------------------------
    // Req 2.2 / 2.3 / 2.5 — failed cell records the tokens every attempt
    // burned, summed across the regenerate retries, instead of NULL/$0.
    // -----------------------------------------------------------------------

    it(
      'records non-zero summed token usage on a malformed-draft failure (Req 2.2, 2.3, 2.5)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const malformed = {
          id: 'x',
          title: 't',
          subtitle: 's',
          cefr: 'B1',
          sections: [],
        };
        const cell = buildTestCell();
        // The mock replays `malformed` on every call, so the generator
        // exhausts its retry budget (initial + THEORY_GENERATION_MAX_RETRIES=2
        // = 3 generator calls at 1500 input / 800 output each). The validator
        // is never reached. Usage must be the sum across all three attempts.
        const { client, create } = makeMockClient({ generatorInput: malformed });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('failed');
        expect(create).toHaveBeenCalledTimes(3); // initial + 2 retries

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('failed');
        // Summed across the three generator attempts — NOT ZERO_USAGE.
        expect(jobRows[0].inputTokensUsed).toBe(4500); // 3 × 1500
        expect(jobRows[0].outputTokensUsed).toBe(2400); // 3 × 800
        expect(Number(jobRows[0].costUsdEstimate ?? 0)).toBeGreaterThan(0);
      },
    );

    // -----------------------------------------------------------------------
    // Req 8.5.e — SIGINT precheck (signal pre-aborted)
    // -----------------------------------------------------------------------

    it(
      'short-circuits without calling Claude when the abort signal is already aborted (Req 8.5.e)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client, create } = makeMockClient();

        const ac = new AbortController();
        ac.abort();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: randomUUID(),
          trigger: 'cli',
          signal: ac.signal,
        });

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Aborted by user (SIGINT)');
        expect(create).not.toHaveBeenCalled();
      },
    );

    // -----------------------------------------------------------------------
    // Phase 3 — auto-approved branch (Req 4.5)
    // -----------------------------------------------------------------------

    it(
      'inserts auto-approved row when validator approves (Req 4.5)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client, create } = makeMockClient({
          validatorInput: VALIDATION_AUTO_APPROVED,
        });
        const jobId = randomUUID();

        const result: TheoryCellResult = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');
        expect(result.insertedCount).toBe(1);
        expect(result.skippedCount).toBe(0);
        // Two Claude calls — generator + validator.
        expect(create).toHaveBeenCalledTimes(2);

        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(1);
        expect(topicRows[0].reviewStatus).toBe('auto-approved');
        expect(topicRows[0].qualityScore).toBeCloseTo(0.85, 6);
        expect(topicRows[0].flaggedReasons).toBeNull();

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('succeeded');
        expect(jobRows[0].approved).toBe(true);
        expect(jobRows[0].flagged).toBe(false);
        expect(jobRows[0].rejected).toBe(false);
      },
    );

    // -----------------------------------------------------------------------
    // Phase 3 — flagged branch (Req 4.4)
    // -----------------------------------------------------------------------

    it(
      'inserts flagged row when validator flags (Req 4.4)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client } = makeMockClient({
          validatorInput: VALIDATION_FLAGGED,
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');
        expect(result.insertedCount).toBe(1);
        expect(result.skippedCount).toBe(0);

        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(1);
        expect(topicRows[0].reviewStatus).toBe('flagged');
        expect(topicRows[0].qualityScore).toBeCloseTo(0.6, 6);
        // Router builds the reasons list: low-score header first, then the
        // validator's free-text flaggedReasons in order.
        expect(topicRows[0].flaggedReasons).toEqual([
          'low quality score (<0.7)',
          'voice is too encouraging',
        ]);

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('succeeded');
        expect(jobRows[0].approved).toBe(false);
        expect(jobRows[0].flagged).toBe(true);
        expect(jobRows[0].rejected).toBe(false);
      },
    );

    // -----------------------------------------------------------------------
    // Phase 3 — rejected branch (Req 4.3)
    // -----------------------------------------------------------------------

    it(
      'skips INSERT when validator rejects (Req 4.3)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const { client } = makeMockClient({
          validatorInput: VALIDATION_REJECTED,
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');
        expect(result.insertedCount).toBe(0);
        expect(result.skippedCount).toBe(0);

        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(0);

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('succeeded');
        expect(jobRows[0].approved).toBe(false);
        expect(jobRows[0].flagged).toBe(false);
        expect(jobRows[0].rejected).toBe(true);
      },
    );

    // -----------------------------------------------------------------------
    // Spec theory-gen-observability-resilience — Req 1
    // -----------------------------------------------------------------------

    it(
      'persists error_message joined from decision.flaggedReasons on rejected (Req 1.1, 1.3)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // Two factualErrors → router routes to rejected with
        // `flaggedReasons = [...factualErrors]`; the orchestrator joins them
        // with `'; '` and writes the result to `error_message`.
        const cell = buildTestCell();
        const { client } = makeMockClient({
          validatorInput: {
            qualityScore: 0.4,
            factualErrors: [
              'first factual error',
              'second factual error',
            ],
            levelMismatch: false,
            sectionsIncomplete: [],
            examplesUseGrammarPoint: true,
            culturalIssues: [],
            flaggedReasons: [],
          },
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].rejected).toBe(true);
        expect(jobRows[0].errorMessage).toBe(
          'first factual error; second factual error',
        );
      },
    );

    it(
      'writes the empty-reasons sentinel when flaggedReasons is [] (Req 1.2)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // The real router never produces a rejected verdict with empty
        // reasons — every rejected branch pushes at least one entry. Force
        // it here to pin the defensive sentinel branch in run-one-cell.ts.
        vi.mocked(routeTheoryValidationResult).mockReturnValueOnce({
          reviewStatus: 'rejected',
          flaggedReasons: [],
        });

        const cell = buildTestCell();
        const { client } = makeMockClient({
          validatorInput: VALIDATION_REJECTED,
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');
        expect(vi.mocked(routeTheoryValidationResult)).toHaveBeenCalled();

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].rejected).toBe(true);
        expect(jobRows[0].errorMessage).toBe('rejected (no reasons reported)');
      },
    );

    it(
      'truncates error_message to ERROR_MESSAGE_MAX_LENGTH (1000 chars) when joined reasons overflow (Req 1.1)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // 10 reasons × 150 chars + 9 × 2-char separators = 1518 chars; the
        // orchestrator must slice to exactly 1000.
        const longReason = 'x'.repeat(150);
        const factualErrors = Array.from({ length: 10 }, () => longReason);

        const cell = buildTestCell();
        const { client } = makeMockClient({
          validatorInput: {
            qualityScore: 0.4,
            factualErrors,
            levelMismatch: false,
            sectionsIncomplete: [],
            examplesUseGrammarPoint: true,
            culturalIssues: [],
            flaggedReasons: [],
          },
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('succeeded');

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].rejected).toBe(true);
        expect(jobRows[0].errorMessage?.length).toBe(1000);
      },
    );

    it(
      'does NOT write error_message on the flagged or auto-approved INSERT branches (Req 1.4)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // -- Flagged branch
        const flaggedCell = buildTestCell();
        const { client: flaggedClient } = makeMockClient({
          validatorInput: VALIDATION_FLAGGED,
        });
        const flaggedJobId = randomUUID();
        await runOneTheoryCell({
          db,
          client: flaggedClient,
          cell: flaggedCell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: flaggedJobId,
          trigger: 'cli',
        });
        const flaggedRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, flaggedJobId));
        expect(flaggedRows).toHaveLength(1);
        expect(flaggedRows[0].flagged).toBe(true);
        expect(flaggedRows[0].errorMessage).toBeNull();

        // -- Auto-approved INSERT branch (the dedup-skip sub-path at
        //    run-one-cell.ts:400 is unrelated to this spec and is covered
        //    by the pre-existing "reports skipped-cell" test).
        const approvedCell = buildTestCell();
        const { client: approvedClient } = makeMockClient({
          validatorInput: VALIDATION_AUTO_APPROVED,
        });
        const approvedJobId = randomUUID();
        await runOneTheoryCell({
          db,
          client: approvedClient,
          cell: approvedCell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: approvedJobId,
          trigger: 'cli',
        });
        const approvedRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, approvedJobId));
        expect(approvedRows).toHaveLength(1);
        expect(approvedRows[0].approved).toBe(true);
        expect(approvedRows[0].errorMessage).toBeNull();
      },
    );

    // -----------------------------------------------------------------------
    // Phase 3 — validator-failure path (Req 4.6)
    // -----------------------------------------------------------------------

    it(
      'preserves generator tokenUsage when validator throws (Req 4.6)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        // Validator response carries the wrong tool name → triggers
        // `validateTheoryDraft`'s "Unexpected tool name" branch.
        const { client } = makeMockClient({
          validatorToolName: 'not_the_validator_tool',
        });
        const jobId = randomUUID();

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId,
          trigger: 'cli',
        });

        expect(result.status).toBe('failed');
        // Truncated to ≤ 1000 chars (ERROR_MESSAGE_MAX_LENGTH).
        expect(result.errorMessage ?? '').toMatch(/Unexpected tool name/);
        expect((result.errorMessage ?? '').length).toBeLessThanOrEqual(1000);
        // Generator's tokens are preserved — we already paid for them.
        expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
        expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);

        const jobRows = await db
          .select()
          .from(theoryGenerationJobs)
          .where(eq(theoryGenerationJobs.id, jobId));
        expect(jobRows).toHaveLength(1);
        expect(jobRows[0].status).toBe('failed');
        // No INSERT into theory_topics on validator failure.
        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(0);
      },
    );

    // -----------------------------------------------------------------------
    // Phase 3 — SIGINT between generator and validator (Req 4.8)
    // -----------------------------------------------------------------------

    it(
      'aborts cleanly on SIGINT between generator and validator (Req 4.8)',
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const cell = buildTestCell();
        const ac = new AbortController();
        // Abort during the generator's mock callback — fires after the
        // generator response is built but before recheck #1 runs.
        const { client, create } = makeMockClient({
          onGeneratorReturn: () => ac.abort(),
        });

        const result = await runOneTheoryCell({
          db,
          client,
          cell,
          args: { batchSeed: 'test', maxCostUsd: 1.0 },
          jobId: randomUUID(),
          trigger: 'cli',
          signal: ac.signal,
        });

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Aborted by user (SIGINT)');
        // Only one Claude call — the validator was never invoked.
        expect(create).toHaveBeenCalledTimes(1);
        // Generator's tokens are reported honestly.
        expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
        expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);

        // No row in theory_topics.
        const topicRows = await db
          .select()
          .from(theoryTopics)
          .where(eq(theoryTopics.grammarPointKey, cell.grammarPoint.key));
        expect(topicRows).toHaveLength(0);
      },
    );
  },
);
