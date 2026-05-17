/**
 * Bounded worker pool that fans out `validateAndInsertWithRetry` calls across
 * the drafts of a cell with a fixed in-flight cap. Pure orchestration — no
 * business logic, no counter accumulation. The first worker throw rejects
 * the pool; in-flight calls drain in the background but no new ordinals are
 * dispatched.
 *
 * Sibling of `validator-pool.ts` and `generator-pool.ts`. Consumed by
 * `runOneCell` to replace the per-ordinal sequential outer loop that
 * previously dominated wall-clock when cells had a large dedup-retry tail
 * (see prod data for 2026-05-16 `es:b1:vocab_recall:es-b1-environment-vocab`:
 * dedupGivenUp=17 → ~17 × 3 retries × ~4 s/retry = ~200 s tail).
 *
 * Each worker invokes `validateAndInsertWithRetry` for its assigned ordinal.
 * That function's INTERNAL attempt loop stays sequential — the dedup-detection
 * contract (one INSERT, observe collision, retry) requires it — but across
 * ordinals there's no shared state, so the outer dispatch parallelizes
 * cleanly. Two ordinals racing on the same canonical surface still produce
 * the same outcome as in series: `ON CONFLICT DO NOTHING` returns empty for
 * the loser, which then retries (identical to today's behaviour).
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  ExerciseDraft,
  GenerationSpec,
  ValidateDraftResult,
} from '@language-drill/ai';

import type { Db } from '../client';

import type { Cell } from './cells';
import {
  validateAndInsertWithRetry,
  type DraftOutcome,
} from './validate-and-insert';

export async function runOutcomePool(opts: {
  db: Db;
  client: Anthropic;
  spec: GenerationSpec;
  drafts: readonly ExerciseDraft[];
  cell: Cell;
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
  };
  generatedAt: Date;
  firstValidations: Map<number, ValidateDraftResult>;
  signal?: AbortSignal;
  concurrency: number;
}): Promise<Map<number, DraftOutcome>> {
  const {
    db,
    client,
    spec,
    drafts,
    cell,
    args,
    generatedAt,
    firstValidations,
    signal,
    concurrency,
  } = opts;

  if (concurrency < 1) {
    throw new Error('runOutcomePool: concurrency must be >= 1');
  }

  const results = new Map<number, DraftOutcome>();
  let nextOrdinal = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
      // JS is single-threaded — `nextOrdinal++` and the bound check both
      // resolve before any `await`, so no two workers ever read the same
      // ordinal even with N workers contending. Same property is what lets
      // `Map.set(ordinal, …)` skip locking.
      const ordinal = nextOrdinal++;
      if (ordinal >= drafts.length) return;
      const outcome = await validateAndInsertWithRetry({
        db,
        client,
        spec,
        draft: drafts[ordinal],
        ordinal,
        cell,
        args,
        generatedAt,
        signal,
        precomputedFirstValidation: firstValidations.get(ordinal),
      });
      results.set(ordinal, outcome);
    }
  };

  const workerCount = Math.min(concurrency, drafts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
