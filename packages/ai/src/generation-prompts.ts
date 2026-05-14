/**
 * packages/ai — Prompt builders for the exercise generator.
 *
 * Pure functions; no I/O. The system prompt is what gets cached via Anthropic
 * prompt caching when the generator dispatches drafts in a cell — see
 * generate.ts for how it's wired up. Two calls with the same (inputs, recentStems)
 * MUST return identical strings, otherwise prompt caching cannot hit.
 */

import {
  type CefrLevel,
  type ExerciseContent,
  ExerciseType,
  type GrammarPoint,
  type Language,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import { TOOL_NAME_BY_TYPE } from "./generate.js";

// The TOOL_NAME_BY_TYPE import comes from generate.ts. The two modules form
// a circular import on paper — generate.ts will import from this file in
// Task 9 — but neither side dereferences the other at module init: prompt
// builders are runtime functions, and generate.ts's module-init computations
// don't reach into generation-prompts.ts. ESM handles this case correctly.

// ---------------------------------------------------------------------------
// Recent-stems LRU helper
// ---------------------------------------------------------------------------

/**
 * Cap on how many stems appear in the system prompt's "do not resemble these"
 * list. The full set of seen stems lives in the generator's `seenStems` Set
 * (used to mark `inBatchDuplicate`); this number bounds the prompt size.
 */
export const MAX_RECENT_STEMS_IN_PROMPT = 30;

/**
 * Cap on how many pool-surfaces appear in the system prompt's "already in the
 * pool" list. Used by `vocab_recall` cells to feed Claude the words that have
 * already been generated and persisted — without this, the generator gravitates
 * to the same high-frequency words each run and the partial UNIQUE index
 * `exercises_dedup_idx` rejects them on insert, dragging effective approval
 * rate down even though the validator never said no. 250 keeps prompt size
 * bounded (~2.5 kB of bullets) while comfortably covering every saturated
 * vocab umbrella's word inventory.
 */
export const MAX_PRIOR_POOL_SURFACES_IN_PROMPT = 250;

export function tailRecentStems(stems: readonly string[]): string[] {
  return stems.slice(-MAX_RECENT_STEMS_IN_PROMPT);
}

export function capPriorPoolSurfaces(
  surfaces: readonly string[],
): readonly string[] {
  return surfaces.length <= MAX_PRIOR_POOL_SURFACES_IN_PROMPT
    ? surfaces
    : surfaces.slice(0, MAX_PRIOR_POOL_SURFACES_IN_PROMPT);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type GenerationPromptInputs = {
  language: Exclude<Language, Language.EN>;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  /**
   * Surfaces already in the persisted pool for this cell — passed by the
   * caller (currently only `runOneCell` for `vocab_recall`) so the generator
   * stops re-proposing words/sentences that would collide with
   * `exercises_dedup_idx`. The list is frozen for the duration of the batch
   * (same content for every ordinal), preserving prompt-cache hits across
   * ordinals within a cell. Empty/undefined → the "Already in the pool"
   * section is omitted entirely.
   */
  priorPoolSurfaces?: readonly string[];
};

// ---------------------------------------------------------------------------
// CEFR descriptor block — built once at module load, reused on every call so
// the cached system prompt's bytes are identical across drafts.
// ---------------------------------------------------------------------------

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [CefrLevel, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderRecentStems(recentStems: readonly string[]): string {
  const tail = tailRecentStems(recentStems);
  if (tail.length === 0) return "(none yet)";
  return tail.map((stem) => `  - ${stem}`).join("\n");
}

// Bump in the same commit as any semantic edit to the generation system
// prompt (this file's `buildGenerationSystemPrompt`). Drives the Langfuse
// trace `promptVersion` tag — dashboards cohort old vs. new prompt traces
// by this string.
export const GENERATION_PROMPT_VERSION = "generate@2026-05-12";

/**
 * Wording differs per type so Claude reads it the way the cell is constrained:
 * vocab cells are constrained at the target-word level, sentence cells at the
 * stem level. Returns the empty string when there are no priors so the section
 * is omitted entirely.
 */
function renderPriorPoolSection(
  exerciseType: ExerciseType,
  priorPoolSurfaces: readonly string[] | undefined,
): string {
  if (!priorPoolSurfaces || priorPoolSurfaces.length === 0) return "";
  const capped = capPriorPoolSurfaces(priorPoolSurfaces);
  const bullets = capped.map((surface) => `  - ${surface}`).join("\n");
  const heading =
    exerciseType === ExerciseType.VOCAB_RECALL
      ? "## Already in the pool — do NOT propose any of these target words"
      : "## Already in the pool — do NOT propose any exercise whose surface matches these";
  return `${heading}\n\n${bullets}\n\n`;
}

export function buildGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): string {
  const { language, cefrLevel, exerciseType, grammarPoint, priorPoolSurfaces } =
    inputs;
  const toolName = TOOL_NAME_BY_TYPE[exerciseType];

  return `You are an expert language exercise author for ${language} learners at CEFR ${cefrLevel}. Your job is to produce one exercise of type ${exerciseType} that targets exactly one grammar point: ${grammarPoint.name}.

## Grammar point context

${grammarPoint.description}

## Positive examples

${renderBulletList(grammarPoint.examplesPositive)}

## Negative examples (incorrect production — for awareness only, do not include in the exercise)

${renderBulletList(grammarPoint.examplesNegative)}

## Common learner errors

${renderBulletList(grammarPoint.commonErrors)}

## CEFR level descriptors

${CEFR_DESCRIPTOR_BULLETS}

${renderPriorPoolSection(exerciseType, priorPoolSurfaces)}## Hard constraints

- The correct answer must be uniquely correct given the surrounding context.
- Vocabulary outside CEFR ${cefrLevel} is forbidden unless the exercise explicitly tests it.
- Do not produce an exercise that resembles any of these existing stems:
${renderRecentStems(recentStems)}
- One exercise per tool call. Do not batch multiple inside one tool call.
- You MUST use the provided tool. Do not return plain text.

## Output

Use the ${toolName} tool with all required fields populated.`;
}

// ---------------------------------------------------------------------------
// User prompt — short per-draft message; the system prompt is the heavy lift.
// ---------------------------------------------------------------------------

export function buildGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
): string {
  const toolName = TOOL_NAME_BY_TYPE[inputs.exerciseType];
  const domain = topicDomain ?? "mixed";
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

Use the ${toolName} tool.`;
}

// ---------------------------------------------------------------------------
// Canonical surface — used for `recentStems` accumulation in the generator,
// and (in Phase 3) for across-batch dedup. Lowercase + NFKD + diacritic-strip.
// ---------------------------------------------------------------------------

function normaliseSurface(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function canonicalSurface(content: ExerciseContent): string {
  switch (content.type) {
    case ExerciseType.CLOZE:
      return normaliseSurface(content.sentence);
    case ExerciseType.TRANSLATION:
      return normaliseSurface(content.sourceText);
    case ExerciseType.VOCAB_RECALL:
      return normaliseSurface(content.expectedWord);
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `canonicalSurface: unsupported content type ${(_exhaustive as ExerciseContent).type}`,
      );
    }
  }
}
