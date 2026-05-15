import { describe, it, expect } from "vitest";
import {
  SONNET_4_5_PRICING,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
} from "./cost-model.js";
import {
  buildCostDetails,
  mapUsageDetails,
} from "./observability.js";

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

// ---------------------------------------------------------------------------
// Cost-reconciliation round-trip (Req 4 AC 3)
// ---------------------------------------------------------------------------
//
// The Langfuse Proxy reports per-bucket USD via `buildCostDetails`; the DB's
// `generation_jobs.cost_usd_estimate` column is fed by `estimateCostUsd`.
// Dashboards lose meaning if these two diverge. The contract is "agree to
// within $0.0001 per generation" — `estimateCostUsd` rounds to 4 decimal
// places, so the unrounded sum and the rounded estimate can differ by at
// most half a step. This test fixes that contract across realistic usage
// shapes.

describe("cost reconciliation — buildCostDetails ↔ estimateCostUsd (Req 4 AC 3)", () => {
  /** Convert an Anthropic-style usage object to ClaudeUsageBreakdown. */
  function toBreakdown(u: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  }): ClaudeUsageBreakdown {
    return {
      inputTokens: u.input_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
    };
  }

  // Realistic mix of shapes the four AI surfaces actually emit.
  const fixtures = [
    { label: "all-zero",
      u: {} },
    { label: "evaluate (cache-heavy)",
      u: { input_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 180 } },
    { label: "generate (no cache)",
      u: { input_tokens: 1800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 720 } },
    { label: "first-call cache write",
      u: { input_tokens: 0, cache_creation_input_tokens: 3500, cache_read_input_tokens: 0, output_tokens: 60 } },
    { label: "annotate (large output)",
      u: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1900, output_tokens: 7800 } },
    { label: "validate (small)",
      u: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 75 } },
    { label: "tiny",
      u: { input_tokens: 1, output_tokens: 1 } },
    { label: "very large (Phase-2 worst case)",
      u: { input_tokens: 50_000, cache_creation_input_tokens: 12_000, cache_read_input_tokens: 250_000, output_tokens: 8000 } },
  ];

  for (const { label, u } of fixtures) {
    it(`agrees to within $0.0001 for: ${label}`, () => {
      // `buildCostDetails` returns the four per-bucket USD values PLUS an
      // explicit `total` (Langfuse-dashboard hint). The parity invariant
      // is over the buckets only — including `total` in the sum would
      // double-count.
      const details = buildCostDetails(u);
      const { total, ...buckets } = details;
      const bucketSum = Object.values(buckets).reduce((acc, v) => acc + v, 0);
      const dbEstimate = estimateCostUsd(toBreakdown(u));
      expect(Math.abs(bucketSum - dbEstimate)).toBeLessThanOrEqual(0.0001);
      // The explicit `total` key matches the bucket sum exactly (same
      // arithmetic, no rounding).
      expect(total).toBeCloseTo(bucketSum, 12);
    });
  }

  it("mapUsageDetails keys match the four ClaudeUsageBreakdown buckets (1:1 dashboards)", () => {
    const sample = {
      input_tokens: 1,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
      output_tokens: 4,
    };
    expect(mapUsageDetails(sample)).toEqual({
      input: 1,
      cache_creation_input: 2,
      cache_read_input: 3,
      output: 4,
    });
  });
});
