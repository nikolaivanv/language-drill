import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before importing the SUT.
// ---------------------------------------------------------------------------
//
// `pipeline.ts` issues two parallel Drizzle queries:
//   1. profile lookup → `.where(...).limit(1)` (awaited array)
//   2. vocab lookup   → `.where(...)` (awaited thenable, no `.limit()`)
//
// We mock `../db` so each `.from(table)` branch returns a chain shaped for
// that table specifically — profile chains end in `.limit()`, vocab chains
// are `.where()`-thenable.
//
// `@language-drill/ai`'s `loadFrequency` is mocked per-suite so each test
// fully controls the dictionary + stopword behaviour.

// `vi.mock` factories are hoisted above all top-level code; they cannot
// close over module-scoped variables. We use string tags inside the mocked
// `@language-drill/db` export and dispatch on them in the `../db` mock.

vi.mock("@language-drill/db", () => ({
  userLanguageProfiles: { __mock: "userLanguageProfiles" },
  userVocabulary: { __mock: "userVocabulary" },
  users: { id: "id" },
}));

const { mockProfileLimit, mockVocabResolver } = vi.hoisted(() => ({
  mockProfileLimit: vi.fn(),
  mockVocabResolver: vi.fn(),
}));

vi.mock("../db", () => {
  const profileWhere = () => ({ limit: mockProfileLimit });
  const profileFrom = () => ({ where: profileWhere });

  const vocabWhere = () => ({
    catch(handler: (err: unknown) => unknown) {
      return Promise.resolve(mockVocabResolver()).catch(handler);
    },
    then(
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) {
      return Promise.resolve(mockVocabResolver()).then(resolve, reject);
    },
  });
  const vocabFrom = () => ({ where: vocabWhere });

  return {
    db: {
      select: () => ({
        from(table: { __mock?: string }) {
          if (table?.__mock === "userLanguageProfiles") return profileFrom();
          if (table?.__mock === "userVocabulary") return vocabFrom();
          throw new Error("Unexpected table in pipeline.test mock");
        },
      }),
    },
  };
});

// `drizzle-orm` is a real dep but `and`/`eq` only need to be callable; the
// mocked `.where()` ignores its argument.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));

const { mockFreqLookup, mockIsStopword } = vi.hoisted(() => ({
  mockFreqLookup: vi.fn<(form: string) => unknown>(),
  mockIsStopword: vi.fn<(form: string) => boolean>(),
}));

vi.mock("@language-drill/ai", () => ({
  loadFrequency: () => ({
    lookup: (form: string) => mockFreqLookup(form),
    isStopword: (form: string) => mockIsStopword(form),
  }),
}));

import { Language, CefrLevel } from "@language-drill/shared";
import { buildCandidateList } from "./pipeline";

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockProfileLimit.mockReset();
  mockVocabResolver.mockReset();
  mockFreqLookup.mockReset();
  mockIsStopword.mockReset();

  // Default frequency: every word is unknown (returns null), no stopwords.
  mockFreqLookup.mockImplementation(() => null);
  mockIsStopword.mockImplementation(() => false);

  // Default DB: B1 user with empty vocab.
  mockProfileLimit.mockResolvedValue([{ proficiencyLevel: "B1" }]);
  mockVocabResolver.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const BASE_INPUT = {
  userId: "user_123",
  language: Language.ES,
  text: "",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freqFor(map: Record<string, number>) {
  // Returns a lookup that finds known entries by surface form (lemma === form).
  return (form: string) =>
    map[form] !== undefined
      ? { lemma: form, rank: map[form] }
      : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCandidateList — basic pre-filter behaviour", () => {
  it("(a) drops known low-rank words + stopwords + words in vocab; keeps one rare word", async () => {
    // Passage tokens: la(stopword), casa(common), pintor(common), aldea(rare), ya(in-vocab).
    mockFreqLookup.mockImplementation(
      freqFor({
        casa: 200, // <= B1 topRank (3000)
        pintor: 1500,
        aldea: 4200,
        ya: 100,
      }),
    );
    mockIsStopword.mockImplementation((f) =>
      new Set(["la", "del", "en"]).has(f),
    );
    mockVocabResolver.mockResolvedValueOnce([{ word: "ya", lemma: "ya" }]);

    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: "La casa del pintor en la aldea ya",
    });

    expect(result.calibration).toEqual({ cefr: CefrLevel.B1, top: 3000 });
    expect(result.candidates).toEqual([
      { matchedForm: "aldea", lemma: "aldea" },
    ]);
  });

  it("(b) all words below topRank → empty candidates", async () => {
    mockFreqLookup.mockImplementation(freqFor({ casa: 200, pintor: 1500 }));
    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: "casa pintor casa pintor",
    });

    expect(result.candidates).toEqual([]);
    expect(result.calibration).toEqual({ cefr: CefrLevel.B1, top: 3000 });
  });

  it("(c) all candidates land in vocab → empty candidates", async () => {
    mockFreqLookup.mockImplementation(freqFor({ aldea: 4200, indiferencia: 5800 }));
    mockVocabResolver.mockResolvedValueOnce([
      { word: "aldea", lemma: "aldea" },
      { word: "indiferencia", lemma: "indiferencia" },
    ]);

    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: "aldea indiferencia",
    });

    expect(result.candidates).toEqual([]);
  });

  it("(d) duplicate surface forms in text → deduped (first-seen wins)", async () => {
    mockFreqLookup.mockImplementation(freqFor({ aldea: 4200 }));

    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: "aldea aldea aldea",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].matchedForm).toBe("aldea");
  });
});

