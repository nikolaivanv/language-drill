/**
 * Request shaping per model family. Every A/B-candidate call site forces a
 * tool; the newest models reject forced tool choice, `thinking: disabled`
 * and sampling params in different combinations. This module turns what a
 * call site MEANS ("force this tool, thinking off, temperature T") into a
 * request the target model accepts, so switching a surface's model is a
 * one-string change. For today's models the shaped fields are exactly what
 * each call site sent before (pinned by the request-shape snapshots).
 */
import type Anthropic from "@anthropic-ai/sdk";

import { ContentRejectedError } from "./content-rejected-error.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type Pricing = {
  inputUsdPerToken: number;
  cacheWriteUsdPerToken: number;
  cacheReadUsdPerToken: number;
  outputUsdPerToken: number;
};

export type ModelCapabilities = {
  family: string;
  forcedToolChoice: boolean;
  /** How "thinking off" is expressed for this family. */
  thinkingOff: "omit" | "disabled" | "between_tools" | "low-effort";
  samplingParams: boolean;
  effort: boolean;
  pricing: Pricing;
};

const price = (inPerMTok: number, outPerMTok: number): Pricing => ({
  inputUsdPerToken: inPerMTok / 1_000_000,
  cacheWriteUsdPerToken: (inPerMTok * 1.25) / 1_000_000,
  cacheReadUsdPerToken: (inPerMTok * 0.1) / 1_000_000,
  outputUsdPerToken: outPerMTok / 1_000_000,
});

// Order matters: 5.5 rows before their 5 siblings.
const FAMILIES: ReadonlyArray<{ match: RegExp; caps: ModelCapabilities }> = [
  { match: /haiku-4-5/, caps: { family: "haiku-4-5", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: false, pricing: price(1, 5) } },
  // Forced tool choice is accepted; the reply starts with the tool call and has no thinking block.
  // Prices are the <=100k-token-prompt tier (the >100k tier is 5x and not modelled).
  { match: /haiku-5-5/, caps: { family: "haiku-5-5", forcedToolChoice: true, thinkingOff: "omit", samplingParams: false, effort: true, pricing: price(0.1, 0.5) } },
  { match: /sonnet-4-6/, caps: { family: "sonnet-4-6", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: true, pricing: price(3, 15) } },
  { match: /opus-4-6/, caps: { family: "opus-4-6", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: true, pricing: price(5, 25) } },
  { match: /opus-4-[78]/, caps: { family: "opus-4-7-8", forcedToolChoice: true, thinkingOff: "omit", samplingParams: false, effort: true, pricing: price(5, 25) } },
  { match: /sonnet-5-5/, caps: { family: "sonnet-5-5", forcedToolChoice: false, thinkingOff: "between_tools", samplingParams: false, effort: true, pricing: price(2, 10) } },
  { match: /sonnet-5(?!-5)/, caps: { family: "sonnet-5", forcedToolChoice: true, thinkingOff: "disabled", samplingParams: false, effort: true, pricing: price(2, 10) } },
  { match: /opus-5-5/, caps: { family: "opus-5-5", forcedToolChoice: false, thinkingOff: "low-effort", samplingParams: false, effort: true, pricing: price(4, 20) } },
  { match: /opus-5(?!-5)/, caps: { family: "opus-5", forcedToolChoice: true, thinkingOff: "disabled", samplingParams: false, effort: true, pricing: price(5, 25) } },
];

export function capabilityFor(model: string): ModelCapabilities {
  const row = FAMILIES.find((f) => f.match.test(model));
  if (!row) throw new Error(`No model capabilities for ${model}`);
  return row.caps;
}

export type ToolIntent = {
  tool: Anthropic.Tool;
  thinking: "off" | "adaptive";
  temperature?: number;
  effort?: Effort;
};

export type ShapedToolRequest = {
  tools: Anthropic.Tool[];
  tool_choice: Anthropic.ToolChoice;
  thinking?: Anthropic.ThinkingConfigParam;
  temperature?: number;
  output_config?: { effort: Effort };
  /** Present only for families without forced tool choice; append as its own uncached system block. */
  systemSuffix?: string;
  /** One-line description for eval reports. */
  mode: string;
};

const STRICT_UNSUPPORTED = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern",
]);

