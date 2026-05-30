import { describe, it, expect } from "vitest";
import {
  THEORY_CATEGORIES,
  FALLBACK_CATEGORY_ID,
  getTheoryCategory,
  resolveTheoryCategory,
  type TheoryCategoryId,
} from "./theory-categories";

const VALID_IDS = new Set<TheoryCategoryId>(
  THEORY_CATEGORIES.map((c) => c.id),
);

// Mirror of the module-private map, kept here so the test pins the intended
// key→category bindings (a drift in the source map fails this assertion).
const EXPECTED_KEY_CATEGORY: Record<string, TheoryCategoryId> = {
  "es-b1-present-subjunctive": "moods",
  "es-b1-conditional": "moods",
  "es-b1-llevar-time-expressions": "syntax",
  "es-b1-relative-clauses": "syntax",
  "es-b1-passive-se": "syntax",
  "es-b1-comparatives-superlatives": "syntax",
  "es-b2-past-subjunctive": "moods",
  "es-b2-compound-tenses": "tenses",
  "es-b2-conditional-perfect": "moods",
  "es-b2-complex-conditionals": "syntax",
  "es-b2-nuanced-ser-estar": "pairs",
  "tr-a1-vowel-harmony": "orthography",
  "tr-a1-personal-suffixes": "morphology",
  "tr-a1-plural-suffix": "articles",
  "tr-a1-locative": "cases",
  "tr-a2-dili-past": "tenses",
  "tr-a2-question-formation": "syntax",
  "tr-a2-accusative-definite-object": "cases",
  "tr-a2-genitive-possessive": "cases",
  "tr-a2-ablative-dative": "cases",
};

describe("THEORY_CATEGORIES — taxonomy invariants", () => {
  it("has unique category ids", () => {
    const ids = THEORY_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has strictly increasing order values", () => {
    for (let i = 1; i < THEORY_CATEGORIES.length; i++) {
      expect(THEORY_CATEGORIES[i].order).toBeGreaterThan(
        THEORY_CATEGORIES[i - 1].order,
      );
    }
  });

  it("places 'other' last in display order", () => {
    const last = THEORY_CATEGORIES[THEORY_CATEGORIES.length - 1];
    expect(last.id).toBe("other");
    const otherOrder = last.order;
    const maxNonOther = Math.max(
      ...THEORY_CATEGORIES.filter((c) => c.id !== "other").map((c) => c.order),
    );
    expect(otherOrder).toBeGreaterThan(maxNonOther);
  });

  it("gives every category a non-empty label", () => {
    for (const c of THEORY_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("uses 'other' as the fallback id", () => {
    expect(FALLBACK_CATEGORY_ID).toBe("other");
    expect(VALID_IDS.has(FALLBACK_CATEGORY_ID)).toBe(true);
  });
});

describe("getTheoryCategory", () => {
  it("returns the matching entry for every known id", () => {
    for (const c of THEORY_CATEGORIES) {
      expect(getTheoryCategory(c.id)).toEqual(c);
    }
  });

  it("falls back to the 'other' entry for an unknown id", () => {
    // Cast through unknown to simulate a stray id at a non-typed boundary.
    const bogus = "does-not-exist" as unknown as TheoryCategoryId;
    expect(getTheoryCategory(bogus).id).toBe("other");
  });
});

describe("resolveTheoryCategory — key mapping", () => {
  it("maps every known grammar-point key to a valid category id", () => {
    for (const [key, expected] of Object.entries(EXPECTED_KEY_CATEGORY)) {
      const resolved = resolveTheoryCategory(key);
      expect(VALID_IDS.has(resolved)).toBe(true);
      expect(resolved).toBe(expected);
    }
  });

  it("returns 'other' for an unmapped key", () => {
    expect(resolveTheoryCategory("es-a1-not-in-map")).toBe("other");
    expect(resolveTheoryCategory("totally-unknown-key")).toBe("other");
  });

  it("returns 'other' for null and undefined", () => {
    expect(resolveTheoryCategory(null)).toBe("other");
    expect(resolveTheoryCategory(undefined)).toBe("other");
  });

  it("returns 'other' for a vocab-kind key (intentionally unmapped)", () => {
    expect(resolveTheoryCategory("es-b1-environment-vocab")).toBe("other");
    expect(resolveTheoryCategory("tr-a2-everyday-vocab")).toBe("other");
  });
});
