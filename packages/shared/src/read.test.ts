import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  WordFlagSchema,
  FlaggedMapSchema,
  READ_TEXT_MAX_CHARS,
  READ_CEFR_TOP_RANK,
} from "./index";
import type { WordFlag } from "./index";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const validFlag: WordFlag = {
  lemma: "aldea",
  pos: "f. noun",
  gloss: "small village, hamlet",
  example: "una aldea de pescadores — a fishing village",
  freq: 5630,
  cefr: CefrLevel.B2,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("READ_TEXT_MAX_CHARS", () => {
  it("is exactly 2000", () => {
    expect(READ_TEXT_MAX_CHARS).toBe(2000);
  });
});

describe("READ_CEFR_TOP_RANK", () => {
  it("is monotonic A1 → C2", () => {
    expect(READ_CEFR_TOP_RANK[CefrLevel.A1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.A2]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.A2]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.B1]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.B1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.B2]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.B2]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.C1]);
    expect(READ_CEFR_TOP_RANK[CefrLevel.C1]).toBeLessThan(READ_CEFR_TOP_RANK[CefrLevel.C2]);
  });

  it("covers every CefrLevel", () => {
    expect(Object.keys(READ_CEFR_TOP_RANK)).toEqual(Object.values(CefrLevel));
  });
});

// ---------------------------------------------------------------------------
// WordFlagSchema
// ---------------------------------------------------------------------------

describe("WordFlagSchema", () => {
  it("rejects an empty object", () => {
    expect(WordFlagSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid WordFlag", () => {
    const result = WordFlagSchema.safeParse(validFlag);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFlag);
    }
  });

  it("rejects an empty `lemma` string", () => {
    const bad = { ...validFlag, lemma: "" };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a negative `freq`", () => {
    const bad = { ...validFlag, freq: -1 };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-CEFR `cefr` value", () => {
    const bad: Record<string, unknown> = { ...validFlag, cefr: "Z9" };
    expect(WordFlagSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FlaggedMapSchema
// ---------------------------------------------------------------------------

describe("FlaggedMapSchema", () => {
  it("round-trips a single-entry map", () => {
    const input = { aldea: validFlag };
    const result = FlaggedMapSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aldea).toEqual(validFlag);
    }
  });

  it("rejects an empty key", () => {
    const input = { "": validFlag };
    expect(FlaggedMapSchema.safeParse(input).success).toBe(false);
  });

  it("accepts an empty map", () => {
    expect(FlaggedMapSchema.parse({})).toEqual({});
  });
});
