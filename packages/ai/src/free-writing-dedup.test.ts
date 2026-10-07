import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ExerciseType } from "@language-drill/shared";

import {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  freeWritingHistoryLine,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  parseFreeWritingDedupVerdict,
} from "./index.js";

const FW = (over: Record<string, unknown> = {}) => ({
  type: ExerciseType.FREE_WRITING,
  instructions: "x",
  title: "El teletrabajo y la soledad",
  task: "Explica si trabajar desde casa\n  aísla a las personas.",
  domain: "opinión",
  register: "neutral",
  minWords: 120,
  maxWords: 180,
  requiredElements: [
    { id: "a", label: "Da tu opinión" },
    { id: "b", label: "Usa dos conectores" },
  ],
  ...over,
});

describe("freeWritingSummary", () => {
  it("extracts title, collapsed task and required-element labels", () => {
    expect(freeWritingSummary(FW())).toEqual({
      title: "El teletrabajo y la soledad",
      task: "Explica si trabajar desde casa aísla a las personas.",
      requiredElements: ["Da tu opinión", "Usa dos conectores"],
    });
  });

  it("returns null for non-free-writing or missing title/task", () => {
    expect(freeWritingSummary(null)).toBeNull();
    expect(freeWritingSummary({ type: ExerciseType.CLOZE, sentence: "x" })).toBeNull();
    expect(freeWritingSummary(FW({ title: "  " }))).toBeNull();
    expect(freeWritingSummary(FW({ task: 7 }))).toBeNull();
  });

  it("tolerates malformed requiredElements by dropping bad entries", () => {
    expect(freeWritingSummary(FW({ requiredElements: [{ label: "ok" }, { label: 3 }, "x"] }))?.requiredElements)
      .toEqual(["ok"]);
    expect(freeWritingSummary(FW({ requiredElements: "nope" }))?.requiredElements).toEqual([]);
  });
});

describe("freeWritingHistoryLine", () => {
  it("joins title and task with an em dash", () => {
    expect(freeWritingHistoryLine({ title: "T", task: "Do X.", requiredElements: [] })).toBe("T — Do X.");
  });

  it("truncates the task to 200 characters with an ellipsis", () => {
    const line = freeWritingHistoryLine({ title: "T", task: "a".repeat(250), requiredElements: [] });
    expect(line).toBe(`T — ${"a".repeat(200)}…`);
  });
});

describe("free-writing dedup prompt", () => {
  it("states the essay-level rule and the A1/A2 exception", () => {
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain("would write essentially the same essay");
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain("A1 and A2");
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain(FREE_WRITING_DEDUP_TOOL_NAME);
  });

  it("has a dated version", () => {
    expect(FREE_WRITING_DEDUP_PROMPT_VERSION).toMatch(/^free-writing-dedup@\d{4}-\d{2}-\d{2}$/);
  });

  it("renders the candidate and every existing prompt with its index", () => {
    const text = buildFreeWritingDedupUserPrompt({
      cefrLevel: "B2",
      candidate: { title: "C", task: "Candidate task.", requiredElements: ["r1"] },
      existing: [
        { title: "E0", task: "First.", requiredElements: [] },
        { title: "E1", task: "Second.", requiredElements: ["x", "y"] },
      ],
    });
    expect(text).toContain("CEFR level: B2");
    expect(text).toContain("Title: C");
    expect(text).toContain("Task: Candidate task.");
    expect(text).toContain("[0] Title: E0");
    expect(text).toContain("[1] Title: E1");
    expect(text).toContain("Required elements: x; y");
  });
});

describe("parseFreeWritingDedupVerdict", () => {
  it("accepts null and in-range integers", () => {
    expect(parseFreeWritingDedupVerdict({ duplicateOf: null, reason: "new essay" }, 2)).toEqual({
      duplicateOf: null,
      reason: "new essay",
    });
    expect(parseFreeWritingDedupVerdict({ duplicateOf: 1, reason: "same" }, 2)).toEqual({
      duplicateOf: 1,
      reason: "same",
    });
  });

  it("treats a missing duplicateOf as null and a missing reason as empty", () => {
    expect(parseFreeWritingDedupVerdict({}, 2)).toEqual({ duplicateOf: null, reason: "" });
  });

  it("throws on an out-of-range or non-integer index", () => {
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: 2, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: -1, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: 0.5, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: "0", reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict("x", 2)).toThrow();
  });
});

describe("judgeFreeWritingDuplicate", () => {
  const candidate = { title: "C", task: "Task.", requiredElements: [] };

  it("does not call Claude when there are no existing prompts", async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;
    const out = await judgeFreeWritingDuplicate(client, { candidate, existing: [], cefrLevel: "B1" });
    expect(create).not.toHaveBeenCalled();
    expect(out.result.duplicateOf).toBeNull();
    expect(out.tokenUsage.inputTokens).toBe(0);
  });

  it("forces the verdict tool, uses the given model, and returns usage", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "tool_use", name: FREE_WRITING_DEDUP_TOOL_NAME, input: { duplicateOf: 0, reason: "same essay" } }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const out = await judgeFreeWritingDuplicate(
      client,
      { candidate, existing: [{ title: "E", task: "T.", requiredElements: [] }], cefrLevel: "B1" },
      { model: "claude-opus-4-8" },
    );
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-4-8");
    expect(req.tool_choice).toEqual({ type: "tool", name: FREE_WRITING_DEDUP_TOOL_NAME });
    expect(out.result).toEqual({ duplicateOf: 0, reason: "same essay" });
    expect(out.tokenUsage.inputTokens).toBe(100);
  });

  it("throws when Claude returns no tool call", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [] });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(
      judgeFreeWritingDuplicate(client, { candidate, existing: [{ title: "E", task: "T.", requiredElements: [] }], cefrLevel: "B1" }),
    ).rejects.toThrow();
  });

  describe("per-model request shaping", () => {
    const run = async (model?: string) => {
      const create = vi.fn().mockResolvedValue({
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", name: FREE_WRITING_DEDUP_TOOL_NAME, input: { duplicateOf: null, reason: "" } }],
      });
      const client = { messages: { create } } as unknown as Anthropic;
      await judgeFreeWritingDuplicate(
        client,
        { candidate, existing: [{ title: "E", task: "T.", requiredElements: [] }], cefrLevel: "B1" },
        model ? { model } : {},
      );
      return create.mock.calls[0][0] as Record<string, unknown>;
    };

    it("default model sends temperature 0 and no thinking", async () => {
      const req = await run();
      expect(req.temperature).toBe(0);
      expect("thinking" in req).toBe(false);
    });

    it("opus-4-8 omits temperature", async () => {
      const req = await run("claude-opus-4-8");
      expect("temperature" in req).toBe(false);
    });

    it("sonnet-5-5 omits temperature and disables thinking", async () => {
      const req = await run("claude-sonnet-5-5");
      expect("temperature" in req).toBe(false);
      expect(req.thinking).toEqual({ type: "disabled" });
    });
  });
});
