import { describe, it, expect } from "vitest";
import type { CoverageSpec } from "@language-drill/shared";
import { decideCoverageTargets, GIVE_UP_MIN_ATTEMPTS } from "./coverage-decision";

const personTR: CoverageSpec = {
  axes: [{ name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } }],
};
const personPolarity: CoverageSpec = {
  axes: [
    { name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } },
    { name: "polarity", floors: { affirmative: 18, negative: 12 } },
  ],
};

describe("decideCoverageTargets (multi-axis)", () => {
  it("water-fills the most-starved person first", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: personTR,
      need: 3,
      approvedByAxis: { person: { "1sg": 8, "2sg": 8, "3sg": 8, "1pl": 8, "2pl": 1, "3pl": 2 } },
      recentOutcome: null,
    });
    const persons = coverageTargets.map((t) => t.person);
    expect(persons).toContain("2pl");
    expect(persons).toContain("3pl");
    expect(coverageTargets).toHaveLength(3);
  });

  it("targets each axis independently and zips into per-draft targets", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: personPolarity,
      need: 4,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets).toHaveLength(4);
    for (const t of coverageTargets) {
      expect(t.person).toBeDefined();
      expect(["affirmative", "negative"]).toContain(t.polarity);
    }
    const pol = coverageTargets.map((t) => t.polarity);
    expect(pol.filter((p) => p === "affirmative")).toHaveLength(2);
  });

  it("suppresses a zero-yield (axis,value) bucket and excludes it", () => {
    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 5,
      approvedByAxis: { person: { "1sg": 8, "2sg": 8, "3sg": 8, "1pl": 8, "3pl": 8 } },
      recentOutcome: { person: { "2pl": { requested: GIVE_UP_MIN_ATTEMPTS, approved: 0 } } },
    });
    expect(suppressed.person).toEqual(["2pl"]);
    expect(coverageTargets.map((t) => t.person)).not.toContain("2pl");
  });

  it("null recentOutcome suppresses nothing", () => {
    const { suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 2,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(suppressed).toEqual({});
  });

  it("never targets an NA value (absent from floors)", () => {
    const esPerson: CoverageSpec = {
      axes: [{ name: "person", floors: { "1sg": 15, "2sg": 15, "3sg": 15, "1pl": 15, "3pl": 15 } }],
    };
    const { coverageTargets } = decideCoverageTargets({
      spec: esPerson,
      need: 10,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets.map((t) => t.person)).not.toContain("2pl");
  });

  it("need <= 0 → empty targets, still reports suppressed", () => {
    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 0,
      approvedByAxis: {},
      recentOutcome: { person: { "2pl": { requested: 3, approved: 0 } } },
    });
    expect(coverageTargets).toEqual([]);
    expect(suppressed.person).toEqual(["2pl"]);
  });

  it("an axis with every value suppressed drops out while others still target", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: { axes: [{ name: "polarity", floors: { affirmative: 5, negative: 5 } }, { name: "person", floors: { "3sg": 5 } }] },
      need: 2,
      approvedByAxis: {},
      recentOutcome: { polarity: { affirmative: { requested: 2, approved: 0 }, negative: { requested: 2, approved: 0 } } },
    });
    expect(coverageTargets).toHaveLength(2);
    for (const t of coverageTargets) {
      expect(t.polarity).toBeUndefined();
      expect(t.person).toBe("3sg");
    }
  });

  it("does NOT suppress a bucket targeted only once (requested < GIVE_UP_MIN_ATTEMPTS)", () => {
    const { suppressed, coverageTargets } = decideCoverageTargets({
      spec: personTR,
      need: 6,
      approvedByAxis: {},
      recentOutcome: { person: { "2pl": { requested: 1, approved: 0 } } },
    });
    expect(suppressed).toEqual({});
    expect(coverageTargets.map((t) => t.person)).toContain("2pl");
  });

  it("does NOT suppress a bucket that yielded at least one approval", () => {
    const { suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 6,
      approvedByAxis: {},
      recentOutcome: { person: { "2pl": { requested: 5, approved: 1 } } },
    });
    expect(suppressed).toEqual({});
  });
});
