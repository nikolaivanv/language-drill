/**
 * packages/ai — Prompt builders for the validator (Phase 3).
 *
 * The validator's system prompt is `spec`-derived only — it does NOT include
 * draft-level fields — so two calls with the same `spec` produce byte-identical
 * strings. That's what allows Anthropic prompt caching (`cache_control:
 * ephemeral` on the system block) to hit on the second and subsequent
 * validator calls within a cell. The user prompt is `(draft, spec)`-derived
 * and changes per call.
 *
 * The system prompt's "Routing implication" block restates plan §3.1's
 * routing rule in plain English so Claude has the context to assign self-
 * consistent scores. The actual routing is done by `routeValidationResult`
 * (packages/db/scripts/generate-exercises-validate.ts), not here.
 */

import {
  type CefrLevel,
  type ClozeContent,
  ExerciseType,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { ExerciseDraft, GenerationSpec } from "./generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

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
// Helpers
// ---------------------------------------------------------------------------

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

// ---------------------------------------------------------------------------
// Raw template constant — Langfuse-registered body for `validate-system-prompt`.
// Phase 2 rewrites this in terms of FLAT placeholders only — the original
// Phase-1 placeholders used nested paths (`{{grammarPoint.name}}`,
// `{{CEFR_DESCRIPTORS}}`) which Langfuse's Mustache `compile(vars)` and our
// in-code `applyTemplate` cannot bridge byte-for-byte. The
// `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block pins
// `applyTemplate(TEMPLATE, computeValidationPromptVars(spec)).text ===
// buildValidationSystemPrompt(spec)` so any drift between the template and
// the live builder is caught at PR time.
// ---------------------------------------------------------------------------

// Bump in the same commit as any semantic edit to
// VALIDATION_SYSTEM_PROMPT_TEMPLATE. Drives the Langfuse trace
// `promptVersion` tag — dashboards cohort old vs. new prompt traces by
// this string.
export const VALIDATION_PROMPT_VERSION = "validate@2026-05-12";

export const VALIDATION_SYSTEM_PROMPT_TEMPLATE = `You are a strict reviewer of language exercises for {{language}} learners at CEFR {{cefrLevel}}. Your job is to validate one already-generated exercise that targets the grammar point: {{grammarPointName}}.

Be conservative. Reject anything ambiguous, anything mis-leveled, anything that fails to target the configured grammar point, and anything with cultural issues. Score on the high side only when the exercise is genuinely unambiguous, well-leveled, and on-point.

## Routing implication of your scores

Your output is routed by these rules:
- qualityScore < 0.5  OR  any cultural issue  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND not ambiguous AND levelMatch AND grammarPointMatch
                                              → AUTO-APPROVED (visible to learners)
- otherwise                                    → FLAGGED

Score conservatively — a flagged draft costs a human ~30 seconds of review; an auto-approved bad draft corrupts the learner's progress model.

## Grammar point context

{{grammarPointDescription}}

## Positive examples

{{positiveExamplesBullets}}

## Common learner errors (the exercise should expose these, not propagate them)

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Dimensions to score (one-to-one with the tool's required fields)

1. **qualityScore** (0.0–1.0): overall fitness.
2. **ambiguous** (boolean): is there more than one substantively-correct answer?
3. **levelMatch** (boolean): does the difficulty match {{cefrLevel}}?
4. **grammarPointMatch** (boolean): does this actually test {{grammarPointName}}?
5. **culturalIssues** (array of strings): stereotyping, sensitive content, exclusion. Empty array when none.
6. **flaggedReasons** (array of strings): anything else a reviewer should know.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder so the
 * Task-12 snapshot parity test can exercise the same computation the
 * builder does (Task 13's async refactor will route both through it).
 */
export function computeValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  const { language, cefrLevel, grammarPoint } = spec;
  return {
    language,
    cefrLevel,
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
  };
}

/**
 * Builds the validator system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys / compile
 * mismatch. Byte parity between the two paths is pinned by the
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`validateDraft` in `validate.ts`) is already `async`.
 */
export async function buildValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "validate-system-prompt",
    VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

// ---------------------------------------------------------------------------
// Per-type user prompts
// ---------------------------------------------------------------------------
//
// Each renderer prepends a "Spec:" preamble that names the target language,
// CEFR level, and grammar point key — repeated from the (cached) system
// prompt so the validator can compare the draft against the spec in one
// pass. Token cost is ~30 per draft; the latency benefit of not having to
// cross-reference message blocks justifies the duplication.

function buildClozeValidationUserPrompt(
  content: ClozeContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Cloze exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Sentence:** ${content.sentence}
**Correct Answer:** ${content.correctAnswer}
${content.options ? `**Options:** ${content.options.join(", ")}` : ""}
${content.context ? `**Context:** ${content.context}` : ""}

Score the dimensions in the system prompt and submit via the tool.`;
}

function buildTranslationValidationUserPrompt(
  content: TranslationContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Translation exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Source Text (${content.sourceLanguage}):** ${content.sourceText}
**Target Language:** ${content.targetLanguage}
**Reference Translation:** ${content.referenceTranslation}

Score the dimensions in the system prompt and submit via the tool.`;
}

function buildVocabRecallValidationUserPrompt(
  content: VocabRecallContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Vocabulary Recall exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
**Expected Word:** ${content.expectedWord}
**Hints:** ${content.hints.join("; ")}
**Example Sentence:** ${content.exampleSentence}

Score the dimensions in the system prompt and submit via the tool.`;
}

/**
 * Pure: builds the per-draft user message. Two calls with the same
 * (draft, spec) return byte-identical strings.
 *
 * NOTE on signature: the design's Component 2 floats `(draft)` only, but
 * rendering the documented "Spec:" preamble requires `language` and
 * `cefrLevel`, which live on `spec` and not on the draft. Widened to
 * `(draft, spec)` here so the caller (`validateDraft`) can pass both. The
 * caller already has both available — this is the only sensible signature.
 */
export function buildValidationUserPrompt(
  draft: ExerciseDraft,
  spec: GenerationSpec,
): string {
  const content = draft.contentJson;
  switch (content.type) {
    case ExerciseType.CLOZE:
      return buildClozeValidationUserPrompt(content, spec);
    case ExerciseType.TRANSLATION:
      return buildTranslationValidationUserPrompt(content, spec);
    case ExerciseType.VOCAB_RECALL:
      return buildVocabRecallValidationUserPrompt(content, spec);
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `buildValidationUserPrompt: unsupported content type ${(_exhaustive as { type: ExerciseType }).type}`,
      );
    }
  }
}

