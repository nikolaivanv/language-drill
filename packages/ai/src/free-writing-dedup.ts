import type Anthropic from "@anthropic-ai/sdk";

import { ZERO_USAGE, type ClaudeUsageBreakdown } from "./cost-model.js";
import {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  type FreeWritingDedupInput,
} from "./free-writing-dedup-prompts.js";
import { getPromptOrFallback } from "./prompts-registry.js";
import { VALIDATION_MODEL } from "./validate.js";

const MAX_TOKENS = 400;

export type FreeWritingDedupVerdict = { duplicateOf: number | null; reason: string };

export const FREE_WRITING_DEDUP_TOOL: Anthropic.Tool = {
  name: FREE_WRITING_DEDUP_TOOL_NAME,
  description: "Submit whether the candidate prompt duplicates an existing one.",
  input_schema: {
    type: "object" as const,
    properties: {
      duplicateOf: {
        type: ["integer", "null"],
        description: "Index of the closest duplicated existing prompt, or null if the candidate is distinct.",
      },
      reason: { type: "string", description: "One sentence explaining the verdict." },
    },
    required: ["duplicateOf", "reason"],
  },
};

/** Throws on an invalid index so the caller can treat the check as unavailable. */
export function parseFreeWritingDedupVerdict(input: unknown, existingCount: number): FreeWritingDedupVerdict {
  if (typeof input !== "object" || input === null) {
    throw new Error("dedup verdict is not an object");
  }
  const r = input as Record<string, unknown>;
  const reason = typeof r.reason === "string" ? r.reason : "";
  const d = r.duplicateOf;
  if (d === null || d === undefined) return { duplicateOf: null, reason };
  if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d >= existingCount) {
    throw new Error(`dedup verdict index out of range: ${String(d)} (existing=${existingCount})`);
  }
  return { duplicateOf: d, reason };
}

function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

export async function judgeFreeWritingDuplicate(
  client: Anthropic,
  input: FreeWritingDedupInput,
  options: { signal?: AbortSignal; model?: string } = {},
): Promise<{ result: FreeWritingDedupVerdict; tokenUsage: ClaudeUsageBreakdown }> {
  // Nothing to duplicate: skip the call entirely.
  if (input.existing.length === 0) {
    return { result: { duplicateOf: null, reason: "no existing prompts" }, tokenUsage: ZERO_USAGE };
  }
  const resolved = await getPromptOrFallback(
    "free-writing-dedup-system-prompt",
    FREE_WRITING_DEDUP_SYSTEM_PROMPT,
    FREE_WRITING_DEDUP_PROMPT_VERSION,
  );
  const response = await client.messages.create(
    {
      model: options.model ?? VALIDATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: buildFreeWritingDedupUserPrompt(input) }],
      tools: [FREE_WRITING_DEDUP_TOOL],
      tool_choice: { type: "tool" as const, name: FREE_WRITING_DEDUP_TOOL_NAME },
      temperature: 0,
    },
    { signal: options.signal },
  );
  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) {
    throw new Error(`dedup judge returned no tool call (stop_reason=${response.stop_reason})`);
  }
  return {
    result: parseFreeWritingDedupVerdict(block.input, input.existing.length),
    tokenUsage: readUsage(response),
  };
}
