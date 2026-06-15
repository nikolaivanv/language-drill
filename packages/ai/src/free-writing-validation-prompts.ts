/**
 * packages/ai — Validation prompt for generated free-writing PROMPTS.
 *
 * Distinct from validation-prompts.ts (cloze/SC: ambiguous blank, spoiled
 * answer) and free-writing-prompts.ts (which GRADES a learner's paragraph). This
 * validates the generated prompt itself: is the task clear, scorable, achievable
 * at the CEFR level in the word band, with realistic required elements at the
 * declared register? It reuses the shared `submit_validation_result` tool and
 * `routeValidationResult` unchanged: the model sets ambiguous=false,
 * contextSpoilsAnswer=false, grammarPointMatch=true, leaves coverage empty, and
 * sets levelMatch + qualityScore per the rubric.
 */

import { type FreeWritingContent } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationSpec } from "./generate.js";
import { freeWritingLengthFor } from "./free-writing-generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

export const FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION =
  "free-writing-validate@2026-06-15";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

export const FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT = `You are a strict reviewer of free-writing PROMPTS for {{language}} learners at CEFR {{cefrLevel}}. You validate ONE already-generated prompt: an open-ended writing task (title + task + a checklist of required elements) the learner will answer in a single paragraph. You are NOT grading a learner answer — you judge whether the prompt itself is good.

Be conservative. A flagged prompt costs a human ~30 seconds of review; an auto-approved bad prompt wastes the learner's time.

## Routing implication of your scores

- qualityScore < 0.5  OR  any cultural issue  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND levelMatch          → AUTO-APPROVED (shown to learners)
- otherwise                                    → FLAGGED

## CEFR level descriptors

{{cefrDescriptors}}

## What to score

1. **qualityScore** (0.0–1.0): overall fitness as a {{cefrLevel}} free-writing prompt. Judge:
   - **Clarity & scorability** — does \`task\` say exactly what to write, so a learner knows when they are done? Vague "write about X" → lower.
   - **Achievability for level + band** — answerable at {{cefrLevel}} within the stated word band, at the stated register.
   - **Required elements** — 2–4 concrete, checkable items, realistic at level; not impossibly many, not trivially one, not self-contradictory, not off-topic.
   - **Register match** — the task wording fits the stated register.
   - **Does not write the answer** — no model paragraph or copyable sentences.
   Anchors: 0.9 publishable as-is; 0.8 one cosmetic edit; 0.65 borderline (FLAGGED); 0.5 unusable (REJECTED).
2. **levelMatch** (boolean): does the prompt's demand sit at {{cefrLevel}}?
3. **culturalIssues** (array): stereotyping, sensitive or unsafe framing. Non-empty → REJECTED.
4. **flaggedReasons** (array): anything a reviewer should know.

## Fields that do not apply to free-writing — set them as follows

- **ambiguous**: always \`false\` (open task; many valid answers is expected).
- **contextSpoilsAnswer**: always \`false\` (there is no single answer to spoil).
- **grammarPointMatch**: always \`true\` (a free-writing prompt targets production, not a single grammar point).
- Leave the \`coverage\` object empty.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

export function computeFreeWritingValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  return {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
  };
}

export async function buildFreeWritingValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeFreeWritingValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "free-writing-validate-system-prompt",
    FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT,
    FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildFreeWritingValidationUserPrompt(
  content: FreeWritingContent,
  spec: GenerationSpec,
): string {
  const band = freeWritingLengthFor(spec.cefrLevel);
  const elements = content.requiredElements
    .map((el) => `- ${el.label}${el.detail ? ` (${el.detail})` : ""}`)
    .join("\n");
  return `## Validate this free-writing prompt

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}
**Expected register:** ${content.register}
**Expected length band:** ${band.minWords}–${band.maxWords} words

**Title:** ${content.title}
**Task:** ${content.task}
**Domain:** ${content.domain}

**Required elements:**
${elements}

Score the dimensions in the system prompt and submit via the submit_validation_result tool. Remember: ambiguous=false, contextSpoilsAnswer=false, grammarPointMatch=true for free-writing.`;
}
