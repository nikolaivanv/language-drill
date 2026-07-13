import Anthropic from "@anthropic-ai/sdk";
import type { Language, WordHintUnit } from "@language-drill/shared";
import { getPromptOrFallback } from "./prompts-registry.js";
import {
  WORD_HINT_SYSTEM_PROMPT,
  WORD_HINT_PROMPT_VERSION,
  buildWordHintUserPrompt,
} from "./word-hint-prompts.js";

const MODEL = "claude-haiku-4-5-20251001" as const;
const MAX_TOKENS = 512;
export const WORD_HINT_REQUEST_TIMEOUT_MS = 15_000;
export const WORD_HINT_MAX_RETRIES = 1;

export type WordHintInput = {
  sourceText: string;
  referenceTranslation: string;
  sourceLanguage: string;
  targetLanguage: Language;
};

export const WORD_HINT_TOOL_NAME = "submit_word_hints";
export const WORD_HINT_TOOL: Anthropic.Tool = {
  name: WORD_HINT_TOOL_NAME,
  description: "Submit the ordered word-hint units covering the English source sentence.",
  input_schema: {
    type: "object" as const,
    properties: {
      units: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Exact English source slice for this unit." },
            hintable: { type: "boolean", description: "True only for meaningful vocabulary units." },
            lemma: { type: "string", description: "Target dictionary form; omit when hintable is false." },
          },
          required: ["text", "hintable"],
        },
      },
    },
    required: ["units"],
  },
};

export function parseWordHints(input: unknown): WordHintUnit[] {
  if (typeof input !== "object" || input === null) return [];
  const units = (input as Record<string, unknown>).units;
  if (!Array.isArray(units)) return [];
  const out: WordHintUnit[] = [];
  for (const raw of units) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== "string" || typeof r.hintable !== "boolean") continue;
    if (r.hintable && typeof r.lemma === "string" && r.lemma.length > 0) {
      out.push({ text: r.text, hintable: true, lemma: r.lemma });
    } else {
      out.push({ text: r.text, hintable: false });
    }
  }
  return out;
}

export async function generateWordHints(
  client: Anthropic,
  input: WordHintInput,
): Promise<WordHintUnit[]> {
  const resolved = await getPromptOrFallback(
    "word-hint-system-prompt",
    WORD_HINT_SYSTEM_PROMPT,
    WORD_HINT_PROMPT_VERSION,
  );
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: buildWordHintUserPrompt(input) }],
    tools: [WORD_HINT_TOOL],
    tool_choice: { type: "tool" as const, name: WORD_HINT_TOOL_NAME },
    temperature: 0,
  });
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) {
    throw new Error(`Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`);
  }
  return parseWordHints(block.input);
}
