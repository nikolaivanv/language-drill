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
import {
  EARLY_BAIL_PROBE_COUNT,
  EARLY_BAIL_RATIO,
  runOutcomePool,
} from './outcome-pool';
import type { ValidatorPoolEntry } from './validator-pool';

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

/** A `dedup-given-up` outcome — the terminal status the early-bail breaker
 *  counts toward its dedup-domination ratio (R4.2). */
function makeDedupGivenUp(): DraftOutcome {
  return {
    terminalStatus: 'dedup-given-up',
    extraUsage: {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
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
    const { results } = await runOutcomePool({
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
    const { results } = await runOutcomePool({
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
    const { results } = await runOutcomePool({
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
    const { results } = await runOutcomePool({
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

  it('routes a parse-failed first-validation to rejected without re-validating (R8.3)', async () => {
    mockValidateAndInsert.mockImplementation(async (opts) =>
      makeOutcome(opts.ordinal),
    );

    const sentinelOrdinal = 2;
    const firstValidations = new Map<number, ValidatorPoolEntry>();
    for (let i = 0; i < 5; i++) {
      firstValidations.set(
        i,
        i === sentinelOrdinal
          ? {
              kind: 'parse-failed',
              message:
                'Invalid qualityScore: must be a number between 0 and 1, got undefined',
            }
          : makeValidation(i),
      );
    }

    const { results } = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts: makeDrafts(5),
      cell,
      args,
      generatedAt,
      firstValidations,
      concurrency: 3,
    });

    // Every ordinal produced an outcome (the malformed response did NOT abort
    // the cell) and the sentinel ordinal terminated `rejected`.
    expect(results.size).toBe(5);
    const sentinelOutcome = results.get(sentinelOrdinal);
    expect(sentinelOutcome?.terminalStatus).toBe('rejected');
    expect(sentinelOutcome?.validatorParseFailedAtFirst).toBe(true);

    // `validateAndInsertWithRetry` ran for the four good ordinals — NOT for the
    // parse-failed one (it is routed straight to rejected, never re-validated).
    expect(mockValidateAndInsert).toHaveBeenCalledTimes(4);
    const calledOrdinals = mockValidateAndInsert.mock.calls
      .map((c) => c[0].ordinal)
      .sort((a, b) => a - b);
    expect(calledOrdinals).toEqual([0, 1, 3, 4]);
  });

  // -------------------------------------------------------------------------
  // R4.2 / R4.3 — within-run early-bail circuit breaker
  // -------------------------------------------------------------------------

  it('pins the early-bail constants', () => {
    expect(EARLY_BAIL_PROBE_COUNT).toBe(8);
    expect(EARLY_BAIL_RATIO).toBe(0.7);
  });

  it('early-bails when dedup-given-up dominates after the probe count (R4.2)', async () => {
    mockValidateAndInsert.mockImplementation(async () => makeDedupGivenUp());

    const drafts = makeDrafts(20);
    const { results, earlyBailed } = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(20),
      // Serial → the breaker trips deterministically at exactly the probe count.
      concurrency: 1,
    });

    expect(earlyBailed).toBe(true);
    // Stops dispatching once armed — only the probe sample is processed, the
    // remaining ordinals are skipped rather than grinding their retry budget.
    expect(results.size).toBe(EARLY_BAIL_PROBE_COUNT);
    expect(mockValidateAndInsert).toHaveBeenCalledTimes(EARLY_BAIL_PROBE_COUNT);
  });

  it('does not early-bail on a healthy run — every ordinal is processed (R4.3)', async () => {
    mockValidateAndInsert.mockImplementation(async (opts) =>
      makeOutcome(opts.ordinal),
    );

    const drafts = makeDrafts(10);
    const { results, earlyBailed } = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(10),
      concurrency: 1,
    });

    expect(earlyBailed).toBe(false);
    expect(results.size).toBe(10);
    expect(mockValidateAndInsert).toHaveBeenCalledTimes(10);
  });

  it('does not arm the breaker before the probe count (small all-dedup sample)', async () => {
    mockValidateAndInsert.mockImplementation(async () => makeDedupGivenUp());

    const drafts = makeDrafts(EARLY_BAIL_PROBE_COUNT - 1);
    const { results, earlyBailed } = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(EARLY_BAIL_PROBE_COUNT - 1),
      concurrency: 1,
    });

    expect(earlyBailed).toBe(false);
    expect(results.size).toBe(EARLY_BAIL_PROBE_COUNT - 1);
  });

  it('does not bail when the dedup ratio stays below the threshold', async () => {
    // Alternate dedup / healthy → running ratio stays at 0.5 < EARLY_BAIL_RATIO.
    mockValidateAndInsert.mockImplementation(async (opts) =>
      opts.ordinal % 2 === 0 ? makeDedupGivenUp() : makeOutcome(opts.ordinal),
    );

    const drafts = makeDrafts(12);
    const { results, earlyBailed } = await runOutcomePool({
      db: mockDb,
      client: mockClient,
      spec,
      drafts,
      cell,
      args,
      generatedAt,
      firstValidations: makeFirstValidations(12),
      concurrency: 1,
    });

    expect(earlyBailed).toBe(false);
    expect(results.size).toBe(12);
  });
});
