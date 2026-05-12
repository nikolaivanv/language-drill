import { describe, it, expect, vi, beforeEach } from "vitest";
import { CefrLevel, Language } from "@language-drill/shared";
import {
  ANNOTATE_SYSTEM_PROMPT,
  ANNOTATE_TOOL,
  ANNOTATE_TOOL_NAME,
  annotateText,
  parseAnnotateResult,
  type AnnotateInput,
} from "./annotate.js";
import { createClaudeClient } from "./index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validFlag = {
  matchedForm: "aldea",
  lemma: "aldea",
  pos: "noun",
  gloss: "small village",
  example: "Visitamos la aldea ayer.",
  freq: 4200,
  cefr: "B2" as const,
};

const validToolInput = {
  flagged: [
    validFlag,
    {
      matchedForm: "indiferencia",
      lemma: "indiferencia",
      pos: "noun",
      gloss: "indifference",
      example: "Su indiferencia me sorprendió.",
      freq: 5800,
      cefr: "B2" as const,
    },
  ],
};

const annotateInput: AnnotateInput = {
  text: "La aldea recibió al pintor con cierta indiferencia.",
  language: Language.ES,
  proficiencyLevel: CefrLevel.B1,
  topRank: 3000,
};

// ---------------------------------------------------------------------------
// ANNOTATE_TOOL schema
// ---------------------------------------------------------------------------

