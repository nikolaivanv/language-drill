import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { ContentRejectedError } from "./content-rejected-error";
import {
  NoToolCallError,
  applyShaped,
  capabilityFor,
  extractToolUse,
  shapeToolRequest,
  strictToolSchema,
} from "./model-request";

const TOOL: Anthropic.Tool = {
  name: "submit_thing",
  description: "Submit.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      items: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1 } },
      nested: { type: "object", properties: { code: { type: "string", pattern: "^[a-z]+$" } } },
      kind: { type: "string", enum: ["a", "b"] },
      maybe: { type: ["integer", "null"] },
    },
    required: ["score", "items"],
  },
};

describe("capabilityFor", () => {
  it.each([
    ["claude-haiku-4-5-20251001", "haiku-4-5"],
    ["claude-haiku-5-5", "haiku-5-5"],
    ["claude-sonnet-4-6", "sonnet-4-6"],
    ["claude-opus-4-6", "opus-4-6"],
    ["claude-opus-4-7", "opus-4-7-8"],
    ["claude-opus-4-8", "opus-4-7-8"],
    ["claude-sonnet-5", "sonnet-5"],
    ["claude-sonnet-5-5", "sonnet-5-5"],
    ["claude-opus-5", "opus-5"],
    ["claude-opus-5-5", "opus-5-5"],
  ])("%s → %s", (model, family) => {
    expect(capabilityFor(model).family).toBe(family);
  });

  it("throws on an unknown model", () => {
    expect(() => capabilityFor("claude-mystery-9")).toThrow(/No model capabilities for claude-mystery-9/);
  });
});

describe("shapeToolRequest", () => {
  it("Sonnet 4.6, thinking off, temperature 0.7: forced tool, temperature, no thinking", () => {
    const s = shapeToolRequest("claude-sonnet-4-6", { tool: TOOL, thinking: "off", temperature: 0.7 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.tools).toEqual([TOOL]);
    expect(s.temperature).toBe(0.7);
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toBeUndefined();
    expect(s.systemSuffix).toBeUndefined();
  });

  it("Opus 4.8, thinking off, temperature 0: forced tool, NO temperature, NO thinking", () => {
    const s = shapeToolRequest("claude-opus-4-8", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.temperature).toBeUndefined();
    expect(s.thinking).toBeUndefined();
  });

  it("Sonnet 5, thinking off: forced tool, disabled thinking, no temperature", () => {
    const s = shapeToolRequest("claude-sonnet-5", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.thinking).toEqual({ type: "disabled" });
    expect(s.temperature).toBeUndefined();
  });

  it("Sonnet 5, adaptive with effort low: adaptive thinking + effort", () => {
    const s = shapeToolRequest("claude-sonnet-5", { tool: TOOL, thinking: "adaptive", effort: "low" });
    expect(s.thinking).toEqual({ type: "adaptive" });
    expect(s.output_config).toEqual({ effort: "low" });
  });

  it("Sonnet 5.5, thinking off: auto + strict tool + suffix + between_tools", () => {
    const s = shapeToolRequest("claude-sonnet-5-5", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "auto" });
    expect((s.tools[0] as unknown as { strict: boolean }).strict).toBe(true);
    expect(s.tools[0].input_schema).toEqual(strictToolSchema(TOOL.input_schema));
    expect(s.systemSuffix).toBe("Respond only by calling the submit_thing tool.");
    expect(s.thinking).toEqual({ type: "between_tools" });
    expect(s.temperature).toBeUndefined();
    expect(s.mode).toBe("sonnet-5-5: tool_choice=auto+strict, thinking=between_tools, effort=default");
  });

  it("Sonnet 5.5 thinking off rejects effort xhigh/max", () => {
    expect(() => shapeToolRequest("claude-sonnet-5-5", { tool: TOOL, thinking: "off", effort: "xhigh" })).toThrow(/between_tools/);
  });

  it("Opus 5.5, thinking off: no thinking field, effort low by default, auto + strict", () => {
    const s = shapeToolRequest("claude-opus-5-5", { tool: TOOL, thinking: "off" });
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toEqual({ effort: "low" });
    expect(s.tool_choice).toEqual({ type: "auto" });
  });

  it("Opus 5.5, thinking off with an explicit effort keeps the caller's effort", () => {
    const s = shapeToolRequest("claude-opus-5-5", { tool: TOOL, thinking: "off", effort: "medium" });
    expect(s.output_config).toEqual({ effort: "medium" });
  });

  it("Opus 5 thinking off rejects effort max", () => {
    expect(() => shapeToolRequest("claude-opus-5", { tool: TOOL, thinking: "off", effort: "max" })).toThrow(/disabled/);
  });

  it("Haiku 5.5, thinking off, temperature 0: forced tool, NO temperature, NO thinking", () => {
    const s = shapeToolRequest("claude-haiku-5-5", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.temperature).toBeUndefined();
    expect(s.thinking).toBeUndefined();
    expect(s.systemSuffix).toBeUndefined();
  });

  it("an effort on a model without effort support throws naming the model", () => {
    expect(() => shapeToolRequest("claude-haiku-4-5-20251001", { tool: TOOL, thinking: "off", effort: "low" })).toThrow(/claude-haiku-4-5-20251001/);
  });
});

