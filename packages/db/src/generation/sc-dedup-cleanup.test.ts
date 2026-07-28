import { describe, it, expect } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import { groupSentenceConstructionDuplicates } from "./sc-dedup-cleanup";

function row(overrides: Partial<Parameters<typeof groupSentenceConstructionDuplicates>[0][number]>) {
  return {
    id: "id",
    language: "ES",
    difficulty: "B1",
    grammarPointKey: "es-b1-conditional",
    reviewStatus: "auto-approved",
    qualityScore: 0.9,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    contentJson: {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "x",
      promptMode: "grammar_target",
      prompt: "any",
      modelAnswers: ["Iría a la playa.", "b"],
    },
    ...overrides,
  };
}

describe("groupSentenceConstructionDuplicates", () => {
  it("keeps one per answer-collision group and demotes the rest", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "a", qualityScore: 0.8 }),
      row({ id: "b", qualityScore: 0.95 }), // highest quality → survivor
      row({ id: "c", qualityScore: 0.7 }),
    ]);
    expect(plan.toDemote.sort()).toEqual(["a", "c"]);
  });

  it("does not group across different cells or different primary answers", () => {
    const plan = groupSentenceConstructionDuplicates([
      // a: default cell + default answer ("Iría a la playa.") — its own group.
      row({ id: "a" }),
      // b: different grammarPointKey → different cell → its own group.
      row({ id: "b", grammarPointKey: "es-b1-present-subjunctive" }),
      // c: same cell as a, but a different primary answer → its own group.
      row({
        id: "c",
        contentJson: {
          type: ExerciseType.SENTENCE_CONSTRUCTION,
          instructions: "x",
          promptMode: "grammar_target",
          prompt: "p",
          modelAnswers: ["Comería fruta.", "b"],
        },
      }),
    ]);
    expect(plan.toDemote).toEqual([]);
  });

  it("prefers an approved row over a flagged one as survivor", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "flagged", reviewStatus: "flagged", qualityScore: 0.99 }),
      row({ id: "approved", reviewStatus: "auto-approved", qualityScore: 0.5 }),
    ]);
    expect(plan.toDemote).toEqual(["flagged"]);
  });

  it("backfills survivor _dedupKey to the recomputed answer key", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({
        id: "s",
        contentJson: {
          type: ExerciseType.SENTENCE_CONSTRUCTION,
          instructions: "x",
          promptMode: "grammar_target",
          prompt: "p",
          modelAnswers: ["Iría a la playa.", "b"],
          _dedupKey: "stale-prompt-key",
        },
      }),
    ]);
    expect(plan.toBackfill).toEqual([{ id: "s", newKey: "iria a la playa." }]);
  });

  it("skips a row whose contentJson makes canonicalSurface throw, instead of crashing", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "good" }),
      row({
        id: "bad",
        // Legacy/corrupt row: `modelAnswers` missing entirely. canonicalSurface's
        // `content.modelAnswers[0]` access throws a TypeError for this shape —
        // the sweep must skip it, not crash.
        contentJson: {
          type: ExerciseType.SENTENCE_CONSTRUCTION,
          instructions: "x",
          promptMode: "grammar_target",
          prompt: "p",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    ]);
    expect(plan.skipped).toEqual(["bad"]);
    expect(plan.toDemote).not.toContain("bad");
    expect(plan.toBackfill.map((b) => b.id)).not.toContain("bad");
  });
});
