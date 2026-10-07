import { describe, expect, it } from "vitest";

import { ZERO_USAGE } from "../src/index.js";
import { armMetrics, fwDedupVerdict, normalizeTitle, type ArmMetrics, type ArmOutcome } from "./fw-dedup-eval";

const acc = (title: string, status: "auto-approved" | "flagged" = "auto-approved") => ({
  summary: { title, task: "t", requiredElements: [] },
  status,
});

describe("normalizeTitle", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(normalizeTitle("  El  Teletrabajo:  ¿Avance? ")).toBe("el teletrabajo: ¿avance?");
    expect(normalizeTitle("Café")).toBe(normalizeTitle("cafe"));
  });
});

describe("armMetrics", () => {
  it("pools across cells", () => {
    const outcomes: ArmOutcome[] = [
      { requested: 4, accepted: [acc("a"), acc("b", "flagged")], validations: 4, autoApproved: 3, usage: ZERO_USAGE },
      { requested: 2, accepted: [acc("c")], validations: 2, autoApproved: 1, usage: ZERO_USAGE },
    ];
    const m = armMetrics(outcomes, [[true, false], [false]]);
    expect(m).toEqual({
      requested: 6, accepted: 3, duplicates: 1, duplicateRate: 1 / 3,
      underfillRate: 3 / 6, approvalRate: 4 / 6, costUsd: 0,
    });
  });

  it("is all zeros with nothing requested", () => {
    expect(armMetrics([], [])).toEqual({
      requested: 0, accepted: 0, duplicates: 0, duplicateRate: 0, underfillRate: 0, approvalRate: 0, costUsd: 0,
    });
  });
});

describe("fwDedupVerdict", () => {
  const m = (duplicateRate: number, approvalRate = 0.9): ArmMetrics => ({
    requested: 20, accepted: 20, duplicates: 0, duplicateRate, underfillRate: 0, approvalRate, costUsd: 0,
  });

  it("is ship-ready when the judge passed, baseline duplicates, candidate does not, approval holds", () => {
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4), candidate: m(0.05, 0.8) })).toBe("ship-ready");
  });

  it("is inconclusive when the baseline barely duplicates", () => {
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.19), candidate: m(0) })).toBe("inconclusive");
  });

  it("is inspect when the judge failed, candidate still duplicates, or approval drops >10pp", () => {
    expect(fwDedupVerdict({ judgePassed: false, baseline: m(0.4), candidate: m(0) })).toBe("inspect");
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4), candidate: m(0.06) })).toBe("inspect");
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4, 0.9), candidate: m(0, 0.79) })).toBe("inspect");
  });
});
