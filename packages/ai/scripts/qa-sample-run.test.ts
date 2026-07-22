import { describe, it, expect } from "vitest";
import { samplePerPoint, mulberry32, parseQaArgs, type PoolRow } from "./qa-sample-run.js";

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

import { buildReport, type QaFlagRecord } from "./qa-sample-run.js";

describe("buildReport", () => {
  const records: QaFlagRecord[] = [
    {
      exerciseId: "e1", grammarPointKey: "gp-1", type: "cloze", language: "TR", cefr: "A1",
      flags: ["false_negative"], ambiguous: false, ambiguityNote: "",
      answers: { correct: "x", wrong: "y", alt: null },
      confidence: 0.95,
      verdicts: { correct: { score: 0.2, band: "fail" }, wrong: { score: 0.1, band: "fail" }, alt: null },
      promptSeen: "Fill the blank. ___",
    },
    {
      exerciseId: "e2", grammarPointKey: "gp-1", type: "cloze", language: "TR", cefr: "A1",
      flags: [], ambiguous: true, ambiguityNote: "unclear which tense",
      answers: { correct: "a", wrong: "b", alt: "c" },
      confidence: 0.9,
      verdicts: { correct: { score: 0.9, band: "pass" }, wrong: { score: 0.1, band: "fail" }, alt: { score: 0.9, band: "pass" } },
      promptSeen: "Fill the blank. ___",
    },
  ];

  it("summarizes flagged counts, byReason, byType, and ambiguity notes", () => {
    const report = buildReport(records, {
      language: "TR", cefr: "A1", perPoint: 2, sampledCount: 2, seed: 1,
      model: "claude-opus-4-8", costUsd: 0.12, startedAt: "2026-07-22T00:00:00.000Z",
      costCapped: false,
    });
    expect(report.summary.sampled).toBe(2);
    expect(report.summary.flagged).toBe(1);
    expect(report.summary.byReason.false_negative).toBe(1);
    expect(report.summary.byType.cloze).toBe(1);
    expect(report.summary.ambiguityNotes).toBe(1);
    expect(report.flags).toHaveLength(1);
    expect(report.ambiguity).toHaveLength(1);
  });
});

describe("parseQaArgs", () => {
  it("uppercases --language and --cefr (pool stores them uppercase)", () => {
    const args = parseQaArgs(["--language", "es", "--cefr", "a1"]);
    expect(args.language).toBe("ES");
    expect(args.cefr).toBe("A1");
  });

  it("leaves already-uppercase --language/--cefr unchanged", () => {
    const args = parseQaArgs(["--language", "TR", "--cefr", "B2"]);
    expect(args.language).toBe("TR");
    expect(args.cefr).toBe("B2");
  });

  it("leaves --type lowercase (pool stores types lowercase)", () => {
    const args = parseQaArgs(["--language", "es", "--type", "cloze,translation"]);
    expect(args.types).toEqual(["cloze", "translation"]);
  });

  it("throws when --language is missing", () => {
    expect(() => parseQaArgs(["--cefr", "a1"])).toThrow(/--language is required/);
  });
});
