/**
 * Pure unit tests for `runGeneratorPool`. No DB, no env vars, no live
 * Anthropic. `generateOneDraft` is mocked via `vi.mock` so the tests focus on
 * the pool's concurrency primitives: cap-respecting fan-out, ordinal-correct
 * result keying under out-of-order completion, first-error rejection,
 * AbortSignal propagation, input-edge guards, post-walk `inBatchDuplicate`
 * marking, and token-usage aggregation parity with the serial path.
 *
 * Mirrors `validator-pool.test.ts`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExerciseDraft,
  GenerateOneDraftResult,
  GenerationSpec,
} from '@language-drill/ai';

vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>(
    '@language-drill/ai',
  );
  return {
    ...actual,
    generateOneDraft: vi.fn(),
  };
});

import { generateOneDraft } from '@language-drill/ai';

import { runGeneratorPool } from './generator-pool';

const mockGenerateOneDraft = vi.mocked(generateOneDraft);
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
  } as unknown as GenerationSpec['grammarPoint'],
  topicDomain: null,
  count: 10,
  batchSeed: 'test-seed',
};

function makeDraft(ordinal: number, surface?: string): ExerciseDraft {
  const sentence = surface ?? `Sentence ${ordinal} ___.`;
  return {
    id: `draft-${ordinal}`,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank.',
      sentence,
      correctAnswer: `answer-${ordinal}`,
    },
    metadata: {
      grammarPointKey: 'es-b1-test',
      topicDomain: null,
      modelId: 'claude-sonnet-4-5',
      inputTokens: 100 + ordinal,
      outputTokens: 200 + ordinal,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

function makeDraftResult(
  ordinal: number,
  surface?: string,
): GenerateOneDraftResult {
  return {
    kind: 'draft',
    draft: makeDraft(ordinal, surface),
    usage: {
      inputTokens: 100 + ordinal,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 200 + ordinal,
    },
  };
}

function makeMalformedResult(ordinal: number): GenerateOneDraftResult {
  return {
    kind: 'malformed',
    malformed: {
      ordinal,
      errorMessage: `Draft ordinal=${ordinal} malformed: synthetic`,
    },
    usage: {
      inputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 75,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGenerateOneDraft.mockReset();
});

afterEach(async () => {
  // Pool intentionally lets workers drain after `Promise.all` rejects (mirror
  // of validator-pool behavior). Wait briefly so leftover workers stop
  // calling the mock before the next test's `beforeEach` resets it.
  await delay(50);
});

describe('runGeneratorPool', () => {
  it('runs sequentially with concurrency=1 (no overlap, drafts in ordinal order)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return makeDraftResult(ordinal);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 5,
      concurrency: 1,
    });

    expect(maxInFlight).toBe(1);
    expect(result.drafts).toHaveLength(5);
    expect(result.malformedDrafts).toHaveLength(0);
    result.drafts.forEach((d, i) => {
      expect(d.id).toBe(`draft-${i}`);
    });
  });

  it('runs in parallel with concurrency=5 (observed overlap)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(20);
      inFlight--;
      return makeDraftResult(ordinal);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 10,
      concurrency: 5,
    });

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(result.drafts).toHaveLength(10);
  });

  it('primes the shared prompt-cache prefix: ordinal 0 completes before any other ordinal starts', async () => {
    // Every draft in a cell shares one system+tool prefix cached via
    // cache_control: ephemeral. An Anthropic cache entry only becomes readable
    // once the response that wrote it starts streaming, so the pool must run
    // ordinal 0 alone (writing the prefix) before fanning out the rest (which
    // then read it warm). Assert the ordering directly: ordinal 0 ends before
    // any other ordinal begins. Without priming, ordinal 0's slow call would
    // overlap the wave and later starts would be recorded before `end-0`.
    const events: string[] = [];
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      events.push(`start-${ordinal}`);
      await delay(ordinal === 0 ? 20 : 5);
      events.push(`end-${ordinal}`);
      return makeDraftResult(ordinal);
    });

    await runGeneratorPool({
      client: mockClient,
      spec,
      count: 5,
      concurrency: 5,
    });

    const end0 = events.indexOf('end-0');
    expect(end0).toBeGreaterThanOrEqual(0);
    const laterStarts = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.startsWith('start-') && e !== 'start-0')
      .map(({ i }) => i);
    expect(laterStarts).toHaveLength(4);
    for (const i of laterStarts) {
      expect(i).toBeGreaterThan(end0);
    }
  });

  it('preserves ordinal order in the drafts array under out-of-order completion', async () => {
    // Higher-ordinal calls resolve first — exercises the ordinal-indexed
    // result map + post-walk reassembly.
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      const drift = (10 - ordinal) * 5;
      await delay(drift);
      return makeDraftResult(ordinal);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 6,
      concurrency: 6,
    });

    expect(result.drafts).toHaveLength(6);
    result.drafts.forEach((d, i) => {
      expect(d.id).toBe(`draft-${i}`);
    });
  });

  it('rejects on the first worker error', async () => {
    const errOrdinal = 3;
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      if (ordinal === errOrdinal) {
        throw new Error('generator boom');
      }
      await delay(5);
      return makeDraftResult(ordinal);
    });

    await expect(
      runGeneratorPool({
        client: mockClient,
        spec,
        count: 8,
        concurrency: 4,
      }),
    ).rejects.toThrow('generator boom');
  });

  it('rejects with SIGINT message when signal is already aborted', async () => {
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) =>
      makeDraftResult(ordinal),
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      runGeneratorPool({
        client: mockClient,
        spec,
        count: 5,
        signal: controller.signal,
        concurrency: 3,
      }),
    ).rejects.toThrow('Aborted by user (SIGINT)');

    expect(mockGenerateOneDraft).not.toHaveBeenCalled();
  });

  it('rejects within one call-latency on mid-flight abort', async () => {
    const controller = new AbortController();
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      await delay(30);
      return makeDraftResult(ordinal);
    });

    const pending = runGeneratorPool({
      client: mockClient,
      spec,
      count: 10,
      signal: controller.signal,
      concurrency: 3,
    });

    await delay(10);
    controller.abort();

    await expect(pending).rejects.toThrow('Aborted by user (SIGINT)');
  });

  it('clamps worker count when concurrency > count', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return makeDraftResult(ordinal);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 3,
      concurrency: 10,
    });

    expect(mockGenerateOneDraft).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(result.drafts).toHaveLength(3);
  });

  it('throws when concurrency < 1', async () => {
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) =>
      makeDraftResult(ordinal),
    );

    await expect(
      runGeneratorPool({
        client: mockClient,
        spec,
        count: 5,
        concurrency: 0,
      }),
    ).rejects.toThrow('concurrency must be >= 1');

    expect(mockGenerateOneDraft).not.toHaveBeenCalled();
  });

  it('aggregates per-call token usage across drafts AND malformed slots', async () => {
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      // Even ordinals → draft, odd → malformed. Both branches still spend
      // tokens (Claude was called regardless).
      return ordinal % 2 === 0
        ? makeDraftResult(ordinal)
        : makeMalformedResult(ordinal);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 4,
      concurrency: 2,
    });

    expect(result.drafts).toHaveLength(2);
    expect(result.malformedDrafts).toHaveLength(2);
    // Drafts at 0 + 2: usage = (100, 200) + (102, 202) = input 202, output 402
    // Malformed at 1 + 3: usage = (50, 75) × 2 = input 100, output 150
    expect(result.tokenUsage.inputTokens).toBe(202 + 100);
    expect(result.tokenUsage.outputTokens).toBe(402 + 150);
  });

  it('populates inBatchDuplicate when two drafts share a canonical surface', async () => {
    // Ordinal 0 and ordinal 2 emit the same sentence → second-occurrence
    // wins flagged.
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) => {
      const surface =
        ordinal === 0 || ordinal === 2 ? 'Yo ___ pan.' : `Sentence ${ordinal} ___.`;
      return makeDraftResult(ordinal, surface);
    });

    const result = await runGeneratorPool({
      client: mockClient,
      spec,
      count: 4,
      concurrency: 4,
    });

    expect(result.drafts).toHaveLength(4);
    // Ordinal 0 → first occurrence, not duplicate. Ordinal 2 → second occurrence, duplicate.
    expect(result.drafts[0].metadata.inBatchDuplicate).toBe(false);
    expect(result.drafts[1].metadata.inBatchDuplicate).toBe(false);
    expect(result.drafts[2].metadata.inBatchDuplicate).toBe(true);
    expect(result.drafts[3].metadata.inBatchDuplicate).toBe(false);
  });

  it('passes signal through to each generateOneDraft call', async () => {
    mockGenerateOneDraft.mockImplementation(async (_client, _spec, ordinal) =>
      makeDraftResult(ordinal),
    );

    const controller = new AbortController();
    await runGeneratorPool({
      client: mockClient,
      spec,
      count: 3,
      signal: controller.signal,
      concurrency: 3,
    });

    for (const call of mockGenerateOneDraft.mock.calls) {
      expect(call[3]).toBe(controller.signal);
    }
  });
});
