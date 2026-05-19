/**
 * packages/ai — Prompt builders for the theory validator (Phase 3).
 *
 * Mirrors the exercise validator's split:
 *   - `buildTheoryValidationSystemPrompt(spec)` is `spec`-derived only so two
 *     calls with equal `spec` produce byte-identical strings (Req 2.2). That's
 *     what allows Anthropic prompt caching (`cache_control: ephemeral` on the
 *     system block) to hit on the second and subsequent validator calls.
 *   - `buildTheoryValidationUserPrompt(draft, spec)` is `(draft, spec)`-derived
 *     and changes every call.
 *
 * The "Routing implication" block interpolates the numeric thresholds from
 * `theory-validation-thresholds.ts` rather than hard-typing 0.5/0.7 literals
 * (Req 2.5). Phase 3 introduces this shared-constant pattern for theory; the
 * exercise validator (`validation-prompts.ts`) duplicates the literals as
 * plain English and is a future cleanup target.
 *
 * Tool name `submit_theory_validation_result` is the closing-directive
 * literal — kept as a string in the template (matching `validation-prompts.ts`'s
 * `submit_validation_result` handling) rather than importing
 * `THEORY_VALIDATION_TOOL_NAME` from `./theory-validate.js`, which would
 * introduce a circular import for a one-shot literal. Task 6's tests pin
 * both sides to the same string.
 */

import {
  type CefrLevel,
  LANGUAGE_NAMES,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import { THEORY_VALIDATION_THRESHOLDS } from "./theory-validation-thresholds.js";
import type {
  TheoryDraft,
  TheoryGenerationSpec,
} from "./theory-generate.js";
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
// Raw template constant — Langfuse-registered body for
// `theory-validate-system-prompt`. Phase 2 rewrites this in terms of FLAT
// placeholders only — the original Phase-1 template used nested paths
// (`{{grammarPoint.name}}`, `{{CEFR_DESCRIPTORS}}`) which neither
// Langfuse's Mustache `compile(vars)` nor our in-code `applyTemplate` can
// resolve. The `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity`
// test block pins `applyTemplate(TEMPLATE, computeVars(spec)).text ===
// buildTheoryValidationSystemPrompt(spec)` so any drift between the
// template and the live builder is caught at PR time.
// ---------------------------------------------------------------------------

// Bump in the same commit as any semantic edit to
// THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE. Drives the Langfuse trace
// `promptVersion` tag — dashboards cohort old vs. new prompt traces by
// this string.
export const THEORY_VALIDATION_PROMPT_VERSION = "theory-validate@2026-05-12";

export const THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE = `You are a strict reviewer of language reference material for adult learners. The page is for CEFR {{cefrLevel}} {{languageName}} and explains the grammar point: {{grammarPointName}}.

Be conservative. Reject anything factually wrong, anything mis-leveled, anything whose examples fail to demonstrate the configured grammar point, and anything with cultural issues. Score on the high side only when the page is genuinely accurate, well-leveled, and on-point.

## Grammar point context

{{grammarPointDescription}}

## Positive examples (the page should explain and use these — verbatim or paraphrased)

{{positiveExamplesBullets}}

## Common learner errors (the page should address each in its "common pitfalls" section)

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Required sections (in this order — the generator produces all five)

1. what is it? — a single paragraph defining the concept
2. when to use it — bullets or short paragraphs covering trigger conditions
3. formation — how the form is built (often a conjugation-table block)
4. examples in context — at least three example blocks with target + English
5. common pitfalls — a list addressing every entry in commonErrors

## Routing implication of your scores

Your output is routed by these rules:
- factualErrors non-empty                                  → REJECTED (stricter than the exercise validator — a wrong rule corrupts the canonical reference)
- culturalIssues non-empty                                 → REJECTED
- qualityScore < {{flagQualityFloor}}                              → REJECTED
- qualityScore in [{{flagQualityFloor}}, {{approveQualityFloor}})          → FLAGGED (waits for human review)
- qualityScore >= {{approveQualityFloor}} AND !levelMismatch AND sectionsIncomplete empty AND examplesUseGrammarPoint
                                                            → AUTO-APPROVED (visible to learners)
- otherwise                                                 → FLAGGED

Score conservatively — a flagged page costs a human ~30 seconds of review; an auto-approved bad page becomes the canonical reference learners internalize.

## Dimensions to score (one-to-one with the tool's required fields)

1. **qualityScore** (0.0–1.0): overall fitness as a reference page.
2. **factualErrors** (array of strings): wrong rule claims, wrong conjugations, etc. Empty array when the page is accurate.
3. **levelMismatch** (boolean): true if vocabulary or concepts drift above/below {{cefrLevel}}.
4. **sectionsIncomplete** (array of strings): names of required sections that are missing or thin. Empty array when all five sections are adequate.
5. **examplesUseGrammarPoint** (boolean): do the example blocks actually demonstrate {{grammarPointName}}?
6. **culturalIssues** (array of strings): stereotyping, sensitive content, exclusion. Empty array when none.
7. **flaggedReasons** (array of strings): anything else a reviewer should know.

## Output

You MUST use the submit_theory_validation_result tool. Do not return plain text.`;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder
 * so the Task-17 snapshot parity test can exercise the same computation
 * the builder does (Task 18's async refactor will route both through it).
 *
 * Numeric thresholds from `THEORY_VALIDATION_THRESHOLDS` are stringified
 * here so the var map type stays uniform (`Record<string, string>`) — the
 * builder's template-literal coercion happens automatically; here it's
 * explicit.
 */
export function computeTheoryValidationPromptVars(
  spec: TheoryGenerationSpec,
): Record<string, string> {
  const { language, cefrLevel, grammarPoint } = spec;
  return {
    cefrLevel,
    languageName: LANGUAGE_NAMES[language],
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    flagQualityFloor: String(THEORY_VALIDATION_THRESHOLDS.flagQualityFloor),
    approveQualityFloor: String(THEORY_VALIDATION_THRESHOLDS.approveQualityFloor),
  };
}

/**
 * Builds the theory-validator system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys /
 * compile mismatch. Byte parity between the two paths is pinned by the
 * `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`validateTheoryDraft` in `theory-validate.ts`) is already `async`.
 */
export async function buildTheoryValidationSystemPrompt(
  spec: TheoryGenerationSpec,
): Promise<string> {
  const vars = computeTheoryValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "theory-validate-system-prompt",
    THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    THEORY_VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

// ---------------------------------------------------------------------------
// User prompt — per-draft. Embeds the draft's content as pretty-printed JSON
// so Claude can scan it section-by-section.
// ---------------------------------------------------------------------------

export function buildTheoryValidationUserPrompt(
  draft: TheoryDraft,
  spec: TheoryGenerationSpec,
): string {
  return `Validate the following theory page for ${spec.grammarPoint.key} at CEFR ${spec.cefrLevel}:

\`\`\`json
${JSON.stringify(draft.contentJson, null, 2)}
\`\`\``;
}
