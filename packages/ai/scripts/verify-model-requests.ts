/**
 * verify:model-requests — one small real call per model family through
 * shapeToolRequest + extractToolUse. Catches request-shape 400s (forced tool
 * choice, thinking modes, sampling params, strict schemas) before an A/B or a
 * model switch spends real money. ~$0.10 per run.
 *
 *   pnpm verify:model-requests
 *   pnpm verify:model-requests --surfaces   # real tool schemas of every migrated surface
 */
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";
import { ExerciseType } from "@language-drill/shared";

import {
  FREE_WRITING_DEDUP_TOOL,
  GENERATION_TOOL_BY_TYPE,
  QA_CRAFTER_TOOL,
  THEORY_GENERATION_TOOL,
  THEORY_VALIDATION_TOOL,
  ZERO_USAGE,
  applyShaped,
  buildEvaluationTool,
  buildFreeWritingEvalTool,
  buildValidationTool,
  createClaudeClient,
  estimateCostUsdFor,
  extractToolUse,
  shapeToolRequest,
} from "../src/index.js";

export const VERIFY_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-haiku-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "claude-opus-4-8",
  "claude-opus-5-5",
] as const;

export const VERIFY_TOOL: Anthropic.Tool = {
  name: "submit_check",
  description: "Submit the check result.",
  input_schema: {
    type: "object",
    properties: {
      word: { type: "string", maxLength: 40 },
      letters: { type: "array", items: { type: "string" }, minItems: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["word", "letters", "confidence"],
  },
};

/** The two families without forced tool choice: strict schemas + auto tool choice. */
export const SURFACE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;

export type VerifySurface = { surface: string; tool: Anthropic.Tool };

/** Every migrated call site, with the real tool it sends (generation/validation for the two key exercise types). */
export const VERIFY_SURFACES: readonly VerifySurface[] = [
  { surface: "evaluation", tool: buildEvaluationTool([{ key: "es-a1-ser-estar", name: "Ser vs estar" }]) },
  { surface: "validation-cloze", tool: buildValidationTool(ExerciseType.CLOZE) },
  { surface: "validation-free_writing", tool: buildValidationTool(ExerciseType.FREE_WRITING) },
  { surface: "generation-cloze", tool: GENERATION_TOOL_BY_TYPE[ExerciseType.CLOZE] },
  { surface: "generation-free_writing", tool: GENERATION_TOOL_BY_TYPE[ExerciseType.FREE_WRITING] },
  { surface: "free-writing-evaluation", tool: buildFreeWritingEvalTool() },
  { surface: "free-writing-dedup", tool: FREE_WRITING_DEDUP_TOOL },
  { surface: "theory-generation", tool: THEORY_GENERATION_TOOL },
  { surface: "theory-validation", tool: THEORY_VALIDATION_TOOL },
  { surface: "qa-crafter", tool: QA_CRAFTER_TOOL },
];

async function mainSurfaces(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = createClaudeClient(apiKey);
  let rejected = 0;
  let cost = 0;
  const byStop = new Map<string, number>();
  for (const model of SURFACE_MODELS) {
    for (const { surface, tool } of VERIFY_SURFACES) {
      const shaped = shapeToolRequest(model, { tool, thinking: "off", temperature: 0 });
      const label = `${model} x ${surface}`;
      try {
        const response = await client.messages.create(
          applyShaped(
            {
              model,
              max_tokens: 2000,
              system: [{ type: "text", text: "You are a compatibility check.", cache_control: { type: "ephemeral" } }],
              messages: [
                {
                  role: "user",
                  content: "This is an API compatibility check. Call the tool with short placeholder values.",
                },
              ],
            },
            shaped,
          ),
        );
        const u = response.usage;
        cost += estimateCostUsdFor(model, {
          ...ZERO_USAGE,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
        });
        const gotCall = response.content.some((b) => b.type === "tool_use");
        const stop = response.stop_reason ?? "null";
        const key = `${stop}${gotCall ? "+tool_call" : "+no_tool_call"}`;
        byStop.set(key, (byStop.get(key) ?? 0) + 1);
        console.log(`ACCEPTED  ${label}  stop=${stop} toolCall=${gotCall}`);
      } catch (e) {
        rejected++;
        console.log(`REJECTED  ${label}  ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  const total = SURFACE_MODELS.length * VERIFY_SURFACES.length;
  console.log(`\n${total - rejected}/${total} accepted, ~$${cost.toFixed(4)}`);
  for (const [k, n] of byStop) console.log(`  ${k}: ${n}`);
  if (rejected > 0) process.exit(1);
}

async function main(): Promise<void> {
  if (process.argv.includes("--surfaces")) return mainSurfaces();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = createClaudeClient(apiKey);
  let failures = 0;
  let cost = 0;
  for (const model of VERIFY_MODELS) {
    const shaped = shapeToolRequest(model, { tool: VERIFY_TOOL, thinking: "off", temperature: 0 });
    try {
      const response = await client.messages.create(
        applyShaped(
          {
            model,
            max_tokens: 400,
            system: [{ type: "text", text: "You check words.", cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: 'Spell the word "cat" as letters, with your confidence.' }],
          },
          shaped,
        ),
      );
      const input = extractToolUse(response, VERIFY_TOOL.name) as { letters?: unknown };
      const u = response.usage;
      cost += estimateCostUsdFor(model, {
        ...ZERO_USAGE,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      });
      const ok = Array.isArray(input.letters);
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${shaped.mode}`);
    } catch (e) {
      failures++;
      console.log(`FAIL  ${shaped.mode}  ${(e as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`\n${VERIFY_MODELS.length - failures}/${VERIFY_MODELS.length} passed, ~$${cost.toFixed(4)}`);
  if (failures > 0) process.exit(1);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error("[verify-model-requests] failed:", e);
    process.exit(1);
  });
}
