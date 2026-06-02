/**
 * Unit tests for `eval-gen-export.ts` — the failure-prone cell-dataset export.
 *
 * Covers the pure layers (no live Drizzle pool): cellKey → descriptor parsing,
 * approval-rate ranking + filtering, the argv parser, and the orchestrator
 * driven by a stub `GenerationJobStatsSource`.
 */

import { describe, expect, it } from "vitest";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";

import {
  cellKeyToDescriptor,
  parseEvalGenExportArgs,
  rankFailureProneCells,
  runEvalGenExport,
  type CellApprovalRow,
  type GenerationJobStatsSource,
} from "./eval-gen-export";

// ---------------------------------------------------------------------------
// cellKeyToDescriptor
// ---------------------------------------------------------------------------

describe("cellKeyToDescriptor", () => {
  it("round-trips a valid cellKey to a typed descriptor", () => {
    expect(cellKeyToDescriptor("tr:a1:cloze:tr-a1-locative")).toEqual({
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      exerciseType: ExerciseType.CLOZE,
      grammarPointKey: "tr-a1-locative",
    });
    expect(
      cellKeyToDescriptor("es:b1:vocab_recall:es-b1-environment-vocab"),
    ).toEqual({
      language: Language.ES,
      cefrLevel: CefrLevel.B1,
      exerciseType: ExerciseType.VOCAB_RECALL,
      grammarPointKey: "es-b1-environment-vocab",
    });
  });

  it("returns null for a wrong-arity key", () => {
    expect(cellKeyToDescriptor("tr:a1:cloze")).toBeNull();
    expect(cellKeyToDescriptor("tr:a1:cloze:x:y")).toBeNull();
  });

  it("returns null for an unknown grammar point", () => {
    expect(cellKeyToDescriptor("tr:a1:cloze:tr-a1-does-not-exist")).toBeNull();
  });

  it("returns null for a bad enum segment", () => {
    expect(cellKeyToDescriptor("tr:z9:cloze:tr-a1-locative")).toBeNull();
    expect(cellKeyToDescriptor("tr:a1:bogus:tr-a1-locative")).toBeNull();
  });

  it("returns null for an EN cell (not a generation language)", () => {
    expect(cellKeyToDescriptor("en:a1:cloze:tr-a1-locative")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rankFailureProneCells
// ---------------------------------------------------------------------------

const row = (cellKey: string, produced: number, approved: number): CellApprovalRow => ({
  cellKey,
  produced,
  approved,
});

describe("rankFailureProneCells", () => {
  it("sorts ascending by approval rate and caps at sample", () => {
    const rows = [
      row("tr:a1:cloze:tr-a1-locative", 10, 9), // 0.9
      row("tr:a1:cloze:tr-a1-negation", 10, 2), // 0.2  ← worst
      row("tr:a1:cloze:tr-a1-future", 10, 5), // 0.5
    ];
    const { ranked } = rankFailureProneCells(rows, { sample: 2 });
    expect(ranked.map((r) => r.cellKey)).toEqual([
      "tr:a1:cloze:tr-a1-negation",
      "tr:a1:cloze:tr-a1-future",
    ]);
    expect(ranked[0].approvalRate).toBeCloseTo(0.2, 10);
  });

  it("drops zero-production cells (no quality signal)", () => {
    const rows = [
      row("tr:a1:cloze:tr-a1-locative", 0, 0),
      row("tr:a1:cloze:tr-a1-future", 4, 1),
    ];
    const { ranked } = rankFailureProneCells(rows, { sample: 10 });
    expect(ranked.map((r) => r.cellKey)).toEqual(["tr:a1:cloze:tr-a1-future"]);
  });

  it("collects unparseable cellKeys in `skipped` without ranking them", () => {
    const rows = [
      row("tr:a1:cloze:tr-a1-locative", 10, 1),
      row("garbage-key", 10, 0),
      row("tr:a1:cloze:tr-a1-does-not-exist", 10, 0),
    ];
    const { ranked, skipped } = rankFailureProneCells(rows, { sample: 10 });
    expect(ranked.map((r) => r.cellKey)).toEqual(["tr:a1:cloze:tr-a1-locative"]);
    expect(skipped).toEqual(["garbage-key", "tr:a1:cloze:tr-a1-does-not-exist"]);
  });

  it("applies the optional language + cefr filters", () => {
    const rows = [
      row("tr:a1:cloze:tr-a1-locative", 10, 1),
      row("es:b1:cloze:es-b1-conditional", 10, 1),
    ];
    const trOnly = rankFailureProneCells(rows, { sample: 10, language: "tr" });
    expect(trOnly.ranked.map((r) => r.cellKey)).toEqual([
      "tr:a1:cloze:tr-a1-locative",
    ]);
    const b1Only = rankFailureProneCells(rows, { sample: 10, cefr: "B1" });
    expect(b1Only.ranked.map((r) => r.cellKey)).toEqual([
      "es:b1:cloze:es-b1-conditional",
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseEvalGenExportArgs
// ---------------------------------------------------------------------------

describe("parseEvalGenExportArgs", () => {
  it("parses required + optional fields", () => {
    expect(
      parseEvalGenExportArgs([
        "--sample",
        "20",
        "--out",
        "./cells.json",
        "--language",
        "TR",
        "--cefr",
        "A1",
        "--allow-prod",
      ]),
    ).toEqual({
      sample: 20,
      out: "./cells.json",
      language: "TR",
      cefr: "A1",
      allowProd: true,
    });
  });

  it("throws when --sample or --out is missing", () => {
    expect(() => parseEvalGenExportArgs(["--out", "./c.json"])).toThrow(
      /--sample/,
    );
    expect(() => parseEvalGenExportArgs(["--sample", "5"])).toThrow(/--out/);
  });

  it("throws when --sample is not a positive integer", () => {
    expect(() =>
      parseEvalGenExportArgs(["--sample", "0", "--out", "./c.json"]),
    ).toThrow(/--sample/);
    expect(() =>
      parseEvalGenExportArgs(["--sample", "abc", "--out", "./c.json"]),
    ).toThrow(/--sample/);
  });
});

// ---------------------------------------------------------------------------
// runEvalGenExport — orchestration via a stub stats source
// ---------------------------------------------------------------------------

describe("runEvalGenExport", () => {
  it("fetches, ranks the worst N, and surfaces skipped keys", async () => {
    const source: GenerationJobStatsSource = {
      fetchCellApprovalRows: async () => [
        row("tr:a1:cloze:tr-a1-locative", 10, 9),
        row("tr:a1:cloze:tr-a1-negation", 10, 1),
        row("not-a-cell-key", 5, 0),
      ],
    };

    const { ranked, skipped } = await runEvalGenExport({
      source,
      args: { sample: 1, out: "unused.json", allowProd: false },
      log: () => {},
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].cellKey).toBe("tr:a1:cloze:tr-a1-negation");
    expect(skipped).toEqual(["not-a-cell-key"]);
  });
});
