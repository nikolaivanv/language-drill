import { describe, it, expect, vi } from "vitest";
import {
  generateBrainstorm,
  parseBrainstorm,
  BRAINSTORM_TOOL_NAME,
  generateVocabBoost,
  parseVocabBoost,
  VOCAB_BOOST_TOOL_NAME,
  generateStartMyParagraph,
  parseStartMyParagraph,
  START_MY_PARAGRAPH_TOOL_NAME,
} from "./writing-helper.js";
import { ExerciseType, type FreeWritingContent, Language, CefrLevel } from "@language-drill/shared";

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: "i",
  title: "El teletrabajo",
  task: "Argumenta a favor o en contra.",
  domain: "opinión",
  register: "formal",
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 20,
  requiredElements: [{ id: "c", label: "Usa dos condicionales" }],
};

function clientReturning(toolName: string, input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: toolName, input }],
      }),
    },
  } as never;
}

describe("parseBrainstorm", () => {
  it("keeps well-formed groups and drops malformed ones", () => {
    const out = parseBrainstorm({
      groups: [
        { label: "For", points: ["flexibility", "no commute"] },
        { label: "Against", points: ["isolation", 5] }, // 5 dropped
        { label: 42, points: ["x"] }, // whole group dropped (bad label)
        "nope", // dropped
      ],
    });
    expect(out.groups).toEqual([
      { label: "For", points: ["flexibility", "no commute"] },
      { label: "Against", points: ["isolation"] },
    ]);
  });

  it("returns empty groups for non-object input", () => {
    expect(parseBrainstorm(null).groups).toEqual([]);
  });
});

describe("generateBrainstorm", () => {
  it("forces the brainstorm tool and returns the parsed result", async () => {
    const client = clientReturning(BRAINSTORM_TOOL_NAME, {
      groups: [{ label: "Angle", points: ["idea one", "idea two"] }],
    });
    const result = await generateBrainstorm(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.groups).toEqual([{ label: "Angle", points: ["idea one", "idea two"] }]);

    const callArgs = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: BRAINSTORM_TOOL_NAME });
    expect(callArgs.temperature).toBe(0);
  });

  it("throws if Claude returns no tool_use block", async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [] }) },
    } as never;
    await expect(
      generateBrainstorm(client, { content, language: Language.ES, difficulty: CefrLevel.B1 }),
    ).rejects.toThrow(/tool use block/i);
  });
});

describe("parseVocabBoost", () => {
  it("keeps well-formed items and drops malformed ones", () => {
    const out = parseVocabBoost({
      items: [
        { term: "el teletrabajo", gloss: "remote work" },
        { term: "x", gloss: 9 }, // dropped
        { nope: true }, // dropped
      ],
    });
    expect(out.items).toEqual([{ term: "el teletrabajo", gloss: "remote work" }]);
  });
});

describe("generateVocabBoost", () => {
  it("forces the vocab tool and returns the parsed result", async () => {
    const client = clientReturning(VOCAB_BOOST_TOOL_NAME, {
      items: [{ term: "la flexibilidad", gloss: "flexibility" }],
    });
    const result = await generateVocabBoost(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.items).toEqual([{ term: "la flexibilidad", gloss: "flexibility" }]);
  });
});

describe("parseStartMyParagraph", () => {
  it("returns the opener string when present", () => {
    expect(parseStartMyParagraph({ opener: "Hoy en día el teletrabajo es un tema de debate." })).toEqual({
      opener: "Hoy en día el teletrabajo es un tema de debate.",
    });
  });

  it("returns an empty opener for malformed input", () => {
    expect(parseStartMyParagraph(null).opener).toBe("");
    expect(parseStartMyParagraph({ opener: 42 }).opener).toBe("");
    expect(parseStartMyParagraph({}).opener).toBe("");
  });
});

describe("generateStartMyParagraph", () => {
  it("forces the opener tool and returns the parsed result", async () => {
    const client = clientReturning(START_MY_PARAGRAPH_TOOL_NAME, {
      opener: "Hoy en día el teletrabajo se ha vuelto un tema de debate constante.",
    });
    const result = await generateStartMyParagraph(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.opener).toBe(
      "Hoy en día el teletrabajo se ha vuelto un tema de debate constante.",
    );

    const callArgs = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: START_MY_PARAGRAPH_TOOL_NAME });
    expect(callArgs.temperature).toBe(0);
  });

  it("throws if Claude returns no tool_use block", async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [] }) },
    } as never;
    await expect(
      generateStartMyParagraph(client, { content, language: Language.ES, difficulty: CefrLevel.B1 }),
    ).rejects.toThrow(/tool use block/i);
  });
});
