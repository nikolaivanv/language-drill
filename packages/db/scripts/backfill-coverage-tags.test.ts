import { describe, expect, it } from "vitest";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";

import {
  parseBackfillArgs,
  reconstructForValidation,
  type CandidateRow,
} from "./backfill-coverage-tags";

// ---------------------------------------------------------------------------
// parseBackfillArgs
// ---------------------------------------------------------------------------

describe("parseBackfillArgs", () => {
  it("defaults to dry-run", () => {
    const a = parseBackfillArgs([]);
    expect(a.apply).toBe(false);
    expect(a.language).toBeNull();
    expect(a.cefrLevel).toBeNull();
    expect(a.limit).toBeNull();
  });

  it("parses flags", () => {
    const a = parseBackfillArgs([
      "--apply",
      "--language",
      "TR",
      "--cefr",
      "A1",
      "--limit",
      "50",
      "--concurrency",
      "8",
      "--max-cost-usd",
      "3",
    ]);
    expect(a.apply).toBe(true);
    expect(a.language).toBe(Language.TR);
    expect(a.cefrLevel).toBe(CefrLevel.A1);
    expect(a.limit).toBe(50);
    expect(a.concurrency).toBe(8);
    expect(a.maxCostUsd).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// reconstructForValidation
// ---------------------------------------------------------------------------

/** Minimal valid TR/A1/cloze row for tr-a1-personal-suffixes */
function makeValidRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    type: "cloze",
    language: "TR",
    difficulty: "A1",
    contentJson: {
      type: "cloze",
      instructions: "Fill in the blank.",
      sentence: "Ben öğretmen___.",
      correctAnswer: "im",
    },
    grammarPointKey: "tr-a1-personal-suffixes",
    topicDomain: null,
    modelId: "claude-sonnet-4-6",
    ...overrides,
  };
}

describe("reconstructForValidation", () => {
  it("returns {ok:false} when grammarPointKey is null", () => {
    const rec = reconstructForValidation(makeValidRow({ grammarPointKey: null }));
    expect(rec.ok).toBe(false);
  });

  it("returns {ok:false} when grammarPointKey is an empty string (falsy)", () => {
    const rec = reconstructForValidation(makeValidRow({ grammarPointKey: "" }));
    expect(rec.ok).toBe(false);
  });

  it("returns {ok:false} for an unknown grammar point key", () => {
    const rec = reconstructForValidation(
      makeValidRow({ grammarPointKey: "does-not-exist" }),
    );
    expect(rec.ok).toBe(false);
    if (!rec.ok) {
      expect(rec.reason).toMatch(/unknown grammar point/i);
    }
  });

  it("returns {ok:false} for language EN", () => {
    const rec = reconstructForValidation(makeValidRow({ language: "EN" }));
    expect(rec.ok).toBe(false);
    if (!rec.ok) {
      expect(rec.reason).toMatch(/EN/);
    }
  });

  it("returns {ok:false} for an invalid difficulty", () => {
    const rec = reconstructForValidation(makeValidRow({ difficulty: "Z9" }));
    expect(rec.ok).toBe(false);
    if (!rec.ok) {
      expect(rec.reason).toMatch(/invalid difficulty/i);
    }
  });

  it("returns {ok:false} for contentJson: null", () => {
    const rec = reconstructForValidation(makeValidRow({ contentJson: null }));
    expect(rec.ok).toBe(false);
    if (!rec.ok) {
      expect(rec.reason).toMatch(/malformed content_json/i);
    }
  });

  it("returns {ok:false} for contentJson with an unknown type", () => {
    const rec = reconstructForValidation(
      makeValidRow({ contentJson: { type: "bogus" } }),
    );
    expect(rec.ok).toBe(false);
    if (!rec.ok) {
      expect(rec.reason).toMatch(/malformed content_json/i);
    }
  });

  it("returns {ok:true} with correct draft/spec/cell for a valid TR/A1/cloze row", () => {
    const row = makeValidRow();
    const rec = reconstructForValidation(row);

    expect(rec.ok).toBe(true);
    if (!rec.ok) return; // narrow type

    // cell shape
    expect(rec.cell.exerciseType).toBe(ExerciseType.CLOZE);
    expect(rec.cell.grammarPoint.key).toBe("tr-a1-personal-suffixes");
    expect(rec.cell.language).toBe(Language.TR);
    expect(rec.cell.cefrLevel).toBe(CefrLevel.A1);

    // spec mirrors row fields
    expect(rec.spec.grammarPoint.key).toBe("tr-a1-personal-suffixes");
    expect(rec.spec.language).toBe(Language.TR);
    expect(rec.spec.cefrLevel).toBe(CefrLevel.A1);
    expect(rec.spec.exerciseType).toBe(ExerciseType.CLOZE);

    // draft preserves the content and id
    expect(rec.draft.id).toBe(row.id);
    expect(rec.draft.metadata.grammarPointKey).toBe("tr-a1-personal-suffixes");
    // metadata tokens are zeroed out for backfill
    expect(rec.draft.metadata.inputTokens).toBe(0);
    expect(rec.draft.metadata.inBatchDuplicate).toBe(false);
  });
});
