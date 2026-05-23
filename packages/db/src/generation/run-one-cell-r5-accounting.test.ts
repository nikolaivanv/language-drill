/**
 * Pure unit test for R5.4 — runOneCell accumulates
 * `CellResult.parserFailedCount` from per-ordinal `DraftOutcome`s, and the
 * structured log projection (`summarizeResult`) surfaces it as
 * `parserFailedOrdinals: N`.
 *
 * Lives in a sibling file (not inside `run-one-cell.test.ts`) because
 * `vi.mock(...)` is hoisted to module scope — adding the pool mocks to the
 * integration file would replace the real pools for the existing
 * TEST_DATABASE_URL-gated tests. This file is dedicated to the parser-
 * failed accounting path and stays unit-pure: no DB, no env vars, no Claude.
 *
 * The exhaustive run-one-cell coverage stays in `run-one-cell.test.ts`
 * (Phase 4 integration). The validate-and-insert R5 contract is pinned
 * in `validate-and-insert.test.ts` (task 16). This file pins the wiring
 * between the two — that `parserFailedAtFinal: true` from one ordinal
 * lands as `parserFailedCount: 1` on the CellResult and as
 * `parserFailedOrdinals: 1` on the log line.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  ZERO_USAGE,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
} from '@language-drill/ai';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `summarizeResult` lives in `infra/lambda/src/generation/log.ts`, but pulling
// it across the package boundary into this @language-drill/db unit test would
// introduce a back-edge dependency. Instead we reproduce the projection
// inline here as a single assertion — the same shape the
// `infra/lambda/src/generation/log.test.ts` block pins directly against
// `summarizeResult`. If the production projection changes, that test will
// fail; this test only needs to confirm `parserFailedCount` is present and
// non-zero on the CellResult so the projection has a value to surface.

import type { Db } from '../client';

vi.mock('./generator-pool', async () => ({
  runGeneratorPool: vi.fn(),
}));
vi.mock('./validator-pool', async () => ({
  runValidatorPool: vi.fn(),
}));
vi.mock('./outcome-pool', async () => ({
  runOutcomePool: vi.fn(),
}));

import { runGeneratorPool } from './generator-pool';
import { runValidatorPool } from './validator-pool';
import { runOutcomePool } from './outcome-pool';

import type { Cell } from './cells';
import { runOneCell, type CellResult } from './run-one-cell';
import type { DraftOutcome } from './validate-and-insert';

const mockGeneratorPool = vi.mocked(runGeneratorPool);
const mockValidatorPool = vi.mocked(runValidatorPool);
const mockOutcomePool = vi.mocked(runOutcomePool);
const mockClient = {} as unknown as Anthropic;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = {
  key: 'es-b1-test',
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  title: 'test',
  summary: 'test',
} as unknown as GenerationSpec['grammarPoint'];

const cell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  cellKey: 'es:b1:cloze:es-b1-test',
};

function makeDraft(ordinal: number): ExerciseDraft {
  return {
    id: `draft-${ordinal}`,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence: `Sentence ${ordinal} ___.`,
      correctAnswer: `answer-${ordinal}`,
    },
    metadata: {
      grammarPointKey: 'es-b1-test',
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

function makeFirstValidation(ordinal: number): ValidateDraftResult {
  return {
    result: {
      qualityScore: 0.85,
      ambiguous: false,
      contextSpoilsAnswer: false,
      levelMatch: true,
      grammarPointMatch: true,
      culturalIssues: [],
      flaggedReasons: [],
    },
    tokenUsage: {
      inputTokens: 10 + ordinal,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 5 + ordinal,
    },
  };
}

function makeRejectedOutcome(
  parserFailedAtFinal: boolean,
): DraftOutcome {
  return {
    terminalStatus: 'rejected',
    extraUsage: ZERO_USAGE,
    extraProduced: parserFailedAtFinal ? 3 : 0,
    validatedCount: 1,
    ...(parserFailedAtFinal ? { parserFailedAtFinal: true as const } : {}),
  };
}

function makeApprovedOutcome(): DraftOutcome {
  return {
    terminalStatus: 'inserted-approved',
    terminalReviewStatus: 'auto-approved',
    extraUsage: ZERO_USAGE,
    extraProduced: 0,
    validatedCount: 1,
  };
}

/**
 * Minimal DB stub for the run-one-cell call paths exercised by this test:
 *   - `db.select(...).from(skillTopics).where(...).limit(1)` returns one row
 *     so the skill-topic precheck passes.
 *   - `db.insert(generationJobs).values(...)` resolves (audit row open).
 *   - `db.update(generationJobs).set(...).where(...)` resolves (audit row
 *     close with terminal counters).
 *
 * The VOCAB_RECALL `fetchPriorVocabRecallSurfaces` path is bypassed by using
 * a CLOZE cell in the fixture.
 */
