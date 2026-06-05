import type Anthropic from "@anthropic-ai/sdk";
import {
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import {
  buildReadingGenerationSystemPrompt,
  buildReadingGenerationUserPrompt,
} from "./reading-generation-prompts.js";
import { scoreTextLevel } from "./reading-level-check.js";

export const READING_GENERATION_MODEL = "claude-sonnet-4-6" as const;
export const READING_GENERATION_MAX_TOKENS = 1024;
export const READING_GENERATION_TEMPERATURE = 0.7;

export const SUBMIT_READING_TEXT_TOOL: Anthropic.Tool = {
  name: "submit_reading_text",
  description: "Submit the generated reading text and its title.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "A short, natural title in the target language.",
      },
      text: {
        type: "string",
        description: "The reading text, entirely in the target language.",
      },
    },
    required: ["title", "text"],
  },
};

export type GenerateReadingTextInput = {
  language: LearningLanguage;
  cefr: CefrLevel;
  length: ReadingTextLength;
  topic: string;
};

export type GenerateReadingTextResult = {
  title: string;
  text: string;
  /** aboveLevelFraction of the returned text, in [0,1]. */
  difficultyScore: number;
  /** True when a second (stricter) pass was made. */
  regenerated: boolean;
  /** True when the final returned text still exceeds the too-hard threshold. */
  runsHard: boolean;
};

type Draft = { title: string; text: string };

async function callOnce(
  client: Anthropic,
  input: GenerateReadingTextInput,
  stricter: boolean,
  signal?: AbortSignal,
): Promise<Draft> {
  const response = await client.messages.create(
    {
      model: READING_GENERATION_MODEL,
      max_tokens: READING_GENERATION_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: buildReadingGenerationSystemPrompt(),
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [
        {
          role: "user" as const,
          content: buildReadingGenerationUserPrompt({ ...input, stricter }),
        },
      ],
      tools: [SUBMIT_READING_TEXT_TOOL],
      tool_choice: { type: "tool" as const, name: SUBMIT_READING_TEXT_TOOL.name },
      temperature: READING_GENERATION_TEMPERATURE,
    },
    { signal },
  );

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === SUBMIT_READING_TEXT_TOOL.name,
  );
  if (!block) {
    throw new Error(
      `reading generation returned no tool_use block (stop_reason=${response.stop_reason})`,
    );
  }
  const parsed = block.input as { title?: unknown; text?: unknown };
  if (typeof parsed.text !== "string" || parsed.text.trim() === "") {
    throw new Error("reading generation returned an empty text");
  }
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    text: parsed.text,
  };
}

/**
 * Generate a level-calibrated reading text. Runs the deterministic level check
 * and, if the first draft is too hard, regenerates once with a stricter prompt.
 * Always returns a text — `runsHard` signals the caller to surface a soft note.
 */
export async function generateReadingText(
  client: Anthropic,
  input: GenerateReadingTextInput,
  signal?: AbortSignal,
): Promise<GenerateReadingTextResult> {
  if (input.topic.length > READING_GEN_TOPIC_MAX_CHARS) {
    throw new Error("topic exceeds READING_GEN_TOPIC_MAX_CHARS");
  }

  const first = await callOnce(client, input, false, signal);
  const firstScore = scoreTextLevel({
    language: input.language,
    cefr: input.cefr,
    text: first.text,
  });

  if (!firstScore.tooHard) {
    return {
      title: first.title,
      text: first.text,
      difficultyScore: firstScore.aboveLevelFraction,
      regenerated: false,
      runsHard: false,
    };
  }

  const second = await callOnce(client, input, true, signal);
  const secondScore = scoreTextLevel({
    language: input.language,
    cefr: input.cefr,
    text: second.text,
  });

  return {
    title: second.title,
    text: second.text,
    difficultyScore: secondScore.aboveLevelFraction,
    regenerated: true,
    runsHard: secondScore.tooHard,
  };
}
