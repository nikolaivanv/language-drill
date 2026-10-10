import { capabilityFor } from "./model-request.js";

/**
 * Sonnet 4.6 list pricing ($3 / $15 per MTok), behind `estimateCostUsd` — a
 * rough single-rate estimate for dry-run quotes and Sonnet-4.6-only tools.
 * Anything that mixes models (the generation job's `cost_usd_estimate`, the
 * cell-cost metric, validator-only sweeps) prices each call with
 * `estimateCostUsdFor(model, usage)`, which reads `capabilityFor(model).pricing`.
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

/** USD cost of `usage` at `model`'s list price (see model-request.ts), rounded to 4 decimals. */
export function estimateCostUsdFor(model: string, usage: ClaudeUsageBreakdown): number {
  return estimateCostUsdAt(capabilityFor(model).pricing, usage);
}
