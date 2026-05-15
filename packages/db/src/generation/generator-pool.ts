/**
 * Bounded worker pool that fans out `generateOneDraft` calls across `count`
 * ordinals with a fixed in-flight cap. Pure orchestration — no DB access, no
 * business logic, no per-ordinal state machine. The first worker throw
 * rejects the pool; in-flight calls drain in the background but no new
 * ordinals are dispatched.
 *
 * Sibling of `validator-pool.ts`. Consumed by `runOneCell` in place of the
 * sequential generator loop that used to live inside `generateBatch`. The
 * `generateBatch` wrapper is kept around for `runRetryGeneration`, which must
 * stay sequential because dedup-index collision resolution races otherwise.
 *
 * Within-batch diversity feedback (the `recentStems` array previously
 * threaded into each successive system prompt) is dropped: `generateOneDraft`
 * always renders the prompt with an empty recent-stems list. Hard dedup is
 * still enforced post-hoc via `populateInBatchDuplicates` (flags collisions
 * for the validator) and at INSERT time via `exercises_dedup_idx` +
 * `runRetryGeneration`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  generateOneDraft,
  populateInBatchDuplicates,
  ZERO_USAGE,
  addUsage,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
  type MalformedDraft,
} from '@language-drill/ai';

export type GeneratorPoolResult = {
  drafts: ExerciseDraft[];
  malformedDrafts: MalformedDraft[];
  tokenUsage: ClaudeUsageBreakdown;
};

export async function runGeneratorPool(opts: {
  client: Anthropic;
  spec: GenerationSpec;
  count: number;
  signal?: AbortSignal;
  concurrency: number;
}): Promise<GeneratorPoolResult> {
  const { client, spec, count, signal, concurrency } = opts;
  if (concurrency < 1) {
    throw new Error('runGeneratorPool: concurrency must be >= 1');
  }

  type Slot =
    | { kind: 'draft'; draft: ExerciseDraft; usage: ClaudeUsageBreakdown }
    | {
        kind: 'malformed';
        malformed: MalformedDraft;
        usage: ClaudeUsageBreakdown;
      };

  const results = new Map<number, Slot>();
  let nextOrdinal = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new Error('Aborted by user (SIGINT)');
      // JS is single-threaded — `nextOrdinal++` and the bound check both
      // resolve before any `await`, so no two workers ever read the same
      // ordinal even with N workers contending. Same property is what lets
      // `Map.set(ordinal, …)` skip locking.
      const ordinal = nextOrdinal++;
      if (ordinal >= count) return;
      const result = await generateOneDraft(client, spec, ordinal, signal);
      results.set(ordinal, result);
    }
  };

  const workerCount = Math.min(concurrency, count);
  await Promise.all(Array.from({ length: workerCount }, worker));

  // Walk in ordinal order so the aggregated arrays stay deterministic across
  // serial and parallel runs. `populateInBatchDuplicates` depends on drafts
  // appearing in ordinal order to match `generateBatch`'s historical
  // first-occurrence-wins semantics.
  let tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  const drafts: ExerciseDraft[] = [];
  const malformedDrafts: MalformedDraft[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const slot = results.get(ordinal);
    if (!slot) continue;
    tokenUsage = addUsage(tokenUsage, slot.usage);
    if (slot.kind === 'draft') {
      drafts.push(slot.draft);
    } else {
      malformedDrafts.push(slot.malformed);
    }
  }
  populateInBatchDuplicates(drafts);

  return { drafts, malformedDrafts, tokenUsage };
}
