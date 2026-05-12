/**
 * Bounded worker pool that fans out `validateDraft` calls across a draft set
 * with a fixed in-flight cap. Pure orchestration — no DB access, no business
 * logic, no per-ordinal state machine. The first worker throw rejects the
 * pool; in-flight calls drain in the background but no new ordinals are
 * dispatched.
 *
 * Consumed by `runOneCell` (Phase A — parallel first-validation). Dedup-retry
 * iterations (attempts 1+) keep calling `validateDraft` live inside
 * `validateAndInsertWithRetry` — only the first-attempt validations are
 * parallelized here.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  validateDraft,
  type ExerciseDraft,
  type GenerationSpec,
  type ValidateDraftResult,
} from '@language-drill/ai';

export async function runValidatorPool(opts: {
  drafts: readonly ExerciseDraft[];
  client: Anthropic;
  spec: GenerationSpec;
  signal?: AbortSignal;
  concurrency: number;
}): Promise<Map<number, ValidateDraftResult>> {
  const { drafts, client, spec, signal, concurrency } = opts;
  if (concurrency < 1) {
    throw new Error('runValidatorPool: concurrency must be >= 1');
  }

  const results = new Map<number, ValidateDraftResult>();
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
      const validation = await validateDraft(client, drafts[ordinal], spec);
      results.set(ordinal, validation);
    }
  };

  const workerCount = Math.min(concurrency, drafts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
