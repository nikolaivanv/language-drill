/**
 * eval-seed — write hand-curated dataset items into a Langfuse dataset.
 *
 * `pnpm eval:export` samples what production traffic happened to produce;
 * this script seeds what production traffic is known to get WRONG. Each
 * fixture item carries the observed (bad) baseline output as
 * `expectedOutput`, so a subsequent `pnpm eval --dataset <name>` diff shows
 * the candidate's verdict movement against the recorded failure.
 *
 * Usage:
 *   pnpm --filter @language-drill/ai eval:seed \
 *     [--file scripts/fixtures/eval-hard-morphology.json] [--allow-prod]
 *
 * Idempotent: items are deduped on `metadata.seedKey`, so re-running after
 * adding new fixture cases writes only the new ones.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { getLangfuse } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixture shape + validation
// ---------------------------------------------------------------------------

export type SeedItem = {
  /** Stable dedupe key — re-runs skip items whose key is already present. */
  seedKey: string;
  /** `EvaluateAnswerInput`-shaped object (exercise/userAnswer/language/difficulty). */
  input: Record<string, unknown>;
  /** Baseline evaluation (typically the observed bad production output). */
  expectedOutput: Record<string, unknown>;
  /** Human note: why this case is in the dataset. Stored in item metadata. */
  note?: string;
};

export type SeedFixture = {
  dataset: string;
  description?: string;
  items: SeedItem[];
};

/** Mirrors eval-run's `isEvaluateAnswerInput` gate so malformed hand-written
 * items fail at seed time, not silently mid-run. */
function isEvaluateAnswerInputShape(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    "exercise" in r &&
    typeof r.userAnswer === "string" &&
    typeof r.language === "string" &&
    typeof r.difficulty === "string"
  );
}

export function parseSeedFixture(raw: unknown): SeedFixture {
  if (raw === null || typeof raw !== "object") {
    throw new Error("[eval-seed] fixture must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.dataset !== "string" || r.dataset.length === 0) {
    throw new Error("[eval-seed] fixture is missing a 'dataset' name");
  }
  if (!Array.isArray(r.items) || r.items.length === 0) {
    throw new Error("[eval-seed] fixture must contain a non-empty 'items' array");
  }

  const seen = new Set<string>();
  const items: SeedItem[] = r.items.map((entry, i) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`[eval-seed] items[${i}] must be an object`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.seedKey !== "string" || item.seedKey.length === 0) {
      throw new Error(`[eval-seed] items[${i}] is missing a 'seedKey'`);
    }
    if (seen.has(item.seedKey)) {
      throw new Error(
        `[eval-seed] duplicate seedKey '${item.seedKey}' in fixture`,
      );
    }
    seen.add(item.seedKey);
    if (!isEvaluateAnswerInputShape(item.input)) {
      throw new Error(
        `[eval-seed] items[${i}] ('${item.seedKey}') input is not evaluateAnswer-shaped ` +
          "(needs exercise + string userAnswer/language/difficulty)",
      );
    }
    if (item.expectedOutput === null || typeof item.expectedOutput !== "object") {
      throw new Error(
        `[eval-seed] items[${i}] ('${item.seedKey}') is missing an 'expectedOutput' object`,
      );
    }
    return {
      seedKey: item.seedKey,
      input: item.input as Record<string, unknown>,
      expectedOutput: item.expectedOutput as Record<string, unknown>,
      note: typeof item.note === "string" ? item.note : undefined,
    };
  });

  return {
    dataset: r.dataset,
    description: typeof r.description === "string" ? r.description : undefined,
    items,
  };
}

// ---------------------------------------------------------------------------
// Seeding — port-style DI (mirrors eval-export's LangfuseDatasetApi)
// ---------------------------------------------------------------------------

export type SeedDatasetApi = {
  createDataset: (input: {
    name: string;
    description?: string;
  }) => Promise<unknown>;
  createDatasetItem: (body: {
    datasetName: string;
    input?: unknown;
    expectedOutput?: unknown;
    metadata?: unknown;
  }) => Promise<unknown>;
  api: {
    datasetItemsList: (query: {
      datasetName: string;
      limit: number;
      page: number;
    }) => Promise<{
      data: ReadonlyArray<{ metadata?: unknown }>;
      meta: { totalPages: number };
    }>;
  };
};

const PAGE_SIZE = 100;
const PAGE_CAP = 50;

export type SeedResult = {
  created: string[];
  skipped: string[];
};

export async function seedDatasetFromFixture(
  langfuse: SeedDatasetApi,
  fixture: SeedFixture,
  log: (...args: unknown[]) => void = (...a) => console.log(...a),
): Promise<SeedResult> {
  // createDataset upserts — safe to call unconditionally (same rationale as
  // eval-export's getOrCreateDataset).
  await langfuse.createDataset({
    name: fixture.dataset,
    description: fixture.description,
  });

  const existingKeys = new Set<string>();
  let page = 1;
  for (let i = 0; i < PAGE_CAP; i++) {
    const resp = await langfuse.api.datasetItemsList({
      datasetName: fixture.dataset,
      limit: PAGE_SIZE,
      page,
    });
    for (const item of resp.data) {
      const md = item.metadata;
      if (md === null || md === undefined || typeof md !== "object") continue;
      const key = (md as { seedKey?: unknown }).seedKey;
      if (typeof key === "string" && key.length > 0) existingKeys.add(key);
    }
    if (page >= resp.meta.totalPages) break;
    page++;
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const item of fixture.items) {
    if (existingKeys.has(item.seedKey)) {
      skipped.push(item.seedKey);
      log(`[eval-seed] skip (exists): ${item.seedKey}`);
      continue;
    }
    await langfuse.createDatasetItem({
      datasetName: fixture.dataset,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: { seedKey: item.seedKey, note: item.note, source: "eval-seed" },
    });
    created.push(item.seedKey);
    log(`[eval-seed] created: ${item.seedKey}`);
  }

  log(
    `[eval-seed] dataset='${fixture.dataset}' created=${created.length} skipped=${skipped.length}`,
  );
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = path.join(here, "fixtures", "eval-hard-morphology.json");

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      file: { type: "string" },
      "allow-prod": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.log(
      "Usage: pnpm eval:seed [--file <fixture.json>] [--allow-prod]",
    );
    return;
  }

  if (process.env.LANGFUSE_ENV === "prod" && !parsed.values["allow-prod"]) {
    throw new Error(
      "[eval-seed] LANGFUSE_ENV=prod requires --allow-prod (refusing to write a prod dataset)",
    );
  }

  const fixturePath = parsed.values.file ?? DEFAULT_FIXTURE;
  const fixture = parseSeedFixture(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[eval-seed] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  await seedDatasetFromFixture(lf as unknown as SeedDatasetApi, fixture);
  // Flush the SDK's buffered events before the process exits.
  await (lf as unknown as { flushAsync?: () => Promise<void> }).flushAsync?.();
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[eval-seed] unhandled failure:", err);
    process.exit(1);
  });
}
