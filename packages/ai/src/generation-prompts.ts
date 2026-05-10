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

export function tailRecentStems(stems: readonly string[]): string[] {
  return stems.slice(-MAX_RECENT_STEMS_IN_PROMPT);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type GenerationPromptInputs = {
  language: Exclude<Language, Language.EN>;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
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

export function buildGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): string {
  const { language, cefrLevel, exerciseType, grammarPoint } = inputs;
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

## Hard constraints

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
