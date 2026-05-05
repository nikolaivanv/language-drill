import { describe, it, expect } from "vitest";
import {
  SONNET_4_5_PRICING,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
} from "./cost-model.js";

describe("SONNET_4_5_PRICING", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(SONNET_4_5_PRICING)).toBe(true);
  });

  it("uses the documented per-tier rates", () => {
    expect(SONNET_4_5_PRICING.inputUsdPerToken).toBe(3.0 / 1_000_000);
    expect(SONNET_4_5_PRICING.cacheWriteUsdPerToken).toBe(3.75 / 1_000_000);
    expect(SONNET_4_5_PRICING.cacheReadUsdPerToken).toBe(0.3 / 1_000_000);
    expect(SONNET_4_5_PRICING.outputUsdPerToken).toBe(15.0 / 1_000_000);
  });
});

describe("ZERO_USAGE", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(ZERO_USAGE)).toBe(true);
  });

  it("has all four token fields at zero", () => {
    expect(ZERO_USAGE).toEqual({
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    });
  });
});

describe("estimateCostUsd", () => {
  it("returns 0 for ZERO_USAGE", () => {
    expect(estimateCostUsd(ZERO_USAGE)).toBe(0);
  });

  it("charges base rate for non-cached input tokens", () => {
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    };
    expect(estimateCostUsd(usage)).toBe(3.0);
  });

  it("charges cache-write rate for cache_creation_input_tokens", () => {
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    };
    expect(estimateCostUsd(usage)).toBe(3.75);
  });

  it("charges cache-read rate for cache_read_input_tokens", () => {
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      outputTokens: 0,
    };
    expect(estimateCostUsd(usage)).toBe(0.3);
  });

  it("charges output rate for output tokens", () => {
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 1_000_000,
    };
    expect(estimateCostUsd(usage)).toBe(15.0);
  });

  it("sums across tiers and rounds to 4 decimal places", () => {
    // 100 * 3e-6 = 0.0003
    // 200 * 3.75e-6 = 0.00075
    // 50  * 0.3e-6  = 0.000015
    // 75  * 15e-6   = 0.001125
    // Total = 0.00219 → rounds to 0.0022
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 100,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 50,
      outputTokens: 75,
    };
    expect(estimateCostUsd(usage)).toBe(0.0022);
  });
});

describe("addUsage", () => {
  it("sums field-by-field", () => {
    const a: ClaudeUsageBreakdown = {
      inputTokens: 1,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 3,
      outputTokens: 4,
    };
    const b: ClaudeUsageBreakdown = {
      inputTokens: 10,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
      outputTokens: 40,
    };
    expect(addUsage(a, b)).toEqual({
      inputTokens: 11,
      cacheCreationInputTokens: 22,
      cacheReadInputTokens: 33,
      outputTokens: 44,
    });
  });

  it("is the identity operator with ZERO_USAGE", () => {
    const usage: ClaudeUsageBreakdown = {
      inputTokens: 7,
      cacheCreationInputTokens: 8,
      cacheReadInputTokens: 9,
      outputTokens: 10,
    };
    expect(addUsage(usage, ZERO_USAGE)).toEqual(usage);
    expect(addUsage(ZERO_USAGE, usage)).toEqual(usage);
  });
});