describe("ANNOTATE_TOOL", () => {
  it("uses the canonical tool name", () => {
    expect(ANNOTATE_TOOL.name).toBe("submit_annotated_words");
    expect(ANNOTATE_TOOL_NAME).toBe("submit_annotated_words");
  });

  it("requires a `flagged` array on the top-level schema", () => {
    expect(ANNOTATE_TOOL.input_schema.required).toEqual(["flagged"]);
    const flagged = (
      ANNOTATE_TOOL.input_schema.properties as Record<string, { type: string }>
    ).flagged;
    expect(flagged.type).toBe("array");
  });

  it("requires the seven WordFlag fields per item", () => {
    const props = ANNOTATE_TOOL.input_schema.properties as Record<
      string,
      { items: { required: string[] } }
    >;
    const itemRequired = props.flagged.items.required;
    expect(itemRequired).toEqual(
      expect.arrayContaining([
        "matchedForm",
        "lemma",
        "pos",
        "gloss",
        "example",
        "freq",
        "cefr",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// ANNOTATE_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe("ANNOTATE_SYSTEM_PROMPT", () => {
  it("frames the task as enrichment, not selection (task 12 rewrite)", () => {
    // Selection happens server-side now; Claude only enriches the words it
    // receives. The rewritten prompt must not still tell Claude to filter.
    expect(ANNOTATE_SYSTEM_PROMPT).toMatch(/Enrichment Task/);
    expect(ANNOTATE_SYSTEM_PROMPT).toMatch(/list of words/);
    expect(ANNOTATE_SYSTEM_PROMPT).not.toMatch(/top_rank/);
    expect(ANNOTATE_SYSTEM_PROMPT).not.toMatch(/Selection Rule/);
  });

  it("still names closed-class words in the per-language guidance", () => {
    // Per-language hints continue to mention closed-class examples ("la", "der",
    // "ve", etc.) for matchedForm-vs-lemma intuition — selection wording is gone
    // but the linguistic guidance stays.
    expect(ANNOTATE_SYSTEM_PROMPT).toMatch(/closed-class/);
  });

  it("requires lowercased exact matchedForm", () => {
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("matchedForm");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("lowercased");
  });

  it("includes per-language one-shot guidance for ES, DE, TR", () => {
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("Spanish (ES)");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("German (DE)");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("Turkish (TR)");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("aldea");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("Wirtschaftsaufschwung");
    expect(ANNOTATE_SYSTEM_PROMPT).toContain("davranışlarıyla");
  });
});

// ---------------------------------------------------------------------------
// parseAnnotateResult
// ---------------------------------------------------------------------------

describe("parseAnnotateResult", () => {
  it("accepts the shape returned by the tool and keys by matchedForm", () => {
    const result = parseAnnotateResult(validToolInput);
    expect(Object.keys(result.flagged).sort()).toEqual([
      "aldea",
      "indiferencia",
    ]);
    expect(result.flagged.aldea.lemma).toBe("aldea");
    expect(result.flagged.aldea.cefr).toBe("B2");
    // matchedForm is destructured out — it must NOT leak into WordFlag values.
    expect(
      (result.flagged.aldea as unknown as Record<string, unknown>).matchedForm,
    ).toBeUndefined();
  });

  it("accepts an empty flagged array (in-level passage)", () => {
    expect(parseAnnotateResult({ flagged: [] }).flagged).toEqual({});
  });

  it("dedupes duplicate matchedForm by first-seen", () => {
    const result = parseAnnotateResult({
      flagged: [
        validFlag,
        {
          ...validFlag,
          // same matchedForm but a different lemma — the second must be dropped
          lemma: "aldeas",
          gloss: "small villages",
        },
      ],
    });
    expect(Object.keys(result.flagged)).toEqual(["aldea"]);
    expect(result.flagged.aldea.lemma).toBe("aldea");
    expect(result.flagged.aldea.gloss).toBe("small village");
  });

  it("rejects null/non-object input", () => {
    expect(() => parseAnnotateResult(null)).toThrow();
    expect(() => parseAnnotateResult("oops")).toThrow();
  });

  it("rejects when flagged is not an array (and surfaces typeof + keys for diagnostics)", () => {
    expect(() => parseAnnotateResult({ flagged: "no" })).toThrow(
      /flagged must be an array.*typeof string.*keys: \[flagged\]/i,
    );
    // Missing key — covers the truncation-shaped `{}` payload.
    expect(() => parseAnnotateResult({})).toThrow(
      /flagged must be an array.*typeof undefined.*keys: \[\]/i,
    );
  });

  it("rejects flags missing required fields", () => {
    expect(() =>
      parseAnnotateResult({
        flagged: [{ matchedForm: "aldea", lemma: "aldea" }],
      }),
    ).toThrow();
  });

  it("rejects flags with an empty matchedForm", () => {
    expect(() =>
      parseAnnotateResult({
        flagged: [{ ...validFlag, matchedForm: "" }],
      }),
    ).toThrow();
  });

  it("rejects flags with an out-of-range cefr value", () => {
    expect(() =>
      parseAnnotateResult({
        flagged: [{ ...validFlag, cefr: "D1" }],
      }),
    ).toThrow();
  });

  it("rejects flags with a negative freq", () => {
    expect(() =>
      parseAnnotateResult({
        flagged: [{ ...validFlag, freq: -1 }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// annotateText (mocked SDK)
// ---------------------------------------------------------------------------

describe("annotateText", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createClaudeClient>;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("registers the system prompt with cache_control: ephemeral", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: ANNOTATE_TOOL_NAME,
          input: validToolInput,
        },
      ],
      stop_reason: "tool_use",
    });

    await annotateText(mockClient, annotateInput);

    const args = mockCreate.mock.calls[0][0];
    expect(args.system).toEqual([
      {
        type: "text",
        text: ANNOTATE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("forces tool use of submit_annotated_words at temperature 0", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_2",
          name: ANNOTATE_TOOL_NAME,
          input: validToolInput,
        },
      ],
      stop_reason: "tool_use",
    });

    await annotateText(mockClient, annotateInput);

    const args = mockCreate.mock.calls[0][0];
    expect(args.tools).toEqual([ANNOTATE_TOOL]);
    expect(args.tool_choice).toEqual({
      type: "tool",
      name: ANNOTATE_TOOL_NAME,
    });
    expect(args.temperature).toBe(0);
  });

  it("injects language, proficiency, top_rank and the passage into the user message", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_3",
          name: ANNOTATE_TOOL_NAME,
          input: { flagged: [] },
        },
      ],
      stop_reason: "tool_use",
    });

    await annotateText(mockClient, annotateInput);

    const userMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userMsg).toContain("ES");
    expect(userMsg).toContain("B1");
    expect(userMsg).toContain("3000");
    expect(userMsg).toContain(annotateInput.text);
  });

  it("returns the parsed AnnotateOutput keyed by matchedForm", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_4",
          name: ANNOTATE_TOOL_NAME,
          input: validToolInput,
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await annotateText(mockClient, annotateInput);

    expect(Object.keys(result.flagged).sort()).toEqual([
      "aldea",
      "indiferencia",
    ]);
  });

  it("throws when Claude returns no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot annotate this." }],
      stop_reason: "end_turn",
    });

    await expect(annotateText(mockClient, annotateInput)).rejects.toThrow(
      /tool use block/,
    );
  });

  it("throws when Claude returns the wrong tool name", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_5",
          name: "wrong_tool",
          input: validToolInput,
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(annotateText(mockClient, annotateInput)).rejects.toThrow(
      /Unexpected tool name/,
    );
  });

  it("throws on malformed tool input (route maps to 502 AI_UNAVAILABLE)", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_6",
          name: ANNOTATE_TOOL_NAME,
          input: { flagged: [{ matchedForm: "aldea" }] },
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(annotateText(mockClient, annotateInput)).rejects.toThrow();
  });

  it("propagates SDK errors", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));
    await expect(annotateText(mockClient, annotateInput)).rejects.toThrow(
      "API rate limit exceeded",
    );
  });

  // Truncation: SDK aggregates partial input_json_delta chunks into
  // `input` when stop_reason flips to "max_tokens" mid-tool-call. The
  // resulting payload is either an empty object or one where `flagged`
  // is missing/non-array. The caller must short-circuit with a named
  // error before the generic parser throw swallows the signal.
  describe("max_tokens truncation", () => {
    it("throws a dedicated truncation error when stop_reason is max_tokens (empty input)", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "toolu_trunc_1",
            name: ANNOTATE_TOOL_NAME,
            input: {},
          },
        ],
        stop_reason: "max_tokens",
      });

      await expect(annotateText(mockClient, annotateInput)).rejects.toThrow(
        /truncated by max_tokens/i,
      );
    });

    it("throws the truncation error even if `flagged` is present-but-null", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "toolu_trunc_2",
            name: ANNOTATE_TOOL_NAME,
            input: { flagged: null },
          },
        ],
        stop_reason: "max_tokens",
      });

      await expect(annotateText(mockClient, annotateInput)).rejects.toThrow(
        /truncated by max_tokens/i,
      );
    });
  });
});
