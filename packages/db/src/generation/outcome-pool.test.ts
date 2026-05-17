/**
 * Pure unit tests for `runOutcomePool`. No DB, no env vars, no live
 * Anthropic. `validateAndInsertWithRetry` is mocked via `vi.mock` so the
 * tests focus on the pool's concurrency primitives: cap-respecting fan-out,
 * ordinal-correct result keying under out-of-order completion, first-error
 * rejection, AbortSignal propagation, and input-edge guards.
 *
 * Mirrors `validator-pool.test.ts` and `generator-pool.test.ts`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type {
  ExerciseDraft,
  GenerationSpec,
  ValidateDraftResult,
} from '@language-drill/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../client';

import type { Cell } from './cells';
import type { DraftOutcome } from './validate-and-insert';

vi.mock('./validate-and-insert', async () => {
  const actual = await vi.importActual<
    typeof import('./validate-and-insert')
  >('./validate-and-insert');
  return {
    ...actual,
    validateAndInsertWithRetry: vi.fn(),
  };
});

import { validateAndInsertWithRetry } from './validate-and-insert';
import { runOutcomePool } from './outcome-pool';

const mockValidateAndInsert = vi.mocked(validateAndInsertWithRetry);
const mockClient = {} as unknown as Anthropic;
const mockDb = {} as unknown as Db;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const spec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: {
    key: 'es-b1-test',
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    title: 'test',
    summary: 'test',
  } as unknown as GenerationSpec['grammarPoint'],
  topicDomain: null,
  count: 10,
  batchSeed: 'test-seed',
};

const cell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: spec.grammarPoint,
  cellKey: 'es:b1:cloze:es-b1-test',
};

const args = {
  count: 10,
  batchSeed: 'test-seed',
  topicDomain: null,
  maxCostUsd: 5,
};

const generatedAt = new Date('2026-05-17T00:00:00Z');

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

function makeDrafts(n: number): ExerciseDraft[] {
  return Array.from({ length: n }, (_, i) => makeDraft(i));
}

function makeValidation(ordinal: number): ValidateDraftResult {
  return {
    result: {
      qualityScore: 0.5 + ordinal * 0.01,
      ambiguous: false,
      levelMatch: true,
      grammarPointMatch: true,
      culturalIssues: [],
      flaggedReasons: [],
    },
    tokenUsage: {
      inputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200,
    },
  };
}

function makeFirstValidations(n: number): Map<number, ValidateDraftResult> {
  const out = new Map<number, ValidateDraftResult>();
  for (let i = 0; i < n; i++) out.set(i, makeValidation(i));
  return out;
}

function makeOutcome(ordinal: number): DraftOutcome {
  return {
    terminalStatus: 'inserted-approved',
    terminalReviewStatus: 'auto-approved',
    extraUsage: {
      inputTokens: 100 + ordinal,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200 + ordinal,
    },
    extraProduced: 0,
    validatedCount: 1,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockValidateAndInsert.mockReset();
});

afterEach(async () => {
  // Pool intentionally lets workers drain after `Promise.all` rejects
  // (mirror of validator-pool / generator-pool). Wait briefly so leftover
  // workers stop calling the mock before the next test's `beforeEach`
  // rebinds the implementation.
  await delay(50);
});

describe('runOutcomePool', () => {
  it('runs sequentially with concurrency=1 (no overlap, all ordinals served)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateAndInsert.mockImplementation(async (opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return makeOutcome(opts.ordinal);
    });

    const drafts = makeDrafts(5);
    const results = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(5),
      concurrency: 1,
    });

    expect(maxInFlight).toBe(1);
    expect(results.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(results.get(i)?.extraUsage.inputTokens).toBe(100 + i);
    }
  });

  it('runs in parallel with concurrency=5 (observed overlap)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateAndInsert.mockImplementation(async (opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(20);
      inFlight--;
      return makeOutcome(opts.ordinal);
    });

    const drafts = makeDrafts(10);
    const results = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(10),
      concurrency: 5,
    });

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(results.size).toBe(10);
  });

  it('keys results by ordinal under out-of-order completion', async () => {
    // Higher-ordinal calls resolve first — exercises the ordinal-indexed
    // result map under racing completions.
    mockValidateAndInsert.mockImplementation(async (opts) => {
      const drift = (10 - opts.ordinal) * 5;
      await delay(drift);
      return makeOutcome(opts.ordinal);
    });

    const drafts = makeDrafts(6);
    const results = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(6),
      concurrency: 6,
    });

    expect(results.size).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(results.get(i)?.extraUsage.inputTokens).toBe(100 + i);
    }
  });

  it('rejects on the first worker error', async () => {
    const errOrdinal = 3;
    mockValidateAndInsert.mockImplementation(async (opts) => {
      if (opts.ordinal === errOrdinal) {
        throw new Error('insert boom');
      }
      await delay(5);
      return makeOutcome(opts.ordinal);
    });

    await expect(
      runOutcomePool({
        db: mockDb,
        client: mockClient,
        spec,
        drafts: makeDrafts(8),
        cell,
        args,
        generatedAt,
        firstValidations: makeFirstValidations(8),
        concurrency: 4,
      }),
    ).rejects.toThrow('insert boom');
  });

  it('rejects with SIGINT message when signal is already aborted', async () => {
    mockValidateAndInsert.mockImplementation(async (opts) =>
      makeOutcome(opts.ordinal),
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      runOutcomePool({
        db: mockDb,
        client: mockClient,
        spec,
        drafts: makeDrafts(5),
        cell,
        args,
        generatedAt,
        firstValidations: makeFirstValidations(5),
        signal: controller.signal,
        concurrency: 3,
      }),
    ).rejects.toThrow('Aborted by user (SIGINT)');

    expect(mockValidateAndInsert).not.toHaveBeenCalled();
  });

  it('rejects within one call-latency on mid-flight abort', async () => {
    const controller = new AbortController();
    mockValidateAndInsert.mockImplementation(async (opts) => {
      await delay(30);
      return makeOutcome(opts.ordinal);
    });

    const pending = runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts: makeDrafts(10),
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(10),
      signal: controller.signal,
      concurrency: 3,
    });

    await delay(10);
    controller.abort();

    await expect(pending).rejects.toThrow('Aborted by user (SIGINT)');
  });

  it('clamps worker count when concurrency > drafts.length', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateAndInsert.mockImplementation(async (opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return makeOutcome(opts.ordinal);
    });

    const drafts = makeDrafts(3);
    const results = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(3),
      concurrency: 10,
    });

    expect(mockValidateAndInsert).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results.size).toBe(3);
  });

  it('throws when concurrency < 1', async () => {
    mockValidateAndInsert.mockImplementation(async (opts) =>
      makeOutcome(opts.ordinal),
    );

    await expect(
      runOutcomePool({
        db: mockDb,
        client: mockClient,
        spec,
        drafts: makeDrafts(5),
        cell,
        args,
        generatedAt,
        firstValidations: makeFirstValidations(5),
        concurrency: 0,
      }),
    ).rejects.toThrow('concurrency must be >= 1');

    expect(mockValidateAndInsert).not.toHaveBeenCalled();
  });

  it('forwards precomputed first-validation by ordinal to each worker', async () => {
    mockValidateAndInsert.mockImplementation(async (opts) =>
      makeOutcome(opts.ordinal),
    );

    const firstValidations = makeFirstValidations(4);
    await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts: makeDrafts(4),
      cell,
      args,
      generatedAt,
      firstValidations,
      concurrency: 2,
    });

    expect(mockValidateAndInsert).toHaveBeenCalledTimes(4);
    for (const call of mockValidateAndInsert.mock.calls) {
      const opts = call[0];
      expect(opts.precomputedFirstValidation).toEqual(
        firstValidations.get(opts.ordinal),
      );
    }
  });
});
