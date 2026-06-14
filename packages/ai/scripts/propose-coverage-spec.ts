/**
 * propose:coverage-spec — LLM-assisted coverage-spec authoring (Phase 2).
 * Reads a grammar point, asks Claude for a coverage spec, validates it, and
 * prints a paste-ready `coverageSpec` snippet (+ writes `<key>.coverage-spec.proposed.json`).
 * The human reviews and commits the snippet into the curriculum. Read-only on
 * the DB (only with --with-pool-stats); never writes the curriculum.
 *
 * Usage:
 *   pnpm --filter @language-drill/ai propose:coverage-spec --grammar-point tr-a1-present-continuous
 *   pnpm --filter @language-drill/ai propose:coverage-spec --grammar-point es-b1-conditional --with-pool-stats
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { createDb, getGrammarPoint, requireEnv } from "@language-drill/db";

import { createClaudeClient } from "../src/index.js";
import {
  proposeCoverageSpec,
  renderCoverageSpecSnippet,
} from "../src/coverage-spec-proposal.js";

async function loadPoolStats(grammarPointKey: string): Promise<string | null> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const result = await db.execute(sql`
    SELECT type, tag.key AS axis, tag.value AS value, COUNT(*)::int AS n
    FROM exercises
    CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
    WHERE grammar_point_key = ${grammarPointKey}
      AND review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags IS NOT NULL
    GROUP BY type, tag.key, tag.value
    ORDER BY type, tag.key, tag.value
  `);
  const rows = result.rows as unknown as {
    type: string;
    axis: string;
    value: string;
    n: number;
  }[];
  if (rows.length === 0) return "(no approved exercises yet)";
  return rows.map((r) => `${r.type} ${r.axis}=${r.value}: ${r.n}`).join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "grammar-point": { type: "string" },
      "with-pool-stats": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values["grammar-point"]) {
    console.log(
      "Usage: propose:coverage-spec --grammar-point <key> [--with-pool-stats]",
    );
    process.exit(values.help ? 0 : 1);
  }

  const key = values["grammar-point"];
  const gp = getGrammarPoint(key);
  if (!gp) {
    console.error(`[propose-coverage-spec] unknown grammar point '${key}'`);
    process.exit(1);
  }

  const poolStats = values["with-pool-stats"] ? await loadPoolStats(key) : null;
  const client = createClaudeClient(requireEnv("ANTHROPIC_API_KEY"));
  const proposal = await proposeCoverageSpec(client, gp, poolStats);

  const snippet = renderCoverageSpecSnippet(proposal);
  const outPath = `${key}.coverage-spec.proposed.json`;
  writeFileSync(outPath, JSON.stringify(proposal, null, 2), "utf8");

  console.log(
    `\n# Proposed coverageSpec for ${key} — review, edit, paste into the curriculum:\n`,
  );
  console.log(snippet);
  console.log(`\n# Rationale + NA/rare notes written to ${outPath}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[propose-coverage-spec] unhandled failure:", err);
    process.exit(1);
  });
}
