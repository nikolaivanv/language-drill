import { describe, expect, it } from "vitest";

import { CefrLevel, Language } from "@language-drill/shared";

import { parseBackfillArgs } from "./backfill-coverage-tags";

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
