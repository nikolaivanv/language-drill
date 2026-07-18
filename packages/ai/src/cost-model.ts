/**
 * Sonnet-tier list pricing (USD per token), verified 2026-07-05: Sonnet 4.5,
 * Sonnet 4.6, and Sonnet 5 all list at $3/$15 per MTok, so these constants
 * cover the evaluator (Sonnet 5 since 2026-07-05) and the generator
 * (Sonnet 4.6) alike. NOTE: Sonnet 5 bills at intro pricing ($2/$10) through
 * 2026-08-31 — estimates here intentionally use the durable list price, so
 * evaluator costs are overstated ~33% during the intro window.
 *
 * Update path: when the evaluator's MODEL constant in evaluate.ts and the
 * generator's GENERATION_MODEL constant in generate.ts move to a new model,
 * bump these constants in the same PR. These prices are the authoritative
 * source for the --max-cost-usd CLI flag and the generation_jobs.cost_usd_estimate
 * column.
 */
export const SONNET_4_5_PRICING = Object.freeze({
  inputUsdPerToken: 3.0 / 1_000_000, // base
  cacheWriteUsdPerToken: 3.75 / 1_000_000, // 125% of base
  cacheReadUsdPerToken: 0.3 / 1_000_000, // 10% of base
  outputUsdPerToken: 15.0 / 1_000_000,
});

/**
 * Opus-tier list pricing (USD per token), verified 2026-07-18: Opus 4.8
 * lists at $5/$25 per MTok. Used by the theory generator
 * (`THEORY_GENERATION_MODEL` = claude-opus-4-8) cost estimates; everything
 * else in the pipeline stays Sonnet-priced via `SONNET_4_5_PRICING`.
 */
export const OPUS_4_8_PRICING = Object.freeze({
  inputUsdPerToken: 5.0 / 1_000_000, // base
  cacheWriteUsdPerToken: 6.25 / 1_000_000, // 125% of base
  cacheReadUsdPerToken: 0.5 / 1_000_000, // 10% of base
  outputUsdPerToken: 25.0 / 1_000_000,
});

export type ClaudePricing = typeof SONNET_4_5_PRICING;

export type ClaudeUsageBreakdown = {
  /** Non-cached input tokens; billed at base rate. */
  inputTokens: number;
  /** Tokens that wrote a new cache entry; billed at 125% of base. */
  cacheCreationInputTokens: number;
  /** Tokens served from cache; billed at 10% of base. */
  cacheReadInputTokens: number;
  outputTokens: number;
};

export const ZERO_USAGE: ClaudeUsageBreakdown = Object.freeze({
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
});

/** Pure: sums two breakdowns. Used to fold a draft's usage into a cell total. */
export function addUsage(
  a: ClaudeUsageBreakdown,
  b: ClaudeUsageBreakdown,
): ClaudeUsageBreakdown {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** Pure: returns USD cost at the given pricing, rounded to 4 decimal places. */
export function estimateCostUsdAt(
  pricing: ClaudePricing,
  usage: ClaudeUsageBreakdown,
): number {
  const raw =
    usage.inputTokens * pricing.inputUsdPerToken +
    usage.cacheCreationInputTokens * pricing.cacheWriteUsdPerToken +
    usage.cacheReadInputTokens * pricing.cacheReadUsdPerToken +
    usage.outputTokens * pricing.outputUsdPerToken;
  return Math.round(raw * 10000) / 10000;
}

/** Pure: returns USD cost at Sonnet list pricing, rounded to 4 decimal places. */
export function estimateCostUsd(usage: ClaudeUsageBreakdown): number {
  return estimateCostUsdAt(SONNET_4_5_PRICING, usage);
}
