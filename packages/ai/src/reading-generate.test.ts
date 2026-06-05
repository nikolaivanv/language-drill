import { describe, it, expect, vi } from "vitest";
import { Language, CefrLevel, ReadingTextLength } from "@language-drill/shared";
import {
  generateReadingText,
  SUBMIT_READING_TEXT_TOOL,
  READING_GENERATION_MODEL,
} from "./reading-generate.js";

function mockClient(textsInOrder: string[]) {
  const create = vi.fn();
  for (const text of textsInOrder) {
    create.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: SUBMIT_READING_TEXT_TOOL.name,
          input: { title: "Title", text },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }
  return { messages: { create } } as any;
}

describe("READING_GENERATION_MODEL", () => {
  it("is pinned to Sonnet", () => {
    expect(READING_GENERATION_MODEL).toBe("claude-sonnet-4-6");
  });
});

describe("generateReadingText", () => {
  it("returns the generated text + title + difficulty score on first pass", async () => {
    const client = mockClient([
      "El gato es bonito. La casa es grande. El perro bebe agua. La mujer es buena.",
    ]);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: "a cat",
    });
    expect(result.text).toContain("gato");
    expect(result.title).toBe("Title");
    expect(result.difficultyScore).toBeGreaterThanOrEqual(0);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("regenerates once when the first draft is too hard", async () => {
    const hard = "Idiosincrasia epistemológica hermenéutica contemporánea subvierte paradigma.";
    const easy = "La casa es grande y bonita. El perro bebe agua. La mujer es buena.";
    const client = mockClient([hard, easy]);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: "a cat",
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(easy);
    expect(result.regenerated).toBe(true);
  });

  it("keeps the second draft even if still hard, flagging runsHard", async () => {
    const hard1 = "Idiosincrasia epistemológica hermenéutica contemporánea subvierte.";
    const hard2 = "Paradigma ontológico fenomenológico dialéctico trascendental.";
    const client = mockClient([hard1, hard2]);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: "a cat",
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(hard2);
    expect(result.runsHard).toBe(true);
  });
});
