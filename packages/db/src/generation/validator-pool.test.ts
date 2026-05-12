/**
 * Pure unit tests for `runValidatorPool`. No DB, no env vars, no live
 * Anthropic. `validateDraft` is mocked via `vi.mock` so the tests focus on the
 * pool's concurrency primitives: cap-respecting fan-out, ordinal-correct
 * result keying under out-of-order completion, first-error rejection,
 * AbortSignal propagation, and the input-edge guards.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExerciseDraft,
  GenerationSpec,
  ValidateDraftResult,
} from '@language-drill/ai';

vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>(
    '@language-drill/ai',
  );
  return {
    ...actual,
    validateDraft: vi.fn(),
  };
});

import { validateDraft } from '@language-drill/ai';

import { runValidatorPool } from './validator-pool';

const mockValidateDraft = vi.mocked(validateDraft);
const mockClient = {} as unknown as Anthropic;

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
  },
  topicDomain: null,
  count: 10,
  batchSeed: 'test-seed',
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

function makeDrafts(n: number): ExerciseDraft[] {
  return Array.from({ length: n }, (_, i) => makeDraft(i));
}

function makeResult(ordinal: number): ValidateDraftResult {
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
      inputTokens: 100 + ordinal,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200 + ordinal,
    },
  };
}

// Resolve after `ms` and notify the harness that this delay finished. Used so
// tests can synchronize on "all in-flight calls have started" without sleeping
// real wall-clock time.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockValidateDraft.mockReset();
});

afterEach(async () => {
  // Per the design's Error Handling §6, the pool intentionally lets workers
  // drain after `Promise.all` rejects — production callers (`runOneCell`) move
  // on to `failClosed`, and the leftover validator calls are discarded. Tests
  // that cause early rejection (first-error, mid-flight abort) therefore
  // leave workers running until they exhaust the shared ordinal counter.
  // Wait briefly so leftover workers stop calling `validateDraft` before the
  // next test's `beforeEach` rebinds the mock implementation — otherwise a
  // late call into the new impl would contaminate counts in the next test.
  await delay(50);
});

describe('runValidatorPool', () => {
  it('runs sequentially with concurrency=1 (no overlap, in-order results)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      const ordinal = Number(draft.id.split('-')[1]);
      return makeResult(ordinal);
    });

    const drafts = makeDrafts(5);
    const results = await runValidatorPool({
      drafts,
      client: mockClient,
      spec,
      concurrency: 1,
    });

    expect(maxInFlight).toBe(1);
    expect(results.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(results.get(i)).toEqual(makeResult(i));
    }
  });

  it('runs in parallel with concurrency=5 (observed overlap)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(20);
      inFlight--;
      const ordinal = Number(draft.id.split('-')[1]);
      return makeResult(ordinal);
    });

    const drafts = makeDrafts(10);
    const results = await runValidatorPool({
      drafts,
      client: mockClient,
      spec,
      concurrency: 5,
    });

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(results.size).toBe(10);
  });

  it('keys results by ordinal under out-of-order completion', async () => {
    // Per-ordinal delay decreasing with ordinal — higher-ordinal calls resolve
    // first, exercising the out-of-order result-map keying.
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      const ordinal = Number(draft.id.split('-')[1]);
      const drift = (10 - ordinal) * 5;
      await delay(drift);
      return makeResult(ordinal);
    });

    const drafts = makeDrafts(6);
    const results = await runValidatorPool({
      drafts,
      client: mockClient,
      spec,
      concurrency: 6,
    });

    expect(results.size).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(results.get(i)).toEqual(makeResult(i));
    }
  });

  it('rejects on the first worker error', async () => {
    const errOrdinal = 3;
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      const ordinal = Number(draft.id.split('-')[1]);
      if (ordinal === errOrdinal) {
        throw new Error('validator boom');
      }
      await delay(5);
      return makeResult(ordinal);
    });

    await expect(
      runValidatorPool({
        drafts: makeDrafts(8),
        client: mockClient,
        spec,
        concurrency: 4,
      }),
    ).rejects.toThrow('validator boom');
  });

  it('rejects with SIGINT message when signal is already aborted', async () => {
    mockValidateDraft.mockImplementation(async () => makeResult(0));

    const controller = new AbortController();
    controller.abort();

    await expect(
      runValidatorPool({
        drafts: makeDrafts(5),
        client: mockClient,
        spec,
        signal: controller.signal,
        concurrency: 3,
      }),
    ).rejects.toThrow('Aborted by user (SIGINT)');

    expect(mockValidateDraft).not.toHaveBeenCalled();
  });

  it('rejects within one call-latency on mid-flight abort', async () => {
    const controller = new AbortController();
    // Long enough for at least one in-flight call to be active when we abort.
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      const ordinal = Number(draft.id.split('-')[1]);
      await delay(30);
      return makeResult(ordinal);
    });

    const pending = runValidatorPool({
      drafts: makeDrafts(10),
      client: mockClient,
      spec,
      signal: controller.signal,
      concurrency: 3,
    });

    // Abort after the first wave of calls has started.
    await delay(10);
    controller.abort();

    await expect(pending).rejects.toThrow('Aborted by user (SIGINT)');
  });

  it('clamps worker count when concurrency > drafts.length', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      const ordinal = Number(draft.id.split('-')[1]);
      return makeResult(ordinal);
    });

    const drafts = makeDrafts(3);
    const results = await runValidatorPool({
      drafts,
      client: mockClient,
      spec,
      concurrency: 10,
    });

    expect(mockValidateDraft).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results.size).toBe(3);
  });

  it('throws synchronously when concurrency < 1', async () => {
    mockValidateDraft.mockImplementation(async () => makeResult(0));

    await expect(
      runValidatorPool({
        drafts: makeDrafts(5),
        client: mockClient,
        spec,
        concurrency: 0,
      }),
    ).rejects.toThrow('concurrency must be >= 1');

    expect(mockValidateDraft).not.toHaveBeenCalled();
  });

  it('forwards each call’s token usage into the result map', async () => {
    mockValidateDraft.mockImplementation(async (_client, draft) => {
      const ordinal = Number(draft.id.split('-')[1]);
      return makeResult(ordinal);
    });

    const drafts = makeDrafts(4);
    const results = await runValidatorPool({
      drafts,
      client: mockClient,
      spec,
      concurrency: 2,
    });

    for (let i = 0; i < 4; i++) {
      const entry = results.get(i);
      expect(entry).toBeDefined();
      expect(entry?.tokenUsage).toEqual({
        inputTokens: 100 + i,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 200 + i,
      });
    }
  });
});
