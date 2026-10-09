import type Anthropic from "@anthropic-ai/sdk";

import { ZERO_USAGE, addUsage, type ClaudeUsageBreakdown } from "./cost-model.js";
import {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  type FreeWritingDedupInput,
} from "./free-writing-dedup-prompts.js";
import { applyShaped, extractToolUse, shapeToolRequest, type Effort } from "./model-request.js";
import { getPromptOrFallback } from "./prompts-registry.js";

const MAX_TOKENS = 400;

/**
 * Judge model. Opus, not the validator's Sonnet: on the #757 human clusters
 * (with five hand-confirmed label corrections) Sonnet 4.6 scored precision
 * 0.893 / recall 0.983 and Opus 4.8 0.913 / 0.975 against a 0.9 / 0.8 bar —
 * Sonnet merged prompts that differ in time frame, focus or task type, and
 * prompt rewording did not fix it (eval-runs fw-dedup-judge-2026-10-r1..r3).
 * At ~1–2k input tokens a call the cost is a few cents per free-writing draft.
 */
export const FREE_WRITING_DEDUP_MODEL = "claude-opus-4-8" as const;

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
  if (d === undefined) throw new Error("dedup verdict is missing duplicateOf");
  if (d === null) return { duplicateOf: null, reason };
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
  options: { signal?: AbortSignal; model?: string; effort?: Effort } = {},
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
  const effectiveModel = options.model ?? FREE_WRITING_DEDUP_MODEL;
  const shaped = shapeToolRequest(effectiveModel, {
    tool: FREE_WRITING_DEDUP_TOOL,
    thinking: "off",
    temperature: 0,
    effort: options.effort,
  });
  const request = applyShaped({
    model: effectiveModel,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user" as const, content: buildFreeWritingDedupUserPrompt(input) }],
  }, shaped);
  // One retry on a malformed verdict: the 2026-10-07 eval saw ~1% of calls omit
  // `duplicateOf` despite the forced tool. A second failure throws, which the
  // insert path treats as "unavailable" (inserted flagged, never approved).
  let tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  for (let attempt = 0; ; attempt++) {
    const response = await client.messages.create(request, { signal: options.signal });
    tokenUsage = addUsage(tokenUsage, readUsage(response));
    try {
      const toolInput = extractToolUse(response, FREE_WRITING_DEDUP_TOOL_NAME, { label: "Dedup judge" });
      return { result: parseFreeWritingDedupVerdict(toolInput, input.existing.length), tokenUsage };
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}