describe("strictToolSchema", () => {
  it("adds additionalProperties:false to every object and strips unsupported keywords", () => {
    expect(strictToolSchema(TOOL.input_schema)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "number" },
        items: { type: "array", items: { type: "string" } },
        nested: { type: "object", additionalProperties: false, properties: { code: { type: "string" } } },
        kind: { type: "string", enum: ["a", "b"] },
        maybe: { type: ["integer", "null"] },
      },
      required: ["score", "items"],
    });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(TOOL.input_schema);
    strictToolSchema(TOOL.input_schema);
    expect(JSON.stringify(TOOL.input_schema)).toBe(before);
  });
});

describe("extractToolUse", () => {
  const ok = { stop_reason: "tool_use", content: [{ type: "text" }, { type: "tool_use", name: "submit_thing", input: { a: 1 } }] };

  it("returns the matching tool input", () => {
    expect(extractToolUse(ok, "submit_thing")).toEqual({ a: 1 });
  });

  it("throws ContentRejectedError on refusal, with the given message", () => {
    let e: unknown;
    try {
      extractToolUse({ stop_reason: "refusal", content: [] }, "submit_thing", { refusalMessage: "Claude refused to evaluate this answer." });
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(ContentRejectedError);
    expect((e as Error).message).toBe("Claude refused to evaluate this answer.");
  });

  it("throws NoToolCallError when no tool_use block is present", () => {
    let e: unknown;
    try {
      extractToolUse({ stop_reason: "end_turn", content: [{ type: "text" }] }, "submit_thing", { label: "Validator" });
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(NoToolCallError);
    expect((e as NoToolCallError).stopReason).toBe("end_turn");
    expect((e as Error).message).toMatch(/^Validator did not return a tool use block\. Stop reason: end_turn\./);
  });

  it("throws NoToolCallError on the wrong tool name", () => {
    expect(() =>
      extractToolUse({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "other", input: {} }] }, "submit_thing"),
    ).toThrow(/Unexpected tool name: expected "submit_thing", got "other"/);
  });
});

describe("applyShaped", () => {
  const base = {
    model: "m",
    max_tokens: 10,
    system: [{ type: "text" as const, text: "sys", cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("appends the uncached suffix after the cached block only when set", () => {
    const auto = applyShaped(base, shapeToolRequest("claude-sonnet-5-5", { tool: TOOL, thinking: "off" }));
    expect(auto.system).toEqual([base.system[0], { type: "text", text: "Respond only by calling the submit_thing tool." }]);
    const forced = applyShaped(base, shapeToolRequest("claude-sonnet-4-6", { tool: TOOL, thinking: "off" }));
    expect(forced.system).toEqual(base.system);
  });

  it("omits optional fields when absent and spreads them when present", () => {
    const bare = applyShaped(base, shapeToolRequest("claude-haiku-4-5-20251001", { tool: TOOL, thinking: "off" }));
    expect(Object.keys(bare).sort()).toEqual(["max_tokens", "messages", "model", "system", "tool_choice", "tools"]);
    const full = applyShaped(base, shapeToolRequest("claude-sonnet-4-6", { tool: TOOL, thinking: "adaptive", temperature: 0, effort: "low" }));
    expect(full.thinking).toEqual({ type: "adaptive" });
    expect(full.temperature).toBe(0);
    expect(full.output_config).toEqual({ effort: "low" });
    expect(full.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
  });
});
