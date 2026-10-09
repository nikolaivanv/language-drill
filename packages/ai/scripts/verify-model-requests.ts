/**
 * verify:model-requests — one small real call per model family through
 * shapeToolRequest + extractToolUse. Catches request-shape 400s (forced tool
 * choice, thinking modes, sampling params, strict schemas) before an A/B or a
 * model switch spends real money. ~$0.10 per run.
 *
 *   pnpm verify:model-requests
 */
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";

import {
  ZERO_USAGE,
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

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = createClaudeClient(apiKey);
  let failures = 0;
  let cost = 0;
  for (const model of VERIFY_MODELS) {
    const shaped = shapeToolRequest(model, { tool: VERIFY_TOOL, thinking: "off", temperature: 0 });
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 400,
        system: [
          { type: "text", text: "You check words.", cache_control: { type: "ephemeral" } },
          ...(shaped.systemSuffix ? [{ type: "text" as const, text: shaped.systemSuffix }] : []),
        ],
        messages: [{ role: "user", content: 'Spell the word "cat" as letters, with your confidence.' }],
        tools: shaped.tools,
        tool_choice: shaped.tool_choice,
        ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
        ...(shaped.temperature !== undefined ? { temperature: shaped.temperature } : {}),
        ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
      } as Anthropic.MessageCreateParamsNonStreaming);
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
