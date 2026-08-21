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

/** tr-a1-imperative's shape: two 2-value axes. */
const imperative2x2: CoverageSpec = {
  axes: [
    { name: "person", floors: { "2sg": 8, "2pl": 8 } },
    { name: "polarity", floors: { affirmative: 10, negative: 8 } },
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

describe("decideCoverageTargets — cross-axis combination coverage", () => {
  // Regression for the defect measured on prod 2026-08-21. Independent per-axis
  // water-fill zipped index-wise can only ever emit lcm(m, n) of the m x n
  // combinations. For two 2-value axes that is 2 of 4 — a hard diagonal no floor
  // value escapes. tr-a1-imperative held 10 rows of 2sg+affirmative and 10 of
  // 2pl+negative and nothing else, with EVERY floor satisfied; tr-a2-optative
  // held 15/15 in the same shape. The learner never saw half the paradigm.
  const key = (t: { person?: string; polarity?: string }) => `${t.person}|${t.polarity}`;

  it("covers all four combinations of a 2x2 spec before repeating any", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: imperative2x2,
      need: 4,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets).toHaveLength(4);
    expect(new Set(coverageTargets.map(key)).size).toBe(4);
  });

  it("does not collapse onto the diagonal when the pool already holds only the diagonal", () => {
    // Exactly tr-a1-imperative's prod state: 2sg+aff 10, 2pl+neg 10. Per-axis
    // counts are balanced (2sg 10 / 2pl 10, aff 10 / neg 10), which is why every
    // floor passed — the gap is only visible in the combinations.
    const { coverageTargets } = decideCoverageTargets({
      spec: imperative2x2,
      need: 4,
      approvedByAxis: { person: { "2sg": 10, "2pl": 10 }, polarity: { affirmative: 10, negative: 10 } },
      recentOutcome: null,
    });
    const combos = new Set(coverageTargets.map(key));
    expect(combos.has("2sg|negative")).toBe(true);
    expect(combos.has("2pl|affirmative")).toBe(true);
  });

  it("reaches every combination of a 6x2 spec within one full cycle", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: personPolarity,
      need: 12,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets).toHaveLength(12);
    expect(new Set(coverageTargets.map(key)).size).toBe(12);
  });

  it("still water-fills the most-starved value first on a single axis", () => {
    // The combination tie-break must not override per-axis deficit ordering:
    // the starved values are chosen and the well-stocked ones are never touched.
    // Deliberately does NOT pin the tie-break between two equally-starved values
    // — that is not part of the contract.
    const { coverageTargets } = decideCoverageTargets({
      spec: personTR,
      need: 2,
      approvedByAxis: { person: { "1sg": 9, "2sg": 9, "3sg": 9, "1pl": 9, "2pl": 0, "3pl": 1 } },
      recentOutcome: null,
    });
    expect(coverageTargets[0].person).toBe("2pl");
    for (const t of coverageTargets) expect(["2pl", "3pl"]).toContain(t.person);
  });

  it("respects suppression while still spreading across combinations", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: imperative2x2,
      need: 4,
      approvedByAxis: {},
      recentOutcome: { polarity: { negative: { requested: GIVE_UP_MIN_ATTEMPTS, approved: 0 } } },
    });
    expect(coverageTargets).toHaveLength(4);
    for (const t of coverageTargets) expect(t.polarity).toBe("affirmative");
    expect(new Set(coverageTargets.map((t) => t.person))).toEqual(new Set(["2sg", "2pl"]));
  });
});
