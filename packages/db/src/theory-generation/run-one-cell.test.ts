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
import { THEORY_TOOL_NAME } from '@language-drill/ai';
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

import { runOneTheoryCell, type TheoryCellResult } from './run-one-cell';
import type { TheoryCell } from './cells';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Phase 1's well-formed sample theory page. Replayed verbatim by the inline
 * mock Anthropic client below as the `tool_use.input`.
 */
const subjunctiveFixture: Record<string, unknown> = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../scripts/__fixtures__/theory-json/subjunctive.json'),
    'utf8',
  ),
) as Record<string, unknown>;

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

/**
 * Build a fresh `Anthropic`-shaped mock whose `messages.create` returns a
 * single `tool_use` block carrying `toolUseInput` as its `.input`. Each
 * call returns a fresh `vi.fn()` so per-test spy assertions don't bleed
 * across tests.
 */
function makeMockClient(
  toolUseInput: unknown = subjunctiveFixture,
): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: THEORY_TOOL_NAME,
        input: toolUseInput,
      },
    ],
    usage: {
      input_tokens: 1500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 800,
    },
    stop_reason: 'tool_use',
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    stop_sequence: null,
  });
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
        // the generator. Claude was called exactly once (for cellA).
        expect(create).toHaveBeenCalledTimes(1);
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
        const { client } = makeMockClient(malformed);
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
  },
);
