/**
 * Bounded worker pool that fans out `validateDraft` calls across a draft set
 * with a fixed in-flight cap. Pure orchestration — no DB access, no business
 * logic, no per-ordinal state machine.
 *
 * Failure contract (R8): a per-draft `ValidationParseError` (the validator
 * returned a malformed tool call — e.g. a non-number `qualityScore`) is
 * ISOLATED to its ordinal as a `{ kind: 'parse-failed', message }` sentinel in
 * the result map; it does NOT reject the pool. Any OTHER throw (transport /
 * 429 / network / SIGINT-abort) still rejects the pool on first occurrence —
 * in-flight calls drain in the background but no new ordinals are dispatched —
 * because retrying the whole cell on the next tick is the right response there.
 *
 * Consumed by `runOneCell` (Phase A — parallel first-validation). Dedup-retry
 * iterations (attempts 1+) keep calling `validateDraft` live inside
 * `validateAndInsertWithRetry` — only the first-attempt validations are
 * parallelized here.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  ValidationParseError,
  validateDraft,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
} from '@language-drill/ai';

/**
 * Sentinel stored in the result map when a single ordinal's first-validation
 * raised a `ValidationParseError` (R8.2). The consumer (`outcome-pool` /
 * `run-one-cell`, task 26) routes it to a `rejected` ordinal and counts it,
 * instead of the whole cell failing closed.
 */
export type ParseFailedValidation = {
  kind: 'parse-failed';
  message: string;
};

/** A validator-pool result-map value: a real validation or a parse-fail sentinel. */
export type ValidatorPoolEntry = ValidateDraftResult | ParseFailedValidation;

/** Narrows a result-map entry to the parse-failed sentinel. */
export function isParseFailedValidation(
  entry: ValidatorPoolEntry,
): entry is ParseFailedValidation {
  return 'kind' in entry && entry.kind === 'parse-failed';
}

export async function runValidatorPool(opts: {
  drafts: readonly ExerciseDraft[];
  client: Anthropic;
  spec: GenerationSpec;
  signal?: AbortSignal;
  concurrency: number;
}): Promise<Map<number, ValidatorPoolEntry>> {
  const { drafts, client, spec, signal, concurrency } = opts;
  if (concurrency < 1) {
    throw new Error('runValidatorPool: concurrency must be >= 1');
  }

  const results = new Map<number, ValidatorPoolEntry>();
  let nextOrdinal = 0;

  const runOrdinal = async (ordinal: number): Promise<void> => {
    try {
      const validation = await validateDraft(
        client,
        drafts[ordinal],
        spec,
        signal,
      );
      results.set(ordinal, validation);
    } catch (err) {
      // R8.2/R8.4: a malformed validator response is isolated to this
      // ordinal; everything else (transport, abort) rejects the pool.
      if (err instanceof ValidationParseError) {
        results.set(ordinal, { kind: 'parse-failed', message: err.message });
      } else {
        throw err;
      }
    }
  };

  // Prompt-cache priming. Every draft in a cell is validated against one shared
  // system+tool prefix tagged `cache_control: ephemeral`. An Anthropic cache
  // entry only becomes readable once the response that wrote it starts
  // streaming, so releasing all `concurrency` workers at once makes the entire
  // opening wave a cold cache WRITE (1.25x input price) instead of a READ
  // (0.1x). Running ordinal 0 alone writes the prefix once; ordinals 1..N-1 then
  // read it warm. Mirrors `generator-pool.ts`; see docs/tech-debt.md →
  // "Prompt caching" for the measurement that motivated this.
  if (drafts.length > 0) {
    if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
    await runOrdinal(0);
    nextOrdinal = 1;
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
      // JS is single-threaded — `nextOrdinal++` and the bound check both
      // resolve before any `await`, so no two workers ever read the same
      // ordinal even with N workers contending. Same property is what lets
      // `Map.set(ordinal, …)` skip locking.
      const ordinal = nextOrdinal++;
      if (ordinal >= drafts.length) return;
      await runOrdinal(ordinal);
    }
  };

  const workerCount = Math.min(concurrency, drafts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
