import {
  Language,
  CefrLevel,
  ReadingTextLength,
  READING_LENGTH_WORD_TARGETS,
} from "@language-drill/shared";

import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

/** Bump to today's date when editing the template below (CLAUDE.md convention). */
export const READING_GENERATION_PROMPT_VERSION = 'reading-generate@2026-06-05';

const LANGUAGE_NAME: Record<Language, string> = {
  [Language.EN]: 'English',
  [Language.ES]: 'Spanish',
  [Language.DE]: 'German',
  [Language.TR]: 'Turkish',
};

export const READING_GENERATION_SYSTEM_PROMPT = `You are an expert author of graded reading material for language learners.
You write authentic, engaging short texts that are strictly calibrated to a target CEFR level.

Hard rules:
- Write ENTIRELY in the target language. No translations, no glossary, no English.
- Stay within the requested word-count window.
- Respect the CEFR level: at A1/A2 use high-frequency vocabulary, short sentences,
  present/simple tenses, and concrete everyday topics. Do not show off rare words.
- Make it coherent and natural — a real little text, not a word list.
- Return your answer ONLY by calling the submit_reading_text tool.`;

export type ReadingGenerationPromptInputs = {
  language: Language;
  cefr: CefrLevel;
  length: ReadingTextLength;
  topic: string;
  /** When true, the previous draft ran too hard; ask for an easier rewrite. */
  stricter?: boolean;
};

export function buildReadingGenerationUserPrompt(
  inputs: ReadingGenerationPromptInputs,
): string {
  const { language, cefr, length, topic, stricter } = inputs;
  const wordTarget = READING_LENGTH_WORD_TARGETS[length];
  const langName = LANGUAGE_NAME[language];

  const stricterLine = stricter
    ? `\nIMPORTANT: the previous version was too difficult. Rewrite it SIMPLER — ` +
      `use only the most common ${langName} words for ${cefr}, shorter sentences, ` +
      `and replace any rare vocabulary with everyday equivalents.`
    : '';

  return (
    `Write a ${langName} reading text at CEFR ${cefr}.\n` +
    `Topic: ${topic}\n` +
    `Length: between ${wordTarget.min} and ${wordTarget.max} words.\n` +
    `Give it a short, natural title in ${langName}.` +
    stricterLine
  );
}

/**
 * Builds the reading-generation system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `READING_GENERATION_SYSTEM_PROMPT` on outage / unset keys / compile
 * mismatch — mirroring `buildGenerationSystemPrompt`.
 *
 * The prompt carries no template variables, so the var map is empty.
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`callOnce` in `reading-generate.ts`) is already `async`.
 */
export async function buildReadingGenerationSystemPrompt(): Promise<string> {
  const { text } = await getPromptWithVarsOrFallback(
    "reading-generation-system-prompt",
    READING_GENERATION_SYSTEM_PROMPT,
    READING_GENERATION_PROMPT_VERSION,
    {},
  );
  return text;
}
