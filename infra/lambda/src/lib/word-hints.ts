import type { WordHintUnit } from '@language-drill/shared';

export type ResolveWordHintsDeps = {
  /** Return cached units, or null on a cache miss. */
  readCache: () => Promise<WordHintUnit[] | null>;
  /** Throw a typed limit/capacity error to abort before generating. */
  checkLimit: () => Promise<void>;
  /** Run the LLM call. */
  generate: () => Promise<WordHintUnit[]>;
  /** Persist units to the cache (best-effort; race-safe upsert). */
  writeCache: (units: WordHintUnit[]) => Promise<void>;
  /** Record one metered usage event. */
  meter: () => Promise<void>;
};

/**
 * Cache-or-generate the per-exercise word-hint map. Metering + gating happen
 * ONLY on a real cache miss with a non-empty generation.
 */
export async function resolveWordHints(
  deps: ResolveWordHintsDeps,
): Promise<{ units: WordHintUnit[]; cached: boolean }> {
  const cached = await deps.readCache();
  if (cached !== null) return { units: cached, cached: true };

  await deps.checkLimit();
  const units = await deps.generate();
  if (units.length === 0) return { units: [], cached: false };

  await deps.writeCache(units);
  await deps.meter();
  return { units, cached: false };
}