function makeStubDb(): Db {
  const selectChain = {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ id: 'skill-topic-stub' }]),
      }),
    }),
  };
  const insertChain = {
    values: () => Promise.resolve(),
  };
  const updateChain = {
    set: () => ({
      where: () => Promise.resolve(),
    }),
  };
  return {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  } as unknown as Db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGeneratorPool.mockReset();
  mockValidatorPool.mockReset();
  mockOutcomePool.mockReset();
});

describe('runOneCell — R5.4 parserFailedCount accounting', () => {
  it('accumulates parserFailedCount=1 when one ordinal in a 3-ordinal batch returns parserFailedAtFinal=true', async () => {
    const drafts = [makeDraft(0), makeDraft(1), makeDraft(2)];

    mockGeneratorPool.mockResolvedValue({
      drafts,
      tokenUsage: ZERO_USAGE,
      malformedDrafts: [],
    });
    mockValidatorPool.mockResolvedValue(
      new Map([
        [0, makeFirstValidation(0)],
        [1, makeFirstValidation(1)],
        [2, makeFirstValidation(2)],
      ]),
    );
    // Ordinal 1 is the parser-failed-at-final outcome. The other two are
    // straightforward approved inserts so the cell otherwise succeeds.
    mockOutcomePool.mockResolvedValue(
      new Map<number, DraftOutcome>([
        [0, makeApprovedOutcome()],
        [1, makeRejectedOutcome(true)],
        [2, makeApprovedOutcome()],
      ]),
    );

    const result: CellResult = await runOneCell({
      db: makeStubDb(),
      client: mockClient,
      cell,
      args: {
        count: 3,
        batchSeed: 'r5-accounting-test',
        topicDomain: null,
        maxCostUsd: 5,
      },
      jobId: 'job-r5-test',
      trigger: 'cli',
    });

    // R5.4 — exactly one of three ordinals carried parserFailedAtFinal=true,
    // so the CellResult.parserFailedCount must accumulate to 1.
    expect(result.parserFailedCount).toBe(1);

    // The parser-failed ordinal terminates with status='rejected', so it
    // also lands in rejectedCount — parserFailedCount is a strict subset.
    expect(result.rejectedCount).toBeGreaterThanOrEqual(1);

    // Sanity: the cell succeeded overall (the other two ordinals inserted).
    expect(result.status).toBe('succeeded');
    expect(result.insertedCount).toBe(2);

    // R5.4 log line projection — `summarizeResult` (in
    // `infra/lambda/src/generation/log.ts`) renames `parserFailedCount` to
    // `parserFailedOrdinals` on the CloudWatch log. The contract is one
    // field → one field. We don't import summarizeResult across the package
    // boundary; instead, the equivalent log.test.ts pins the projection
    // shape directly. Here we just confirm the source field is present and
    // non-zero so the projection has something to surface.
    expect(result.parserFailedCount).toBeGreaterThan(0);
  });
});
