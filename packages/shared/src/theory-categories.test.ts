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
  "es-a1-prepositions-a-en": "pairs",
  "es-a1-telling-time": "syntax",
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
  "es-a2-indefinites-double-negation": "syntax",
  "es-a2-por-para": "pairs",
  "es-a2-mente-adverbs": "morphology",
  "es-a2-adjective-apocopation": "morphology",
  "es-a2-comparatives-superlatives": "syntax",
  "es-b1-present-subjunctive": "moods",
  "es-b1-conditional": "moods",
  "es-b1-llevar-time-expressions": "syntax",
  "es-b1-relative-clauses": "syntax",
  "es-b1-passive-se": "syntax",
  "es-b2-past-subjunctive": "moods",
  "es-b2-compound-tenses": "tenses",
  "es-b2-conditional-perfect": "moods",
  "es-b2-complex-conditionals": "moods",
  "es-b2-remote-conditionals": "moods",
  "es-b2-nuanced-ser-estar": "pairs",
  // Spanish (B1 additions)
  "es-b1-futuro-simple": "tenses",
  "es-b1-pluperfect": "tenses",
  "es-b1-past-narration": "tenses",
  "es-b1-imperative-negative-pronouns": "moods",
  "es-b1-subjunctive-adverbial": "moods",
  "es-b1-reported-speech": "syntax",
  "es-b1-deber-obligation-probability": "pairs",
  "es-b1-aspectual-periphrases": "syntax",
  "es-b1-verb-preposition-regime": "syntax",
  "es-b1-discourse-connectors": "syntax",
  "es-b1-superlatives-comparisons": "syntax",
  "es-b1-que-vs-cual": "pairs",
  "es-b1-ser-estar-uses": "pairs",
  "es-b1-indirect-questions": "syntax",
  "es-b1-collective-agreement": "syntax",
  "es-b1-adjective-de-infinitive": "syntax",
  // Spanish (B2 additions)
  "es-b2-relative-clauses-advanced": "syntax",
  "es-b2-subjunctive-compound": "moods",
  "es-b2-subjunctive-negated-opinion": "moods",
  "es-b2-subjunctive-temporal-concessive": "moods",
  "es-b2-conditional-connectors": "moods",
  "es-b2-passive-voice": "syntax",
  "es-b2-verbs-of-change": "syntax",
  "es-b2-se-middle-accidental": "pronouns",
  "es-b2-clitic-advanced": "pronouns",
  "es-b2-gerund-participle-constructions": "syntax",
  "es-b2-consecutives-intensity": "syntax",
  "es-b2-sino-adversatives": "pairs",
  "es-b2-causal-connectors": "syntax",
  "es-b2-lo-nominalizer": "syntax",
  "es-b2-comparatives-advanced": "syntax",
  "es-b2-quantifiers-advanced": "syntax",
  "es-b2-cleft-sentences": "syntax",
  "es-b2-appreciative-suffixes": "morphology",
  "es-b2-aspectual-se": "pronouns",
  // German A1
  "de-a1-present-regular": "tenses",
  "de-a1-present-irregular": "tenses",
  "de-a1-noun-gender": "articles",
  "de-a1-plural-formation": "morphology",
  "de-a1-articles-nominative": "articles",
  "de-a1-accusative": "cases",
  "de-a1-dative": "cases",
  "de-a1-personal-pronouns": "pronouns",
  "de-a1-possessive-articles": "pronouns",
  "de-a1-questions": "syntax",
  "de-a1-v2-word-order": "syntax",
  "de-a1-negation": "syntax",
  "de-a1-zero-article": "articles",
  "de-a1-modal-verbs-present": "syntax",
  "de-a1-imperative": "moods",
  "de-a1-temporal-prepositions": "cases",
  "de-a1-es-gibt": "syntax",
  "de-a1-praeteritum-sein-haben": "tenses",
  "de-a1-numbers-ordinals": "morphology",
  // German A2
  "de-a2-perfekt-with-haben": "tenses",
  "de-a2-perfekt-with-sein": "tenses",
  "de-a2-past-participle-formation": "morphology",
  "de-a2-akkusativ-prepositions": "cases",
  "de-a2-dativ-prepositions": "cases",
  "de-a2-separable-prefix-verbs": "morphology",
  "de-a2-two-way-prepositions-core": "cases",
  "de-a2-adjective-declension-indefinite": "morphology",
  "de-a2-adjective-declension-definite": "morphology",
  "de-a2-adjective-declension-zero": "morphology",
  "de-a2-weil-deshalb": "syntax",
  "de-a2-dass-clauses": "syntax",
  "de-a2-wenn-als": "pairs",
  "de-a2-indirect-questions": "syntax",
  "de-a2-relative-clauses-nom-acc": "syntax",
  "de-a2-reflexive-verbs": "pronouns",
  "de-a2-praeteritum-modals": "tenses",
  "de-a2-konjunktiv-ii-polite": "moods",
  "de-a2-passive-present": "syntax",
  "de-a2-verb-preposition-complements": "syntax",
  "de-a2-comparison": "morphology",
  "de-a2-nicht-sondern": "pairs",
  "de-a2-indefinite-pronouns-basic": "pronouns",
  "de-a2-lassen": "syntax",
  "de-a2-destination-prepositions": "pairs",
  "de-a2-seit-present": "tenses",
  "de-a2-wissen-kennen": "pairs",
  "de-a2-demonstratives-welch": "pronouns",
  "de-a2-dative-accusative-objects": "syntax",
  "de-a2-measure-expressions": "syntax",
  "de-a2-quantifiers-other": "pronouns",
  // German B1
  "de-b1-praeteritum": "tenses",
  "de-b1-relative-pronouns": "syntax",
  "de-b1-dass-clause-perfekt": "syntax",
  "de-b1-two-way-prepositions": "pairs",
  "de-b1-passive-werden": "syntax",
  "de-b1-subordinate-conjunctions": "syntax",
  "de-b1-plusquamperfekt-nachdem": "tenses",
  "de-b1-futur-i": "tenses",
  "de-b1-konjunktiv-ii-past": "moods",
  "de-b1-zu-infinitive": "syntax",
  "de-b1-um-zu-damit": "syntax",
  "de-b1-statt-ohne-zu": "syntax",
  "de-b1-two-part-conjunctions": "syntax",
  "de-b1-genitive": "cases",
  "de-b1-n-declension": "morphology",
  "de-b1-adjectives-as-nouns": "morphology",
  "de-b1-participles-as-adjectives": "morphology",
  "de-b1-comparison-attributive": "morphology",
  "de-b1-reason-consequence-connectors": "syntax",
  "de-b1-es-expressions": "syntax",
  "de-b1-modal-particles-basic": "syntax",
  "de-b1-dative-reflexive-body": "pronouns",
  "de-b1-hin-her": "morphology",
  "de-b1-schon-noch-erst": "pairs",
  "de-b1-progressive-equivalents": "tenses",
  "de-b1-articles-use": "articles",
  "de-b1-adjective-case-government": "cases",
  // German B2
  "de-b2-konjunktiv-ii": "moods",
  "de-b2-genitive-prepositions": "cases",
  "de-b2-konjunktiv-i": "moods",
  "de-b2-extended-attributes": "syntax",
  "de-b2-nominalization": "syntax",
  "de-b2-zustandspassiv": "pairs",
  "de-b2-passive-alternatives": "syntax",
  "de-b2-subjective-modals": "moods",
  "de-b2-modal-perfect-word-order": "syntax",
  "de-b2-futur-ii": "tenses",
  "de-b2-causal-connectors": "syntax",
  "de-b2-temporal-connectors": "syntax",
  "de-b2-conditional-connectors": "syntax",
  "de-b2-concessive-connectors": "syntax",
  "de-b2-consecutive-connectors": "syntax",
  "de-b2-modal-connectors": "syntax",
  "de-b2-adversative-connectors": "syntax",
  "de-b2-dass-equivalents": "syntax",
  "de-b2-relatives-advanced": "syntax",
  "de-b2-noun-verb-collocations": "syntax",
  "de-b2-fixed-prepositions": "syntax",
  "de-b2-indefinite-pronouns": "pronouns",
  "de-b2-word-formation": "morphology",
  "de-b2-mittelfeld-word-order": "syntax",
  "de-b2-text-reference-words": "syntax",
  "de-b2-modal-particles-advanced": "syntax",
  "de-b2-verb-prefixes": "morphology",
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
  "tr-a1-clock-time-dates": "syntax",
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
  "tr-a2-adversative-connectors": "syntax",
  "tr-a2-ca-suffix": "morphology",
  "tr-a2-pekistirme": "morphology",
  "tr-a2-purpose-icin-uzere": "syntax",
  "tr-a2-reported-speech": "syntax",
  // Turkish A2 (audit additions)
  "tr-a2-spatial-postpositions": "syntax",
  "tr-a2-past-copula": "tenses",
  "tr-a2-clitics-da-bile": "syntax",
  "tr-a2-with-without-li-siz": "morphology",
  "tr-a2-enumerator-tane": "syntax",
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
  // Turkish B1 (audit additions)
  "tr-b1-copula-ol": "syntax",
  "tr-b1-olarak": "syntax",
  "tr-b1-abstract-postpositions": "syntax",
  "tr-b1-reason-digi-icin": "syntax",
  "tr-b1-when-converbs": "syntax",
  // Turkish B2
  "tr-b2-participle-aorist": "syntax",
  "tr-b2-participle-mis": "syntax",
  "tr-b2-converb-until": "syntax",
  "tr-b2-compound-past-hikaye": "tenses",
  "tr-b2-compound-evidential-rivayet": "tenses",
  "tr-b2-proportion-assoon": "syntax",
  "tr-b2-duration-throughout": "syntax",
  "tr-b2-reported-statements": "syntax",
  "tr-b2-reported-questions": "syntax",
  "tr-b2-reported-directives": "syntax",
  "tr-b2-double-voice": "morphology",
  "tr-b2-concessive": "syntax",
  "tr-b2-instead-of": "syntax",
  "tr-b2-conditional-formal": "moods",
  "tr-b2-aspectual-verbs": "syntax",
  "tr-b2-dir-generalizing": "moods",
  "tr-b2-as-if-gibi": "syntax",
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
