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

export function buildTheorySystemPrompt(inputs: TheoryPromptInputs): string {
  const { language, cefrLevel, grammarPoint } = inputs;
  const languageName = LANGUAGE_NAMES[language];

  return `You are an expert author of grammar reference material for ${languageName} learners at CEFR ${cefrLevel}. Your job is to produce one complete theory page that explains exactly one grammar point: ${grammarPoint.name}.

## Grammar point context

${grammarPoint.description}

## Positive examples (use these — verbatim or paraphrased — in your "examples in context" section)

${renderBulletList(grammarPoint.examplesPositive)}

## Common learner errors (address each in your "common pitfalls" section)

${renderBulletList(grammarPoint.commonErrors)}

## Required sections (in this order)

1. what is it? — a single paragraph defining the concept
2. when to use it — bullets or short paragraphs covering the trigger conditions
3. formation — how the form is built (use a conjugation-table block when applicable)
4. examples in context — at least three example blocks, each with a target line + English + a one-line note where useful
5. common pitfalls — a list block addressing every entry in commonErrors

## Voice

Editorial. Concise. Lowercase headings. Treat the reader as an adult. No padding, no encouragement, no emojis.

## Output format

Call the ${THEORY_TOOL_NAME} tool exactly once with the structured topic. Each section.body is an array of typed blocks (paragraph, callout, example, list, conjugation-table). Inline emphasis goes through the inline-node union (text, strong, em, hilite, mono) — do not use raw HTML or markdown.`;
}

// ---------------------------------------------------------------------------
// User prompt — short per-call message; the system prompt is the heavy lift.
// ---------------------------------------------------------------------------

export function buildTheoryUserPrompt(inputs: TheoryPromptInputs): string {
  return `Produce the theory page for ${inputs.grammarPoint.name} (${inputs.grammarPoint.key}) at CEFR ${inputs.cefrLevel}.`;
}
