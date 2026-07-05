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

/** Pure: returns USD cost rounded to 4 decimal places. */
export function estimateCostUsd(usage: ClaudeUsageBreakdown): number {
  const raw =
    usage.inputTokens * SONNET_4_5_PRICING.inputUsdPerToken +
    usage.cacheCreationInputTokens * SONNET_4_5_PRICING.cacheWriteUsdPerToken +
    usage.cacheReadInputTokens * SONNET_4_5_PRICING.cacheReadUsdPerToken +
    usage.outputTokens * SONNET_4_5_PRICING.outputUsdPerToken;
  return Math.round(raw * 10000) / 10000;
}