describe("buildCandidateList — graceful vocab failure (task 23b)", () => {
  it("(e) vocab query throws → empty vocab list, candidates pass through, error logged", async () => {
    mockFreqLookup.mockImplementation(freqFor({ aldea: 4200 }));
    mockVocabResolver.mockRejectedValueOnce(new Error("Neon connection reset"));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: "aldea",
    });

    expect(result.candidates).toEqual([
      { matchedForm: "aldea", lemma: "aldea" },
    ]);
    expect(errSpy).toHaveBeenCalledWith(
      "[annotate-stream] vocab query failed",
      expect.any(Error),
    );

    errSpy.mockRestore();
  });
});

describe("buildCandidateList — determinism (Req 1.7)", () => {
  it("(f) identical input yields identical candidate order across calls", async () => {
    mockFreqLookup.mockImplementation(
      freqFor({ aldea: 4200, indiferencia: 5800, vapor: 7000 }),
    );

    const a = await buildCandidateList({
      ...BASE_INPUT,
      text: "aldea indiferencia vapor",
    });
    const b = await buildCandidateList({
      ...BASE_INPUT,
      text: "aldea indiferencia vapor",
    });

    expect(a.candidates).toEqual(b.candidates);
  });
});

describe("buildCandidateList — A1 worst case cap (Req 2.4, 2.7)", () => {
  it("(g) 60 above-topRank words → exactly 20 returned, the 20 rarest; known-rare ranks ahead of unknowns", async () => {
    // Build 50 known words with ranks well above A1's topRank (750), AND 10
    // unknown-to-corpus words. The known set ranks from 1000 to 5900 (step 100).
    const KNOWN = Array.from({ length: 50 }, (_, i) => ({
      form: `known${i}`,
      rank: 1000 + i * 100,
    }));
    const UNKNOWN = Array.from({ length: 10 }, (_, i) => `unknown${i}`);

    const rankMap = Object.fromEntries(KNOWN.map((k) => [k.form, k.rank]));
    mockFreqLookup.mockImplementation(freqFor(rankMap));
    // Switch user to A1 so topRank = 750.
    mockProfileLimit.mockResolvedValueOnce([{ proficiencyLevel: "A1" }]);

    const text = [...KNOWN.map((k) => k.form), ...UNKNOWN].join(" ");
    const result = await buildCandidateList({ ...BASE_INPUT, text });

    expect(result.calibration).toEqual({ cefr: CefrLevel.A1, top: 750 });
    // CANDIDATE_LIMIT was lowered from 40 to 20 (PR #100) — the original
    // 40-cap fit the model's `max_tokens` budget but ran past the 29 s
    // Lambda wall-clock ceiling on Sonnet. 20 keeps the most pedagogically
    // useful (rarest) candidates while leaving comfortable wall-clock
    // headroom even on Haiku.
    expect(result.candidates).toHaveLength(20);

    // Top-20 by rarity. The 20 rarest of the 50 known words have ranks
    // 4000..5900 (i.e. indices 30..49 in KNOWN, sorted descending by rank).
    const expectedRarestForms = KNOWN.slice(30) // ranks 4000..5900
      .map((k) => k.form)
      .reverse(); // rarest (5900) first
    expect(result.candidates.map((c) => c.matchedForm)).toEqual(
      expectedRarestForms,
    );

    // Sanity: no unknown made it in, because the 10 demoted-to-`topRank+1`
    // unknowns rank behind every selected known-rare word.
    for (const u of UNKNOWN) {
      expect(result.candidates.find((c) => c.matchedForm === u)).toBeUndefined();
    }
  });

  it("(h) all-unknown corpus → still capped at 20 by first-seen order; no crash", async () => {
    // 50 unknown-to-corpus forms, no known-rare alternatives.
    const forms = Array.from({ length: 50 }, (_, i) => `mystery${i}`);
    mockFreqLookup.mockImplementation(() => null);

    const result = await buildCandidateList({
      ...BASE_INPUT,
      text: forms.join(" "),
    });

    expect(result.candidates).toHaveLength(20);
    // First-seen order is preserved since every survivor has the same
    // effectiveRank (topRank + 1) and Array.sort is stable.
    expect(result.candidates.map((c) => c.matchedForm)).toEqual(
      forms.slice(0, 20),
    );
    // Every entry has lemma === null because they're unknown.
    expect(result.candidates.every((c) => c.lemma === null)).toBe(true);
  });
});
