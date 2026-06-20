import { describe, it, expect } from "vitest";
import { CefrLevel, Language, type LearningLanguage } from "@language-drill/shared";

import {
  assertFrequencyFile,
  assertStopwordList,
  cefrRankWindow,
  loadFrequency,
} from "./index";

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

