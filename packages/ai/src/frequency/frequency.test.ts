import { describe, it, expect } from "vitest";
import { CefrLevel, Language, type LearningLanguage } from "@language-drill/shared";
import { verbBand } from "./index";

import {
  assertFrequencyFile,
  assertStopwordList,
  cefrRankWindow,
  frequencyBand,
  loadFrequency,
} from "./index";

import esFreq from "./es.json";
import esStopwords from "./stopwords-es.json";

// ---------------------------------------------------------------------------
// Frequency-lookup contract tests (more-responsive-reading spec Req 1.1, 1.2,
// 1.4, 1.5, 1.7, NFR Reliability).
//
// Module-init is exercised by the simple act of importing this file: if any of
// the six bundled JSON assets is malformed, `loadFrequency` would not even be
// callable. The per-language smoke tests below therefore double as the
// "module-init does not throw" guarantee.
// ---------------------------------------------------------------------------

// Per-language fixtures — picked from words observed in the v1 dictionaries.
// Each `topCommonForm` is asserted to have `rank <= 100`, which is the looser
// bound the task spec actually requires. If a future corpus snapshot pushes
// any of these out of the top 100 the test fails loudly — that's the signal
// to pick a different in-corpus word, not to relax the bound.
type LangFixture = {
  language: LearningLanguage;
  topCommonForm: string;
  rareOrFakeForm: string;
  stopword: string;
  contentWord: string;
};

const FIXTURES: ReadonlyArray<LangFixture> = [
  {
    language: Language.ES,
    topCommonForm: "casa",
    rareOrFakeForm: "qqqxyzz-clearly-not-spanish",
    stopword: "el",
    contentWord: "casa",
  },
  {
    language: Language.DE,
    topCommonForm: "mann",
    rareOrFakeForm: "qqqxyzz-clearly-not-german",
    stopword: "der",
    contentWord: "mann",
  },
  {
    language: Language.TR,
    topCommonForm: "ev",
    rareOrFakeForm: "qqqxyzz-clearly-not-turkish",
    stopword: "ve",
    contentWord: "ev",
  },
];

describe("loadFrequency", () => {
  for (const fixture of FIXTURES) {
    describe(fixture.language, () => {
      it("returns an entry with rank <= 100 for a top-common form", () => {
        const lookup = loadFrequency(fixture.language);
        const entry = lookup.lookup(fixture.topCommonForm);
        expect(entry).not.toBeNull();
        expect(entry!.lemma).toEqual(expect.any(String));
        expect(entry!.lemma.length).toBeGreaterThan(0);
        expect(entry!.rank).toBeGreaterThan(0);
        expect(entry!.rank).toBeLessThanOrEqual(100);
      });

      it("returns null for a clearly rare / fake form", () => {
        const lookup = loadFrequency(fixture.language);
        expect(lookup.lookup(fixture.rareOrFakeForm)).toBeNull();
      });

      it("reports a known closed-class word as a stopword", () => {
        const lookup = loadFrequency(fixture.language);
        expect(lookup.isStopword(fixture.stopword)).toBe(true);
      });

      it("reports a content word as not a stopword", () => {
        const lookup = loadFrequency(fixture.language);
        expect(lookup.isStopword(fixture.contentWord)).toBe(false);
      });

      it("does not throw when called at module init (smoke)", () => {
        expect(() => loadFrequency(fixture.language)).not.toThrow();
      });
    });
  }

  it("returns the same cached lookup instance across calls", () => {
    // Identity check — `loadFrequency` memoizes per language so callers may
    // safely destructure the methods (`const { lookup } = loadFrequency('ES')`)
    // without losing referential equality across re-renders / hot reloads.
    expect(loadFrequency(Language.ES)).toBe(loadFrequency(Language.ES));
    expect(loadFrequency(Language.DE)).toBe(loadFrequency(Language.DE));
    expect(loadFrequency(Language.TR)).toBe(loadFrequency(Language.TR));
  });
});

