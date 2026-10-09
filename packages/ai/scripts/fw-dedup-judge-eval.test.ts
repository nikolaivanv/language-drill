import { describe, expect, it } from "vitest";

import { buildGroundTruth, confirmedDuplicateIds, judgePasses, scoreJudge, type JudgeCase } from "./fw-dedup-judge-eval";

describe("buildGroundTruth", () => {
  it("labels rows in multi-row clusters as duplicates and singletons as distinct", () => {
    expect(
      buildGroundTruth({
        language: "ES",
        level: "A1",
        cell: "es-a1-fw-x",
        clusters: [
          { angle: "a", keep: "k1", demote: ["d1", "d2"] },
          { angle: "b", keep: "k2", demote: [] },
        ],
      }),
    ).toEqual([
      { id: "k1", cluster: 0, isDuplicate: true },
      { id: "d1", cluster: 0, isDuplicate: true },
      { id: "d2", cluster: 0, isDuplicate: true },
      { id: "k2", cluster: 1, isDuplicate: false },
    ]);
  });
});

describe("scoreJudge", () => {
  const c = (truth: boolean, predicted: boolean): JudgeCase => ({ cell: "x", id: "i", truth, predicted, reason: "" });

  it("computes precision and recall", () => {
    const s = scoreJudge([c(true, true), c(true, true), c(true, false), c(false, true), c(false, false)]);
    expect(s).toEqual({ tp: 2, fp: 1, fn: 1, tn: 1, precision: 2 / 3, recall: 2 / 3 });
  });

  it("scores precision 0 when nothing is predicted positive (fails the bar)", () => {
    expect(scoreJudge([c(true, false)]).precision).toBe(0);
  });

  it("scores recall 1 when there are no true positives to find", () => {
    expect(scoreJudge([c(false, false)]).recall).toBe(1);
  });
});

describe("judgePasses", () => {
  it("requires precision >= 0.9 and recall >= 0.8", () => {
    const base = { tp: 0, fp: 0, fn: 0, tn: 0 };
    expect(judgePasses({ ...base, precision: 0.9, recall: 0.8 })).toBe(true);
    expect(judgePasses({ ...base, precision: 0.89, recall: 1 })).toBe(false);
    expect(judgePasses({ ...base, precision: 1, recall: 0.79 })).toBe(false);
  });
});

describe("confirmedDuplicateIds", () => {
  it("returns the row ids hand-confirmed as duplicates, ignoring overturned ones", () => {
    const ids = confirmedDuplicateIds({
      confirmedDuplicates: [{ rowId: "a" }, { rowId: "b" }],
      overturned: [{ rowId: "c" }],
    });
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("tolerates a missing or malformed amendments object", () => {
    expect(confirmedDuplicateIds(null).size).toBe(0);
    expect(confirmedDuplicateIds({ confirmedDuplicates: "x" }).size).toBe(0);
    expect(confirmedDuplicateIds({ confirmedDuplicates: [{ rowId: 7 }, {}] }).size).toBe(0);
  });
});
