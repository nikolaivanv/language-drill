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
import type { ExerciseDraft, GenerationSpec } from '@language-drill/ai';

import type { Db } from '../client';

import type { Cell } from './cells';
import {
  validateAndInsertWithRetry,
  validatorParseFailedOutcome,
  type DraftOutcome,
} from './validate-and-insert';
import {
  isParseFailedValidation,
  type ValidatorPoolEntry,
} from './validator-pool';

/**
 * R4.2 — within-run early-bail probe size. The circuit breaker only arms after
 * this many outcomes have resolved, so a small unlucky run of collisions on a
 * tiny sample can't trip it.
 */
export const EARLY_BAIL_PROBE_COUNT = 8;

/**
 * R4.2 — dedup-domination threshold. Once `EARLY_BAIL_PROBE_COUNT` outcomes have
 * resolved, the breaker trips if at least this fraction of them are
 * `dedup-given-up` (the search space is exhausted; further ordinals would
 * mostly collide for no new variety).
 */
export const EARLY_BAIL_RATIO = 0.7;

export type RunOutcomePoolResult = {
  results: Map<number, DraftOutcome>;
  /**
   * R4.2/R4.3 — `true` when the dedup circuit breaker tripped mid-run and the
   * pool stopped dispatching remaining ordinals. The cell still closes
   * `succeeded`; `runOneCell` surfaces this on `CellResult` + the log (task 20).
   */
  earlyBailed: boolean;
};

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
  firstValidations: Map<number, ValidatorPoolEntry>;
  signal?: AbortSignal;
  concurrency: number;
}): Promise<RunOutcomePoolResult> {
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
  // R4.2 running counters + breaker flag. A plain boolean (not a derived
  // AbortController passed downstream) is deliberate: workers `return`
  // gracefully on it so the cell closes `succeeded` (R4.3). Routing a bail
  // signal into `validateAndInsertWithRetry` would instead make in-flight calls
  // throw `Aborted by user (SIGINT)` and fail-close the cell. The parent
  // `signal` (genuine SIGINT / soft-deadline) keeps its fail-close throw below.
  let dedupGivenUpCount = 0;
  let earlyBailed = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
      // R4.2 — circuit breaker tripped: stop pulling new ordinals WITHOUT
      // throwing. In-flight ordinals already past this point finish and record
      // their outcomes; only not-yet-dispatched ordinals are skipped.
      if (earlyBailed) return;
      // JS is single-threaded — `nextOrdinal++` and the bound check both
      // resolve before any `await`, so no two workers ever read the same
      // ordinal even with N workers contending. Same property is what lets
      // `Map.set(ordinal, …)` skip locking.
      const ordinal = nextOrdinal++;
      if (ordinal >= drafts.length) return;
      // R8.3: a parse-failed first-validation means the validator returned a
      // malformed response for this draft. Route it straight to `rejected`
      // (counted as a validator-parse failure) instead of re-validating — one
      // bad response costs one ordinal, never the whole cell.
      const pre = firstValidations.get(ordinal);
      let outcome: DraftOutcome;
      if (pre && isParseFailedValidation(pre)) {
        outcome = validatorParseFailedOutcome();
      } else {
        outcome = await validateAndInsertWithRetry({
          db,
          client,
          spec,
          draft: drafts[ordinal],
          ordinal,
          cell,
          args,
          generatedAt,
          signal,
          precomputedFirstValidation: pre,
        });
      }
      results.set(ordinal, outcome);
      if (outcome.terminalStatus === 'dedup-given-up') dedupGivenUpCount++;
      // Arm only after the probe count; trip when dedup dominates the sample.
      if (
        !earlyBailed &&
        results.size >= EARLY_BAIL_PROBE_COUNT &&
        dedupGivenUpCount / results.size >= EARLY_BAIL_RATIO
      ) {
        earlyBailed = true;
      }
    }
  };

  const workerCount = Math.min(concurrency, drafts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { results, earlyBailed };
}
