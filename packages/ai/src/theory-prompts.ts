/**
 * packages/ai — Prompt builders for the theory topic generator.
 *
 * Pure functions; no I/O. The system prompt is what gets cached via Anthropic
 * prompt caching when the generator runs a cell — see theory-generate.ts for
 * how it's wired up. Two calls with the same inputs MUST return byte-identical
 * strings (Req 2.3), otherwise prompt caching cannot hit.
 */

import {
  type CurriculumCefrLevel,
  type GrammarPoint,
  Language,
  LANGUAGE_NAMES,
} from "@language-drill/shared";

import { THEORY_TOOL_NAME } from "./theory-generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// The THEORY_TOOL_NAME import comes from theory-generate.ts. The two modules
// form a circular import on paper — theory-generate.ts will import from this
// file in Task 4 — but neither side dereferences the other at module init:
// prompt builders are runtime functions, and theory-generate.ts's module-init
// computations don't reach into theory-prompts.ts. ESM handles this case
// correctly (same shape as the generate.ts ↔ generation-prompts.ts cycle
// documented at generation-prompts.ts:21-25).

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type TheoryPromptInputs = {
  language: Exclude<Language, Language.EN>;
  cefrLevel: CurriculumCefrLevel;
  grammarPoint: GrammarPoint;
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

// Bump in the same commit as any semantic edit to the theory-generation
// system prompt (this file's `buildTheorySystemPrompt`). Drives the
// Langfuse trace `promptVersion` tag — dashboards cohort old vs. new
// prompt traces by this string.
export const THEORY_GENERATION_PROMPT_VERSION = "theory-generate@2026-05-12";

/**
 * Phase-2 Langfuse-registered template. Identical to the body
 * `buildTheorySystemPrompt` returns, with every interpolation replaced
 * by a `{{flatVar}}` placeholder consumable by both `applyTemplate`
 * (in-code fallback) and Langfuse's Mustache.js `compile(vars)` (live
 * fetch). The `THEORY_SYSTEM_PROMPT_TEMPLATE byte parity` test block
 * asserts `applyTemplate(TEMPLATE, computeTheoryPromptVars(inputs)).text
 * === buildTheorySystemPrompt(inputs)` so any drift between the template
 * and the live builder is caught at PR time.
 */
export const THEORY_SYSTEM_PROMPT_TEMPLATE = `You are an expert author of grammar reference material for {{languageName}} learners at CEFR {{cefrLevel}}. Your job is to produce one complete theory page that explains exactly one grammar point: {{grammarPointName}}.

## Grammar point context

{{grammarPointDescription}}

## Positive examples (use these — verbatim or paraphrased — in your "examples in context" section)

{{positiveExamplesBullets}}

## Common learner errors (address each in your "common pitfalls" section)

{{commonErrorsBullets}}

## Required sections (in this order)

1. what is it? — a single paragraph defining the concept
2. when to use it — bullets or short paragraphs covering the trigger conditions
3. formation — how the form is built (use a conjugation-table block when applicable)
4. examples in context — at least three example blocks, each with a target line + English + a one-line note where useful
5. common pitfalls — a list block addressing every entry in commonErrors

## Voice

Editorial. Concise. Lowercase headings. Treat the reader as an adult. No padding, no encouragement, no emojis.

## Output format

Call the {{toolName}} tool exactly once with the structured topic. Each section.body is an array of typed blocks (paragraph, callout, example, list, conjugation-table). Inline emphasis goes through the inline-node union (text, strong, em, hilite, mono) — do not use raw HTML or markdown.`;

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `THEORY_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder so the
 * Task-15 snapshot parity test can exercise the same computation the
 * builder does (Task 16's async refactor will route both through it).
 */
export function computeTheoryPromptVars(
  inputs: TheoryPromptInputs,
): Record<string, string> {
  const { language, cefrLevel, grammarPoint } = inputs;
  return {
    languageName: LANGUAGE_NAMES[language],
    cefrLevel,
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    toolName: THEORY_TOOL_NAME,
  };
}

/**
 * Builds the theory-generator system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `THEORY_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys / compile
 * mismatch. Byte parity between the two paths is pinned by the
 * `THEORY_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`generateTheoryTopic` in `theory-generate.ts`) is already `async`.
 */
export async function buildTheorySystemPrompt(
  inputs: TheoryPromptInputs,
): Promise<string> {
  const vars = computeTheoryPromptVars(inputs);
  const { text } = await getPromptWithVarsOrFallback(
    "theory-generate-system-prompt",
    THEORY_SYSTEM_PROMPT_TEMPLATE,
    THEORY_GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

// ---------------------------------------------------------------------------
// User prompt — short per-call message; the system prompt is the heavy lift.
// ---------------------------------------------------------------------------

export function buildTheoryUserPrompt(inputs: TheoryPromptInputs): string {
  return `Produce the theory page for ${inputs.grammarPoint.name} (${inputs.grammarPoint.key}) at CEFR ${inputs.cefrLevel}.`;
}
