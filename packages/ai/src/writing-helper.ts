/**
 * packages/ai — Free Writing helper generators (Brainstorm + Vocab boost).
 * Both force a tool call and return a small structured result. Parsers are
 * forgiving: malformed entries are dropped, not fatal. Mirrors
 * free-writing-evaluate.ts but with a smaller token budget.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FreeWritingContent, CefrLevel, Language } from "@language-drill/shared";
import { getPromptOrFallback } from "./prompts-registry.js";
import {
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  buildBrainstormUserPrompt,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  buildVocabBoostUserPrompt,
} from "./writing-helper-prompts.js";

const MODEL = "claude-sonnet-4-6" as const;
const MAX_TOKENS = 1024;
export const WRITING_HELPER_REQUEST_TIMEOUT_MS = 20_000;
export const WRITING_HELPER_MAX_RETRIES = 1;

export type WritingHelperInput = {
  content: FreeWritingContent;
  language: Language;
  difficulty: CefrLevel;
};

// ── Shared tool runner ───────────────────────────────────────────────────────
async function runHelperTool<T>(
  client: Anthropic,
  opts: {
    promptName: string;
    fallbackPrompt: string;
    version: string;
    userPrompt: string;
    tool: Anthropic.Tool;
    toolName: string;
    parse: (input: unknown) => T;
  },
): Promise<T> {
  const resolved = await getPromptOrFallback(opts.promptName, opts.fallbackPrompt, opts.version);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: opts.userPrompt }],
    tools: [opts.tool],
    tool_choice: { type: "tool" as const, name: opts.toolName },
    temperature: 0,
  });
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) {
    throw new Error(`Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`);
  }
  if (block.name !== opts.toolName) {
    throw new Error(`Unexpected tool name: expected "${opts.toolName}", got "${block.name}"`);
  }
  return opts.parse(block.input);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

// ── Brainstorm ───────────────────────────────────────────────────────────────
export const BRAINSTORM_TOOL_NAME = "submit_brainstorm";
export const BRAINSTORM_TOOL: Anthropic.Tool = {
  name: BRAINSTORM_TOOL_NAME,
  description: "Submit 2–3 brainstorm angle groups of short English idea bullets.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short English label (2–4 words)." },
            points: { type: "array", items: { type: "string" }, description: "2–4 English idea bullets." },
          },
          required: ["label", "points"],
        },
      },
    },
    required: ["groups"],
  },
};

export type BrainstormResult = { groups: { label: string; points: string[] }[] };

export function parseBrainstorm(input: unknown): BrainstormResult {
  if (typeof input !== "object" || input === null) return { groups: [] };
  const raw = (input as Record<string, unknown>).groups;
  if (!Array.isArray(raw)) return { groups: [] };
  const groups: { label: string; points: string[] }[] = [];
  for (const g of raw) {
    if (typeof g !== "object" || g === null) continue;
    const o = g as Record<string, unknown>;
    if (typeof o.label !== "string") continue;
    groups.push({ label: o.label, points: strArray(o.points) });
  }
  return { groups };
}

export async function generateBrainstorm(
  client: Anthropic,
  input: WritingHelperInput,
): Promise<BrainstormResult> {
  return runHelperTool(client, {
    promptName: "free-writing-brainstorm-system-prompt",
    fallbackPrompt: BRAINSTORM_SYSTEM_PROMPT,
    version: BRAINSTORM_PROMPT_VERSION,
    userPrompt: buildBrainstormUserPrompt(input.content, input.language, input.difficulty),
    tool: BRAINSTORM_TOOL,
    toolName: BRAINSTORM_TOOL_NAME,
    parse: parseBrainstorm,
  });
}

// ── Vocab boost ──────────────────────────────────────────────────────────────
export const VOCAB_BOOST_TOOL_NAME = "submit_vocab_boost";
export const VOCAB_BOOST_TOOL: Anthropic.Tool = {
  name: VOCAB_BOOST_TOOL_NAME,
  description: "Submit 8–10 target-language words/phrases, each with a short English gloss.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Target-language word or phrase." },
            gloss: { type: "string", description: "Short English meaning (<= 6 words)." },
          },
          required: ["term", "gloss"],
        },
      },
    },
    required: ["items"],
  },
};

export type VocabBoostResult = { items: { term: string; gloss: string }[] };

export function parseVocabBoost(input: unknown): VocabBoostResult {
  if (typeof input !== "object" || input === null) return { items: [] };
  const raw = (input as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return { items: [] };
  const items: { term: string; gloss: string }[] = [];
  for (const it of raw) {
    if (typeof it !== "object" || it === null) continue;
    const o = it as Record<string, unknown>;
    if (typeof o.term !== "string" || typeof o.gloss !== "string") continue;
    items.push({ term: o.term, gloss: o.gloss });
  }
  return { items };
}

export async function generateVocabBoost(
  client: Anthropic,
  input: WritingHelperInput,
): Promise<VocabBoostResult> {
  return runHelperTool(client, {
    promptName: "free-writing-vocab-boost-system-prompt",
    fallbackPrompt: VOCAB_BOOST_SYSTEM_PROMPT,
    version: VOCAB_BOOST_PROMPT_VERSION,
    userPrompt: buildVocabBoostUserPrompt(input.content, input.language, input.difficulty),
    tool: VOCAB_BOOST_TOOL,
    toolName: VOCAB_BOOST_TOOL_NAME,
    parse: parseVocabBoost,
  });
}
