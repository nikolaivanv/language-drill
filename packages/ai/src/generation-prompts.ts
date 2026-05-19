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
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

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
export const GENERATION_PROMPT_VERSION = "generate@2026-05-19";

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

/**
 * Phase-2 Langfuse-registered template. Identical to the body
 * `buildGenerationSystemPrompt` returns, with every interpolation replaced
 * by a `{{flatVar}}` placeholder consumable by both `applyTemplate`
 * (in-code fallback) and Langfuse's Mustache.js `compile(vars)` (live
 * fetch). The `generation-prompts.test.ts` snapshot block asserts byte
 * parity for `applyTemplate(TEMPLATE, computeGenerationPromptVars(...))`
 * against the current sync builder output so any drift between the two
 * is caught at PR time.
 *
 * Placeholder set is **flat strings only** (no nested paths) so the two
 * substituters produce identical bytes — required for Anthropic
 * prompt-cache parity.
 */
export const GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are an expert language exercise author for {{language}} learners at CEFR {{cefrLevel}}. Your job is to produce one exercise of type {{exerciseType}} that targets exactly one grammar point: {{grammarPointName}}.

## Grammar point context

{{grammarPointDescription}}

## Positive examples

{{positiveExamplesBullets}}

## Negative examples (incorrect production — for awareness only, do not include in the exercise)

{{negativeExamplesBullets}}

## Common learner errors

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

{{priorPoolSection}}## Hard constraints

- **The learner must produce the answer themselves.** Two failure modes are forbidden:
  - **Ambiguous blank.** For a cloze, the answer must be uniquely produced. Either (a) the surrounding sentence constrains the blank so only one specific lexeme/form plausibly fits — every other candidate is ruled out by something explicit in the sentence — OR (b) for grammar-shape clozes where many lexemes satisfy the rule, you populate \`acceptableAnswers\` with every lexeme that fits. Sentences like "Sınıfta sekiz ___ var" ("There are eight ___ in the classroom") are forbidden without \`acceptableAnswers\`, because chair, student, book, pencil, and many other nouns all satisfy the rule equally. For translation, the reference translation must be the dominant rendering — minor variants are accepted at evaluation time, but the source text must not admit two structurally different correct translations. For vocab_recall, the prompt/definition must pick out exactly one headword.
  - **Spoiled blank.** The \`instructions\` and \`context\` fields may name the grammar category being tested (e.g. "vowel harmony", "noun-numeral agreement") but MUST NOT state the rule's outcome, name the required suffix/form, or otherwise let the learner produce the answer without engaging with the blank. "Vowel harmony: front vowel (e) requires -ler suffix" above "Odada pencere___ açık" is forbidden — it tells the learner the answer is "-ler". "Plural agreement after a numeral" above "Sınıfta sekiz ___ var" is acceptable — it names the rule type without giving the form.
- Vocabulary outside CEFR {{cefrLevel}} is forbidden unless the exercise explicitly tests it.
- Do not produce an exercise that resembles any of these existing stems:
{{recentStemsBlock}}
- One exercise per tool call. Do not batch multiple inside one tool call.
- You MUST use the provided tool. Do not return plain text.

## Output

Use the {{toolName}} tool with all required fields populated.`;

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder so the
 * Task-9 snapshot parity test can exercise the same computation the
 * builder does (and Task 10's async refactor will route both through it).
 */
export function computeGenerationPromptVars(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): Record<string, string> {
  const { language, cefrLevel, exerciseType, grammarPoint, priorPoolSurfaces } =
    inputs;
  return {
    language,
    cefrLevel,
    exerciseType,
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    priorPoolSection: renderPriorPoolSection(exerciseType, priorPoolSurfaces),
    recentStemsBlock: renderRecentStems(recentStems),
    toolName: TOOL_NAME_BY_TYPE[exerciseType],
  };
}

/**
 * Builds the generation system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys / compile
 * mismatch. Byte parity between the two paths is pinned by the
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`generateBatch` in `generate.ts`) is already `async`.
 */
export async function buildGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): Promise<string> {
  const vars = computeGenerationPromptVars(inputs, recentStems);
  const { text } = await getPromptWithVarsOrFallback(
    "generate-system-prompt",
    GENERATION_SYSTEM_PROMPT_TEMPLATE,
    GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
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
