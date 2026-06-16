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
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-06-16";

/**
 * Cap on how many already-used titles appear in the system prompt's avoid-list.
 * The dedup surface for free_writing is the title, so the generator gravitates to
 * the topic name and collides; feeding the titles already in the pool (frozen for
 * the batch, like `priorPoolSurfaces` for vocab_recall) steers it to fresh angles.
 * A cell's distinct-title space is small, so this bound is generous.
 */
export const MAX_PRIOR_FW_TITLES_IN_PROMPT = 60;

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

/**
 * Builds the "titles already in the pool" avoid-list block from the cell's prior
 * approved/flagged titles. Returns "" when there are none (e.g. a cell's first
 * run) so the section is omitted and the cached prompt prefix stays stable. The
 * trailing `\n\n` lets the template splice `{{priorTitlesSection}}## Hard…`
 * cleanly when present.
 */
function renderPriorTitlesSection(
  priorTitles: readonly string[] | undefined,
): string {
  if (!priorTitles || priorTitles.length === 0) return "";
  const capped = priorTitles.slice(0, MAX_PRIOR_FW_TITLES_IN_PROMPT);
  const bullets = capped.map((t) => `  - ${t}`).join("\n");
  return `## Titles already in the pool — do NOT reuse or closely paraphrase any of these\n\nPick a clearly different angle and a distinct title:\n\n${bullets}\n\n`;
}

/**
 * Register-neutral angle rotation. Each draft in a batch is generated in
 * parallel (the generator pool can't see sibling drafts), and the dedup surface
 * is the title — so without per-draft steering all N drafts converge on the
 * topic name and collide. Rotating a distinct sub-focus by ordinal forces the
 * titles apart on a fresh cell, the same way `sentence_construction` rotates its
 * prompt modes. Lives in the per-draft USER prompt (uncached), so it never
 * perturbs the cached system-prompt prefix.
 */
export const FREE_WRITING_ANGLES: readonly string[] = [
  "the personal, individual side of the topic",
  "the social or collective side of the topic",
  "a concrete everyday scenario that brings the topic to life",
  "weighing two clearly opposing positions",
  "the causes or reasons behind it",
  "the consequences or effects",
  "a direct comparison between two options or situations",
  "a recommendation, a solution, or advice",
];

export function freeWritingAngleForOrdinal(ordinal: number): string {
  return FREE_WRITING_ANGLES[ordinal % FREE_WRITING_ANGLES.length];
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

{{priorTitlesSection}}## Hard constraints

- **Distinct, specific title — never the bare topic name.** The \`title\` MUST be a specific angle on the topic, not a restatement of the topic name above. A batch of prompts on one topic must have clearly different titles and tasks, so the learner sees variety rather than near-duplicates.
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
    // Avoid-list of titles already in this cell's pool (frozen for the batch by
    // `runOneCell`, like vocab_recall's priorPoolSurfaces). Empty/undefined → "".
    priorTitlesSection: renderPriorTitlesSection(inputs.priorPoolSurfaces),
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

// `inputs` is unused in the body but kept for signature parity with the other
// per-draft user-prompt builders (cloze/translation/dictation), so `generateOneDraft`
// can call them uniformly; the topic framing lives in the cached system prompt.
export function buildFreeWritingGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
): string {
  void inputs;
  const angle = freeWritingAngleForOrdinal(ordinal);
  return `Produce free-writing prompt #${ordinal + 1}.

For THIS prompt, build the task around: ${angle}. Give it a specific, distinctive title that reflects this angle — do NOT reuse the bare topic name as the title. Vary the exact task and the required-elements checklist from prompt to prompt so a batch on this topic is diverse. Use the submit_free_writing_exercise tool.`;
}