/** Pure: a copy of `schema` that strict tool use accepts. Parsers stay the real gate. */
export function strictToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictToolSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (STRICT_UNSUPPORTED.has(k)) continue;
    if (k === "properties" && typeof v === "object" && v !== null) {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, strictToolSchema(pv)]));
    } else if (k === "enum" || k === "required" || k === "type") {
      out[k] = v;
    } else {
      out[k] = strictToolSchema(v);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function shapeToolRequest(model: string, intent: ToolIntent): ShapedToolRequest {
  const caps = capabilityFor(model);
  let effort = intent.effort;
  let thinking: ShapedToolRequest["thinking"];
  let thinkingLabel = "none";

  if (intent.thinking === "adaptive") {
    thinking = { type: "adaptive" };
    thinkingLabel = "adaptive";
  } else {
    switch (caps.thinkingOff) {
      case "omit":
        break;
      case "disabled":
        if (effort === "xhigh" || effort === "max") {
          throw new Error(`${model}: thinking disabled is invalid with effort ${effort}`);
        }
        thinking = { type: "disabled" };
        thinkingLabel = "disabled";
        break;
      case "between_tools":
        if (effort === "xhigh" || effort === "max") {
          throw new Error(`${model}: thinking between_tools is invalid with effort ${effort}`);
        }
        thinking = { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam;
        thinkingLabel = "between_tools";
        break;
      case "low-effort":
        effort = effort ?? "low";
        thinkingLabel = "always-on";
        break;
    }
  }

  if (effort !== undefined && !caps.effort) {
    throw new Error(`${model} does not support effort`);
  }

  const shaped: ShapedToolRequest = caps.forcedToolChoice
    ? { tools: [intent.tool], tool_choice: { type: "tool", name: intent.tool.name }, mode: "" }
    : {
        tools: [
          {
            ...intent.tool,
            input_schema: strictToolSchema(intent.tool.input_schema) as Anthropic.Tool["input_schema"],
            strict: true,
          },
        ],
        tool_choice: { type: "auto" },
        systemSuffix: `Respond only by calling the ${intent.tool.name} tool.`,
        mode: "",
      };
  if (thinking !== undefined) shaped.thinking = thinking;
  if (effort !== undefined) shaped.output_config = { effort };
  if (intent.temperature !== undefined && caps.samplingParams) shaped.temperature = intent.temperature;
  shaped.mode = `${caps.family}: tool_choice=${caps.forcedToolChoice ? "forced" : "auto+strict"}, thinking=${thinkingLabel}, effort=${effort ?? "default"}`;
  return shaped;
}

/**
 * Assemble the final request body from a call site's base fields plus the
 * shaped fields. Appends the uncached suffix block after `base.system` when
 * set. The single cast lives here: the SDK does not type `between_tools`
 * thinking. `signal` is a request option (second arg of `create`), not a field.
 */
export function applyShaped(
  base: {
    model: string;
    max_tokens: number;
    system: Anthropic.TextBlockParam[];
    messages: Anthropic.MessageParam[];
  },
  shaped: ShapedToolRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: base.model,
    max_tokens: base.max_tokens,
    system: [
      ...base.system,
      ...(shaped.systemSuffix ? [{ type: "text" as const, text: shaped.systemSuffix }] : []),
    ],
    messages: base.messages,
    tools: shaped.tools,
    tool_choice: shaped.tool_choice,
    ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
    ...(shaped.temperature !== undefined ? { temperature: shaped.temperature } : {}),
    ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
  } as Anthropic.MessageCreateParamsNonStreaming;
}

export class NoToolCallError extends Error {
  constructor(message: string, readonly stopReason: string | null) {
    super(message);
    this.name = "NoToolCallError";
  }
}

/** Returns the named tool's input, or throws ContentRejectedError (refusal) / NoToolCallError. */
export function extractToolUse(
  response: { content: ReadonlyArray<{ type: string; name?: string; input?: unknown }>; stop_reason?: string | null },
  toolName: string,
  opts: { label?: string; refusalMessage?: string } = {},
): unknown {
  const label = opts.label ?? "Claude";
  const stopReason = response.stop_reason ?? null;
  if (stopReason === "refusal") {
    throw new ContentRejectedError(opts.refusalMessage ?? `${label} refused the request.`, "refusal");
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block) {
    throw new NoToolCallError(
      `${label} did not return a tool use block. Stop reason: ${stopReason}. Content types: ${response.content.map((b) => b.type).join(", ")}`,
      stopReason,
    );
  }
  if (block.name !== toolName) {
    throw new NoToolCallError(`Unexpected tool name: expected "${toolName}", got "${block.name}"`, stopReason);
  }
  return block.input;
}
