import { describe, it, expect } from "vitest";
import { samplePerPoint, mulberry32, type PoolRow } from "./qa-sample-run.js";

function row(id: string, gp: string): PoolRow {
  return { id, type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: gp, contentJson: {} };
}

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("samplePerPoint", () => {
  const rows: PoolRow[] = [
    row("a1", "gp-1"), row("a2", "gp-1"), row("a3", "gp-1"),
    row("b1", "gp-2"), row("b2", "gp-2"),
    row("c1", "gp-3"),
  ];

  it("takes at most `perPoint` per grammar point", () => {
    const out = samplePerPoint(rows, 2, 7);
    const byGp = new Map<string, number>();
    for (const r of out) byGp.set(r.grammarPointKey!, (byGp.get(r.grammarPointKey!) ?? 0) + 1);
    expect(byGp.get("gp-1")).toBe(2);
    expect(byGp.get("gp-2")).toBe(2);
    expect(byGp.get("gp-3")).toBe(1);
  });

  it("is reproducible for the same seed and order-independent of input shuffling", () => {
    const idsBefore = rows.map((r) => r.id);
    const fromOriginal = samplePerPoint(rows, 1, 99).map((r) => r.id);
    const fromPermuted = samplePerPoint([...rows].reverse(), 1, 99).map((r) => r.id);
    expect(fromPermuted).toEqual(fromOriginal);
    expect(rows.map((r) => r.id)).toEqual(idsBefore);
  });

  it("groups rows with a null grammarPointKey under a single bucket", () => {
    const nulls = [
      { id: "n1", type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: null, contentJson: {} },
      { id: "n2", type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: null, contentJson: {} },
    ] as PoolRow[];
    expect(samplePerPoint(nulls, 1, 3)).toHaveLength(1);
  });
});
