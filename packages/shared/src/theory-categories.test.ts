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
  // Spanish A1
  "es-a1-noun-gender": "articles",
  "es-a1-noun-plural": "morphology",
  "es-a1-gender-agreement": "articles",
  "es-a1-articles": "articles",
  "es-a1-demonstratives": "pronouns",
  "es-a1-possessives-atonic": "pronouns",
  "es-a1-subject-pronouns": "pronouns",
  "es-a1-interrogatives": "syntax",
  "es-a1-present-indicative-regular": "tenses",
  "es-a1-present-irregular-core": "tenses",
  "es-a1-ser-estar-basic": "pairs",
  "es-a1-hay-estar": "pairs",
  "es-a1-gustar-basic": "syntax",
  "es-a1-querer-poder-infinitive": "syntax",
  "es-a1-numbers-ordinals": "morphology",
  "es-a1-quantifiers-muy-mucho": "pairs",
  "es-a1-negation-tampoco": "syntax",
  "es-a1-relative-que-basic": "syntax",
  "es-a1-noun-modifiers-de": "syntax",
  "es-a1-coordination-basic": "syntax",
  "es-a1-porque-para": "syntax",
  "es-a2-present-irregular-stem-changes": "tenses",
  "es-a2-preterite-regular": "tenses",
  "es-a2-preterite-irregular": "tenses",
  "es-a2-imperfect": "tenses",
  "es-a2-preterito-perfecto": "tenses",
  "es-a2-imperative-affirmative": "moods",
  "es-a2-estar-gerundio": "tenses",
  "es-a2-ir-a-future": "tenses",
  "es-a2-periphrases-obligation-aspect": "syntax",
  "es-a2-direct-object-pronouns": "pronouns",
  "es-a2-indirect-object-pronouns-se": "pronouns",
  "es-a2-tonic-pronouns-prepositions": "pronouns",
  "es-a2-personal-a": "syntax",
  "es-a2-reflexive-verbs": "pronouns",
  "es-a2-gustar-type-verbs": "syntax",
  "es-a2-articles-use": "articles",
  "es-a2-possessives-tonic": "pronouns",
  "es-a2-todo-otro-quantifiers": "syntax",
  "es-a2-temporal-clauses": "syntax",
  "es-a2-si-present-conditional": "moods",
  "es-a2-exclamatives-impersonals": "syntax",
  "es-a2-connectors": "syntax",
  "es-a2-comparatives-superlatives": "syntax",
  "es-b1-present-subjunctive": "moods",
  "es-b1-conditional": "moods",
  "es-b1-llevar-time-expressions": "syntax",
  "es-b1-relative-clauses": "syntax",
  "es-b1-passive-se": "syntax",
  "es-b2-past-subjunctive": "moods",
  "es-b2-compound-tenses": "tenses",
  "es-b2-conditional-perfect": "moods",
  "es-b2-complex-conditionals": "syntax",
  "es-b2-nuanced-ser-estar": "pairs",
  // Turkish A1
  "tr-a1-vowel-harmony": "orthography",
  "tr-a1-stem-changes": "orthography",
  "tr-a1-personal-suffixes": "morphology",
  "tr-a1-plural-suffix": "morphology",
  "tr-a1-locative": "cases",
  "tr-a1-present-continuous": "tenses",
  "tr-a1-negation": "tenses",
  "tr-a1-dili-past": "tenses",
  "tr-a1-future": "tenses",
  "tr-a1-imperative": "moods",
  "tr-a1-questions": "syntax",
  "tr-a1-degil": "syntax",
  "tr-a1-var-yok": "syntax",
  "tr-a1-accusative-definite-object": "cases",
  "tr-a1-ablative-dative": "cases",
  "tr-a1-genitive-possessive": "cases",
  "tr-a1-demonstratives": "pronouns",
  "tr-a1-personal-pronouns": "pronouns",
  "tr-a1-numbers-ordinals": "morphology",
  "tr-a1-possessive-suffixes": "morphology",
  "tr-a1-instrumental-ile": "cases",
  "tr-a1-postpositions-once-sonra": "syntax",
  "tr-a1-dan-a-kadar": "syntax",
  "tr-a1-ki-relativizer": "syntax",
  "tr-a1-gore-bence": "syntax",
  "tr-a1-beri-dir": "syntax",
  "tr-a1-comparative-superlative": "syntax",
  // Turkish A2
  "tr-a2-indefinite-compound": "morphology",
  "tr-a2-suffix-order-buffers": "morphology",
  "tr-a2-optative": "moods",
  "tr-a2-indefinite-pronouns": "pronouns",
  "tr-a2-consonant-doubling": "orthography",
  "tr-a2-reflexive-reciprocal-pronouns": "pronouns",
  "tr-a2-distributive": "morphology",
  "tr-a2-mis-evidential": "tenses",
  "tr-a2-aorist": "tenses",
  "tr-a2-ability-necessity": "moods",
  "tr-a2-converbs": "syntax",
  "tr-a2-converb-temporal": "syntax",
  "tr-a2-nominalization": "syntax",
  "tr-a2-relative-an": "syntax",
  "tr-a2-gibi-kadar": "syntax",
  "tr-a2-correlative-conjunctions": "syntax",
  "tr-a2-causal-connectors": "syntax",
  "tr-a2-ca-suffix": "morphology",
  "tr-a2-pekistirme": "morphology",
  "tr-a2-purpose-icin-uzere": "syntax",
  "tr-a2-reported-speech": "syntax",
  // Turkish B1
  "tr-b1-past-continuous-iyordu": "tenses",
  "tr-b1-real-conditional": "moods",
  "tr-b1-conditional-irrealis": "moods",
  "tr-b1-obligation-periphrases": "moods",
  "tr-b1-causative-voice": "morphology",
  "tr-b1-passive-voice": "morphology",
  "tr-b1-reflexive-voice-kendi": "morphology",
  "tr-b1-reciprocal-voice": "morphology",
  "tr-b1-converb-while-yken": "syntax",
  "tr-b1-since-converb": "syntax",
  "tr-b1-participles-dik-acak": "syntax",
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
    expect(resolveTheoryCategory("tr-a2-vocab-city-shopping")).toBe("other");
  });
});
