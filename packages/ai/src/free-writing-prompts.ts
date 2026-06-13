/**
 * packages/ai — Free Writing evaluation prompt.
 *
 * Grades a free-form paragraph on four IELTS-style criteria adapted per
 * language, and locates errors as EXACT substrings of the learner's text so
 * the client can splice highlights without trusting the model to reproduce the
 * original verbatim. System prompt is cached (ephemeral) like the others.
 */

import {
  type FreeWritingContent,
  type CefrLevel,
  type Language,
} from "@language-drill/shared";
import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";

// Bump in the same commit as any semantic edit below. Drives the Langfuse
// `promptVersion` cohort tag. (CLAUDE.md "Prompt Editing".)
export const FREE_WRITING_EVAL_PROMPT_VERSION = "free-writing-eval@2026-06-13";

const CEFR_BULLETS = (Object.entries(CEFR_LEVEL_DESCRIPTORS) as [CefrLevel, string][])
  .map(([level, d]) => `- **${level}**: ${d}`)
  .join("\n");

export const FREE_WRITING_EVAL_SYSTEM_PROMPT = `You are an expert writing examiner for a language-learning app. You grade a learner's free-writing paragraph against four IELTS-style criteria, adapted to the target language, and you mark concrete errors in place.

## Criteria (score each 0.0–1.0 and give a CEFR estimate)

1. **Task achievement** — did the writer address the prompt, meet the length band, and include every required element?
2. **Coherence & cohesion** — paragraph structure, logical flow, connector usage.
3. **Lexical resource** — vocabulary range, accuracy, appropriateness to register.
4. **Grammatical range & accuracy** — variety of structures used correctly.

## CEFR reference

${CEFR_BULLETS}

## How to locate errors and highlights — IMPORTANT

You do NOT re-type the learner's text. Instead you return:
- \`errors[]\`: each with \`original\` set to the **exact substring** copied verbatim from the learner's text (so it can be found by string match), plus \`correction\`, \`severity\` (high/med/low), \`type\` (a short category label in the target language, e.g. "Modo verbal"), an optional \`where\`, and a one-sentence \`note\`. Keep \`original\` short — the smallest span that captures the error.
- \`goodSpans[]\`: a few **exact substrings** of things done well (strong collocations, well-formed structures).
- \`improved\`: a freshly written, lifted version of the whole paragraph(s) (\`text\`), plus \`upgrades[]\` = exact substrings **within \`improved.text\`** worth highlighting as upgrades.

Every \`original\`, every \`goodSpans\` entry, and every \`upgrades\` entry MUST be an exact substring of the relevant text (the learner's answer for the first two; \`improved.text\` for the third). If you cannot copy it verbatim, omit it.

## Scoring discipline

- \`overallScore\` is your holistic 0.0–1.0 grade; \`overallCefr\` the overall writing level it evidences.
- Reward natural, well-formed writing. Multiple valid responses exist — there is no single correct answer.
- \`headline\` is one vivid sentence; \`summary\` is 2–3 sentences. Both in the app's UI language (English).
- Return exactly the four criteria, in the order: task, coherence, lexis, grammar.`;

export function buildFreeWritingUserPrompt(
  content: FreeWritingContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  const required = content.requiredElements.length
    ? content.requiredElements
        .map((r) => `- ${r.label}${r.detail ? ` (${r.detail})` : ""}`)
        .join("\n")
    : "- (none)";

  return `## Free Writing submission

**Target language:** ${language}
**Target CEFR level:** ${difficulty}
**Register:** ${content.register}
**Length band:** ${content.minWords}–${content.maxWords} words

**Prompt title:** ${content.title}
**Task:** ${content.task}

**Required elements:**
${required}

**Learner's text:**
"""
${userAnswer}
"""

Evaluate the four criteria, locate errors and highlights as exact substrings, and write an improved version. Submit via the tool.`;
}