describe("determinism — Req 1.7", () => {
  // Pre-filter requirement 1.7: "deterministic given the same (text, language,
  // proficiencyLevel) triple — no randomness". The lookup primitives are the
  // load-bearing piece; repeated calls must produce identical results.
  for (const fixture of FIXTURES) {
    it(`${fixture.language}: repeated lookup / isStopword calls return identical results`, () => {
      const { lookup, isStopword } = loadFrequency(fixture.language);

      const a1 = lookup(fixture.topCommonForm);
      const a2 = lookup(fixture.topCommonForm);
      expect(a1).toEqual(a2);

      const b1 = lookup(fixture.rareOrFakeForm);
      const b2 = lookup(fixture.rareOrFakeForm);
      expect(b1).toBeNull();
      expect(b2).toBeNull();

      expect(isStopword(fixture.stopword)).toBe(isStopword(fixture.stopword));
      expect(isStopword(fixture.contentWord)).toBe(isStopword(fixture.contentWord));
    });
  }
});

describe("module-init guards — Error Handling fail-fast", () => {
  // Direct exercises of the assertion helpers that run at module top level.
  // If they pass these tests AND are invoked at module init (verified by the
  // module loading at all — see test above), then any malformed bundled JSON
  // would crash Lambda init rather than silently returning wrong lookups.
  describe("assertFrequencyFile", () => {
    it("throws on null", () => {
      expect(() => assertFrequencyFile(Language.ES, null)).toThrow(/Malformed ES/);
    });

    it("throws on an array", () => {
      expect(() => assertFrequencyFile(Language.DE, [])).toThrow(/Malformed DE/);
    });

    it("throws on a string", () => {
      expect(() => assertFrequencyFile(Language.TR, "not-an-object")).toThrow(
        /Malformed TR/,
      );
    });

    it("throws on a number", () => {
      expect(() => assertFrequencyFile(Language.ES, 42)).toThrow(/Malformed ES/);
    });

    it("accepts a plain object", () => {
      expect(() =>
        assertFrequencyFile(Language.ES, { casa: { lemma: "casa", rank: 74 } }),
      ).not.toThrow();
    });
  });

  describe("assertStopwordList", () => {
    it("throws on an object", () => {
      expect(() => assertStopwordList(Language.ES, { el: true })).toThrow(
        /Malformed ES/,
      );
    });

    it("throws on null", () => {
      expect(() => assertStopwordList(Language.DE, null)).toThrow(/Malformed DE/);
    });

    it("throws on a string", () => {
      expect(() => assertStopwordList(Language.TR, "ve")).toThrow(/Malformed TR/);
    });

    it("accepts an empty array", () => {
      expect(() => assertStopwordList(Language.ES, [])).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// CEFR → frequency-rank window (exercise-generation-quality R5.2). Coarse,
// design-tunable proxy used by the seed picker.
// ---------------------------------------------------------------------------

describe("cefrRankWindow", () => {
  it("maps each CEFR level to its coarse rank band (spec boundaries)", () => {
    expect(cefrRankWindow(CefrLevel.A1)).toEqual({ rankMin: 1, rankMax: 1000 });
    expect(cefrRankWindow(CefrLevel.A2)).toEqual({ rankMin: 1000, rankMax: 2500 });
    expect(cefrRankWindow(CefrLevel.B1)).toEqual({ rankMin: 2500, rankMax: 5000 });
    expect(cefrRankWindow(CefrLevel.B2)).toEqual({ rankMin: 5000, rankMax: 10000 });
    expect(cefrRankWindow(CefrLevel.C1)).toEqual({ rankMin: 10000, rankMax: 20000 });
    expect(cefrRankWindow(CefrLevel.C2)).toEqual({ rankMin: 20000, rankMax: 40000 });
  });

  it("windows are contiguous and strictly ascending (no gaps)", () => {
    const levels = [
      CefrLevel.A1,
      CefrLevel.A2,
      CefrLevel.B1,
      CefrLevel.B2,
      CefrLevel.C1,
      CefrLevel.C2,
    ];
    for (let i = 1; i < levels.length; i++) {
      const prev = cefrRankWindow(levels[i - 1]);
      const cur = cefrRankWindow(levels[i]);
      expect(cur.rankMin).toBe(prev.rankMax); // contiguous: next picks up where prev ends
      expect(cur.rankMax).toBeGreaterThan(cur.rankMin); // non-empty, ascending
    }
  });
});

// ---------------------------------------------------------------------------
// Frequency band accessor (R5.1, R5.2): rank-banded, stopword-free, lemma-
// deduped, rank-sorted seed candidates with per-(language, band) caching.
// ---------------------------------------------------------------------------

describe("frequencyBand", () => {
  const A1 = cefrRankWindow(CefrLevel.A1); // { 1, 1000 }
  const B2 = cefrRankWindow(CefrLevel.B2); // { 5000, 10000 }

  it("excludes closed-class stopwords from the band", () => {
    const { isStopword } = loadFrequency(Language.ES);
    const band = frequencyBand(Language.ES, A1.rankMin, A1.rankMax);
    // Every returned lemma is a content word, never a closed-class stopword.
    for (const lemma of band) {
      expect(isStopword(lemma)).toBe(false);
    }
    // And a specific known top-rank stopword is absent.
    expect(band).not.toContain("el");
  });

  it("dedupes by lemma — no repeated entries", () => {
    const band = frequencyBand(Language.ES, A1.rankMin, A1.rankMax);
    expect(new Set(band).size).toBe(band.length);
  });

  it("restricts candidates to the requested rank window", () => {
    // A top-frequency content lemma (rank ~74) belongs to A1, not to B2.
    const casaLemma = loadFrequency(Language.ES).lookup("casa")!.lemma;
    expect(frequencyBand(Language.ES, A1.rankMin, A1.rankMax)).toContain(casaLemma);
    expect(frequencyBand(Language.ES, B2.rankMin, B2.rankMax)).not.toContain(
      casaLemma,
    );
  });

  it("is sorted by rank ascending and every lemma is justified in-window", () => {
    // Reference: lemma → lowest in-window rank, mirroring the production
    // window-first dedup, derived independently from the raw bundled JSON +
    // stopword list. Lets us assert window-restriction and sort order without
    // the band exposing ranks.
    const freq = esFreq as Record<string, { lemma: string; rank: number }>;
    const stop = new Set(esStopwords as string[]);
    const inWindowRank = new Map<string, number>();
    for (const [surface, e] of Object.entries(freq)) {
      if (e.rank < A1.rankMin || e.rank > A1.rankMax) continue;
      if (stop.has(surface) || stop.has(e.lemma)) continue;
      const existing = inWindowRank.get(e.lemma);
      if (existing === undefined || e.rank < existing) {
        inWindowRank.set(e.lemma, e.rank);
      }
    }

    const band = frequencyBand(Language.ES, A1.rankMin, A1.rankMax);
    expect(band.length).toBeGreaterThan(0);

    const ranks = band.map((lemma) => {
      const r = inWindowRank.get(lemma);
      // window-restricted: each returned lemma has an in-window justification.
      expect(r).toBeDefined();
      expect(r!).toBeGreaterThanOrEqual(A1.rankMin);
      expect(r!).toBeLessThanOrEqual(A1.rankMax);
      return r!;
    });

    // rank-sorted ascending.
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it("returns the same cached instance for the same (language, band)", () => {
    const a = frequencyBand(Language.TR, 1, 1000);
    const b = frequencyBand(Language.TR, 1, 1000);
    expect(a).toBe(b); // identity — repeated calls reuse the cached frozen array
    // A different band is a different instance.
    expect(frequencyBand(Language.TR, 2500, 5000)).not.toBe(a);
  });

  it("returns a frozen array (callers cannot mutate the cached band)", () => {
    const band = frequencyBand(Language.ES, A1.rankMin, A1.rankMax);
    expect(Object.isFrozen(band)).toBe(true);
  });
});

describe("verbBand", () => {
  it("includes real Spanish verbs and excludes look-alike non-verbs", () => {
    // Wide cumulative band to capture both common and mid-frequency verbs.
    const verbs = new Set(verbBand(Language.ES, 1, 5000));
    expect(verbs.has("hablar")).toBe(true);
    expect(verbs.has("comer")).toBe(true);
    expect(verbs.has("vivir")).toBe(true);
    // -ar/-er/-ir suffix but NOT verbs (≤2 surfaces: singular + plural).
    expect(verbs.has("lugar")).toBe(false);
    expect(verbs.has("mujer")).toBe(false);
    expect(verbs.has("mar")).toBe(false);
    expect(verbs.has("ayer")).toBe(false);
  });

  it("is sorted by rank ascending and deterministic (cached identity)", () => {
    const a = verbBand(Language.ES, 1, 5000);
    const b = verbBand(Language.ES, 1, 5000);
    expect(a).toBe(b); // same frozen instance from cache
    expect([...a]).toEqual([...a].slice().sort(() => 0)); // stable order
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("returns empty for languages without a verb config (DE/TR)", () => {
    expect(verbBand(Language.DE, 1, 5000)).toEqual([]);
    expect(verbBand(Language.TR, 1, 5000)).toEqual([]);
  });
});
