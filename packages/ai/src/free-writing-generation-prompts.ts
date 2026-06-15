/**
 * packages/ai — Generation prompt for free-writing prompts.
 *
 * Distinct from generation-prompts.ts (cloze/translation/vocab/SC) and
 * dictation-generation-prompts.ts. A free-writing "draft" is an open-ended
 * writing PROMPT (title + task + a short checklist of required elements) the
 * learner answers in a paragraph — there is no blank and no single answer. Each
 * (language, CEFR, topic) is its own cell, so the topic framing lives in the
 * cached system prompt (the curriculum entry's name/description/examples). The
 * model authors title/task/requiredElements/topicHint/domain/instructions; the
 * register comes from the topic entry and the word band from the CEFR table —
 * both injected by code in parseGeneratedFreeWritingDraft (see generate.ts).
 *
 * Flat-string `{{var}}` template (Langfuse-registered as
 * `free-writing-generate-system-prompt`), substituted by both `applyTemplate`
 * (fallback) and Langfuse `compile(vars)`.
 */

import {
  ExerciseType,
  type CurriculumCefrLevel,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// Bump in the same commit as any semantic edit to the template below.
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-06-15";

/**
 * CEFR → word band + suggested minutes for a free-writing prompt. Single source
 * for both the prompt text and the band injected into the stored
 * FreeWritingContent. Only B1/B2 are in scope this milestone; an out-of-scope
 * level throws in `freeWritingLengthFor`.
 */
export const FREE_WRITING_LENGTH_BY_CEFR: Readonly<
  Partial<Record<CurriculumCefrLevel, { minWords: number; maxWords: number; suggestedMinutes: number }>>
> = Object.freeze({
  B1: { minWords: 80, maxWords: 120, suggestedMinutes: 15 },
  B2: { minWords: 150, maxWords: 200, suggestedMinutes: 25 },
});

export function freeWritingLengthFor(
  cefrLevel: string,
): { minWords: number; maxWords: number; suggestedMinutes: number } {
  const band = FREE_WRITING_LENGTH_BY_CEFR[cefrLevel as CurriculumCefrLevel];
  if (!band) {
    throw new Error(
      `free-writing: no length band configured for CEFR level ${JSON.stringify(cefrLevel)} (B1/B2 only this milestone)`,
    );
  }
  return band;
}

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export const FREE_WRITING_GENERATION_SYSTEM_PROMPT = `You are an expert author of free-writing prompts for {{language}} learners at CEFR {{cefrLevel}}. Produce ONE open-ended writing prompt the learner answers in a single paragraph of {{minWords}}–{{maxWords}} {{language}} words. The target register is {{register}}.

## Topic for this prompt

**{{topicName}}** — {{topicDescription}}

## What a good prompt for this topic looks like

{{positiveExamplesBullets}}

## Avoid

{{negativeExamplesBullets}}

## Common authoring mistakes to avoid

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Hard constraints

- **Self-contained, scorable task.** The \`task\` MUST tell the learner exactly what to write so a competent {{cefrLevel}} learner knows when they are done. It MUST stay on the topic above and be answerable in {{minWords}}–{{maxWords}} words at the {{register}} register. NOT a vague "write about X".
- **Required elements (2–4).** Provide a short checklist (\`requiredElements\`) of 2–4 concrete, observable things the answer must contain (e.g. "state your opinion in the first sentence", "give two reasons", "use at least one concessive connector"). Each must be realistic at {{cefrLevel}} and genuinely checkable — not impossibly many, not trivially one, not self-contradictory. Write each \`label\` in {{language}}; an optional \`detail\` may add a one-line hint.
- **Do not write the answer.** The prompt frames the task; it MUST NOT contain a model paragraph or hand the learner sentences to copy.
- **Vocabulary band.** Keep the wording of the prompt itself at or below CEFR {{cefrLevel}} everyday {{language}}.
- **Safe, neutral framing.** Avoid weapons, substances, violence, and culturally sensitive or stereotyping angles.
- **One prompt per tool call.** Do not batch multiple prompts.
- You MUST use the {{toolName}} tool. Do not return plain text.

## Output

Use the {{toolName}} tool with all required fields populated. Do not set register or word counts — those are fixed by the system.`;

export function computeFreeWritingGenerationPromptVars(
  inputs: GenerationPromptInputs,
): Record<string, string> {
  if (inputs.exerciseType !== ExerciseType.FREE_WRITING) {
    throw new Error(
      "computeFreeWritingGenerationPromptVars: non-free-writing cell routed to the free-writing prompt",
    );
  }
  const { language, cefrLevel, grammarPoint } = inputs;
  const register = grammarPoint.freeWriting?.register;
  if (!register) {
    throw new Error(
      `computeFreeWritingGenerationPromptVars: topic entry ${grammarPoint.key} has no freeWriting.register`,
    );
  }
  const band = freeWritingLengthFor(cefrLevel);
  return {
    language,
    cefrLevel,
    register,
    minWords: String(band.minWords),
    maxWords: String(band.maxWords),
    topicName: grammarPoint.name,
    topicDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    toolName: "submit_free_writing_exercise",
  };
}

export async function buildFreeWritingGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
): Promise<string> {
  const vars = computeFreeWritingGenerationPromptVars(inputs);
  const { text } = await getPromptWithVarsOrFallback(
    "free-writing-generate-system-prompt",
    FREE_WRITING_GENERATION_SYSTEM_PROMPT,
    FREE_WRITING_GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildFreeWritingGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
): string {
  return `Produce free-writing prompt #${ordinal + 1}.

Vary the angle, the exact task, and the required-elements checklist from prompt to prompt so a batch on this topic is diverse (different sub-focus, different things the learner must include). Use the submit_free_writing_exercise tool.`;
}
