/**
 * Unit tests for `eval-seed.ts` — hand-curated dataset seeding for the
 * evaluation-quality harness. Port-style DI mirrors eval-export.test.ts:
 * no Langfuse SDK, no network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  parseSeedFixture,
  seedDatasetFromFixture,
  type SeedDatasetApi,
} from "./eval-seed";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture parsing
// ---------------------------------------------------------------------------

const minimalItem = {
  seedKey: "case-01",
  input: {
    exercise: { type: "cloze", instructions: "x", sentence: "___", correctAnswer: "koydu" },
    userAnswer: "koydı",
    language: "TR",
    difficulty: "A1",
  },
  expectedOutput: { score: 0 },
  note: "why this case exists",
};

describe("parseSeedFixture", () => {
  it("accepts a valid fixture", () => {
    const fixture = parseSeedFixture({
      dataset: "eval-hard-morphology",
      description: "desc",
      items: [minimalItem],
    });
    expect(fixture.dataset).toBe("eval-hard-morphology");
    expect(fixture.items).toHaveLength(1);
    expect(fixture.items[0].seedKey).toBe("case-01");
  });

  it("throws when dataset name is missing", () => {
    expect(() => parseSeedFixture({ items: [minimalItem] })).toThrow(/dataset/);
  });

  it("throws when an item has no seedKey", () => {
    expect(() =>
      parseSeedFixture({
        dataset: "d",
        items: [{ ...minimalItem, seedKey: undefined }],
      }),
    ).toThrow(/seedKey/);
  });

  it("throws when an item input is not evaluateAnswer-shaped", () => {
    expect(() =>
      parseSeedFixture({
        dataset: "d",
        items: [{ ...minimalItem, input: { userAnswer: 42 } }],
      }),
    ).toThrow(/input/);
  });

  it("throws on duplicate seedKeys within the fixture", () => {
    expect(() =>
      parseSeedFixture({
        dataset: "d",
        items: [minimalItem, minimalItem],
      }),
    ).toThrow(/duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// Shipped fixture stays valid
// ---------------------------------------------------------------------------

describe("fixtures/eval-hard-morphology.json", () => {
  it("parses and covers the three reported production failures", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(here, "fixtures", "eval-hard-morphology.json"),
        "utf8",
      ),
    );
    const fixture = parseSeedFixture(raw);
    expect(fixture.dataset).toBe("eval-hard-morphology");
    const keys = fixture.items.map((i) => i.seedKey);
    expect(keys).toContain("tr-negation-narrowing-missed-error");
    expect(keys).toContain("tr-plural-slip-intent-misattribution");
    expect(keys).toContain("tr-dili-past-paradigm-confabulation");
    // Every baseline carries the observed (bad) production output so the
    // eval diff shows verdict movement against the failure, not against a
    // hand-idealized target.
    for (const item of fixture.items) {
      expect(item.expectedOutput).toHaveProperty("score");
      expect(item.expectedOutput).toHaveProperty("grammarAccuracy");
    }
  });
});

// ---------------------------------------------------------------------------
// Seeding — idempotent writes
// ---------------------------------------------------------------------------

function makeApi(existingSeedKeys: string[]): SeedDatasetApi & {
  createDataset: ReturnType<typeof vi.fn>;
  createDatasetItem: ReturnType<typeof vi.fn>;
} {
  return {
    createDataset: vi.fn().mockResolvedValue({}),
    createDatasetItem: vi.fn().mockResolvedValue({}),
    api: {
      datasetItemsList: vi.fn().mockResolvedValue({
        data: existingSeedKeys.map((k) => ({ metadata: { seedKey: k } })),
        meta: { totalPages: 1 },
      }),
    },
  };
}

describe("seedDatasetFromFixture", () => {
  const fixture = parseSeedFixture({
    dataset: "eval-hard-morphology",
    items: [
      minimalItem,
      { ...minimalItem, seedKey: "case-02" },
    ],
  });

  it("creates the dataset and writes all items when none exist", async () => {
    const api = makeApi([]);
    const result = await seedDatasetFromFixture(api, fixture, () => {});
    expect(api.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ name: "eval-hard-morphology" }),
    );
    expect(api.createDatasetItem).toHaveBeenCalledTimes(2);
    const body = api.createDatasetItem.mock.calls[0][0];
    expect(body.datasetName).toBe("eval-hard-morphology");
    expect(body.input).toEqual(minimalItem.input);
    expect(body.expectedOutput).toEqual(minimalItem.expectedOutput);
    expect(body.metadata).toMatchObject({ seedKey: "case-01" });
    expect(result.created).toEqual(["case-01", "case-02"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips items whose seedKey already exists (idempotent re-run)", async () => {
    const api = makeApi(["case-01"]);
    const result = await seedDatasetFromFixture(api, fixture, () => {});
    expect(api.createDatasetItem).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual(["case-02"]);
    expect(result.skipped).toEqual(["case-01"]);
  });
});
