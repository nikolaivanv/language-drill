/**
 * `pnpm --filter @language-drill/ai eval:theory-validator` — measures the theory
 * validator against labelled pages.
 *
 * WHY. The 2026-11-01 audit found 183 of 312 auto-approved theory pages stated
 * a wrong rule, starred a correct sentence, or overstated an "always/never".
 * The validator caught self-contradiction but not a plausible wrong rule. This
 * script replays the REAL `validateTheoryDraft` over two sets of pages:
 *
 *   --bad-dir   pages known to contain factual errors (the audit's originals).
 *               Success = the validator does NOT auto-approve them.
 *   --good-dir  the same pages after hand repair. Success = auto-approved
 *               (at minimum: not rejected).
 *
 * Each file is `<grammar_point_key>.json` with the page under `content`
 * (the shape the audit's before/after dumps use). The page's curriculum entry
 * is loaded from `@language-drill/db`, so the run reflects the current
 * curriculum, exactly as the weekly theory job would see it.
 *
 * Read-only: never writes to the database. Costs real API calls; capped by
 * `--max-cost-usd` (default $10).
 *
 * Usage:
 *   pnpm --filter @language-drill/ai eval:theory-validator \
 *     --bad-dir /abs/before --good-dir /abs/after \
 *     [--keys-file /abs/keys.txt] [--model claude-opus-5-5] \
 *     [--thinking adaptive] [--effort high] [--concurrency 4] \
 *     [--limit N] [--max-cost-usd 10] [--out <name>]
 *
 * Paths must be absolute: pnpm --filter runs from packages/ai.
 * Writes ./eval-runs/<name>.json (per-page verdicts + summary).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import Anthropic from "@anthropic-ai/sdk";
import { Language } from "@language-drill/shared";
import { getGrammarPoint, routeTheoryValidationResult } from "@language-drill/db";

import { estimateCostUsdFor } from "../src/cost-model.js";
import type { Effort } from "../src/model-request.js";
import type { TheoryDraft, TheoryGenerationSpec } from "../src/theory-generate.js";
import {
  THEORY_VALIDATION_MODEL,
  THEORY_VALIDATION_THINKING,
  THEORY_VALIDATION_TOOL,
  validateTheoryDraft,
} from "../src/theory-validate.js";
import { THEORY_VALIDATION_PROMPT_VERSION } from "../src/theory-validation-prompts.js";
import { parseEffort, requestModeFor } from "./eval-run.js";

type Label = "bad" | "good";
type Item = { key: string; label: Label; file: string };

type PageVerdict = {
  key: string;
  label: Label;
  status?: string;
  qualityScore?: number;
  factualErrors?: string[];
  flaggedReasons?: string[];
  costUsd?: number;
  error?: string;
};

const LANG_BY_PREFIX: Record<string, Exclude<Language, Language.EN>> = {
  es: Language.ES,
  de: Language.DE,
  tr: Language.TR,
};

function listItems(dir: string | undefined, label: Label, keys: Set<string> | null): Item[] {
  if (!dir) return [];
  if (!path.isAbsolute(dir)) throw new Error(`--${label}-dir must be absolute: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "all-pages.json")
    .map((f) => ({ key: f.replace(/\.json$/, ""), label, file: path.join(dir, f) }))
    .filter((i) => keys === null || keys.has(i.key))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function readKeys(file: string | undefined): Set<string> | null {
  if (!file) return null;
  const keys = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  return new Set(keys);
}

export function summarize(verdicts: PageVerdict[]) {
  const scored = verdicts.filter((v) => v.status);
  const bad = scored.filter((v) => v.label === "bad");
  const good = scored.filter((v) => v.label === "good");
  const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);
  return {
    bad: {
      n: bad.length,
      notApproved: rate(bad.filter((v) => v.status !== "auto-approved").length, bad.length),
      rejected: rate(bad.filter((v) => v.status === "rejected").length, bad.length),
    },
    good: {
      n: good.length,
      approved: rate(good.filter((v) => v.status === "auto-approved").length, good.length),
      rejected: rate(good.filter((v) => v.status === "rejected").length, good.length),
    },
    errors: verdicts.filter((v) => v.error).length,
    costUsd: Math.round(verdicts.reduce((s, v) => s + (v.costUsd ?? 0), 0) * 100) / 100,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "bad-dir": { type: "string" },
      "good-dir": { type: "string" },
      "keys-file": { type: "string" },
      model: { type: "string" },
      thinking: { type: "string" },
      effort: { type: "string" },
      concurrency: { type: "string", default: "4" },
      limit: { type: "string" },
      "max-cost-usd": { type: "string", default: "10" },
      out: { type: "string" },
    },
  });
  const model = values.model ?? THEORY_VALIDATION_MODEL;
  const thinking = (values.thinking ?? THEORY_VALIDATION_THINKING) as "off" | "adaptive";
  if (thinking !== "off" && thinking !== "adaptive") throw new Error("--thinking must be off|adaptive");
  const effort: Effort | undefined = parseEffort(values.effort);
  const maxCost = Number(values["max-cost-usd"]);
  const concurrency = Math.max(1, Number(values.concurrency));
  const keys = readKeys(values["keys-file"]);

  let items = [
    ...listItems(values["bad-dir"], "bad", keys),
    ...listItems(values["good-dir"], "good", keys),
  ];
  if (items.length === 0) throw new Error("no pages: pass --bad-dir and/or --good-dir");
  if (values.limit) items = items.slice(0, Number(values.limit));

  const requestMode = requestModeFor(model, THEORY_VALIDATION_TOOL, thinking, effort);
  console.log(`[eval-theory-validator] ${items.length} pages · model ${model} · ${requestMode} · prompt ${THEORY_VALIDATION_PROMPT_VERSION}`);

  const client = new Anthropic();
  const verdicts: PageVerdict[] = [];
  let spent = 0;
  let next = 0;
  let stopped = false;

  async function worker() {
    while (!stopped && next < items.length) {
      const item = items[next++];
      const verdict: PageVerdict = { key: item.key, label: item.label };
      try {
        const lang = LANG_BY_PREFIX[item.key.slice(0, 2)];
        const point = getGrammarPoint(item.key);
        if (!lang || !point) throw new Error(`no curriculum point for ${item.key}`);
        const page = JSON.parse(readFileSync(item.file, "utf8"));
        const spec: TheoryGenerationSpec = {
          language: lang,
          cefrLevel: point.cefrLevel,
          grammarPoint: point,
          batchSeed: "eval",
        };
        const draft: TheoryDraft = {
          id: "00000000-0000-0000-0000-000000000000",
          topicId: item.key.slice(3),
          contentJson: page.content,
          metadata: {
            grammarPointKey: item.key,
            modelId: "eval",
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
        };
        const { result, tokenUsage } = await validateTheoryDraft(client, draft, spec, {
          model,
          thinking,
          effort,
        });
        const decision = routeTheoryValidationResult(result);
        verdict.status = decision.reviewStatus;
        verdict.qualityScore = result.qualityScore;
        verdict.factualErrors = result.factualErrors;
        verdict.flaggedReasons = result.flaggedReasons;
        verdict.costUsd = estimateCostUsdFor(model, tokenUsage);
        spent += verdict.costUsd;
      } catch (e) {
        verdict.error = e instanceof Error ? e.message : String(e);
      }
      verdicts.push(verdict);
      console.log(
        `${item.label.padEnd(4)} ${item.key.padEnd(48)} ${verdict.status ?? "ERROR"} ${verdict.qualityScore ?? ""} fe=${verdict.factualErrors?.length ?? "-"}${verdict.error ? " " + verdict.error.slice(0, 120) : ""}`,
      );
      if (spent >= maxCost) {
        stopped = true;
        console.log(`[eval-theory-validator] cost cap $${maxCost} reached — stopping`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const summary = summarize(verdicts);
  const name = values.out ?? `theory-validator-${model}-${thinking}-${effort ?? "default"}-${Date.now()}`;
  const outDir = path.resolve("eval-runs");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${name}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      { model, thinking, effort: effort ?? null, requestMode, promptVersion: THEORY_VALIDATION_PROMPT_VERSION, truncated: stopped, summary, verdicts },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[eval-theory-validator] wrote ${outFile}`);
}

if (process.argv[1] && process.argv[1].endsWith("eval-theory-validator.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
