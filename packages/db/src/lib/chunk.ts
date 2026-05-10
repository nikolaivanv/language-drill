/**
 * Split a readonly array into fixed-size batches.
 *
 * Used by Phase 4's scheduler Lambda + the CLI's `--queue` mode to honor SQS
 * `SendMessageBatchCommand`'s 10-message-per-batch hard limit. Pure, no
 * dependencies, no assumption about element shape.
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error(`chunk: size must be > 0 (got ${size})`);
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
