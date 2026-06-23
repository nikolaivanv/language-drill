/**
 * packages/ai — Validation prompt for dictation listening clips.
 *
 * Distinct system prompt from validation-prompts.ts (which is cloze/translation/
 * vocab/SC-framed: ambiguous blank, contextSpoilsAnswer). Dictation has no blank
 * and no answer to spoil — it is validated on length-for-level, vocabulary band,
 * naturalness, and listenability. It reuses the SAME `submit_validation_result`
 * tool and `ValidationResult` shape so `routeValidationResult` is unchanged: the
 * model sets `ambiguous=false`, `contextSpoilsAnswer=false`, `grammarPointMatch=true`
 * (not a grammar-point exercise), `levelMatch` per judgment, and `qualityScore`
 * per the dictation rubric.
 */

import { ExerciseType, type DictationContent } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationSpec } from "./generate.js";
import { renderLevelScopeSection } from "./level-scope.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

export const DICTATION_VALIDATION_PROMPT_VERSION = "dictation-validate@2026-06-23";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

export const DICTATION_VALIDATION_SYSTEM_PROMPT = `You are a strict reviewer of dictation listening clips for {{language}} learners at CEFR {{cefrLevel}}. You validate ONE already-generated clip: a short passage meant to be read aloud and transcribed by ear.

Be conservative. A flagged clip costs a human ~30 seconds of review; an auto-approved bad clip wastes the learner's time and corrupts their listening signal.

## Routing implication of your scores

Your output is routed by these rules:
- qualityScore < 0.5  OR  any cultural issue  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND levelMatch          → AUTO-APPROVED (synthesized + shown to learners)
- otherwise                                    → FLAGGED

## CEFR level descriptors

{{cefrDescriptors}}

{{levelScopeSection}}## What to score

1. **qualityScore** (0.0–1.0): overall fitness as a {{cefrLevel}} dictation clip. Judge:
   - **Naturalness** — does it read like real connected speech a native would say? (Stilted / textbook-ish / list-like → lower.)
   - **Length for level** — A1: ONE short, clear sentence (a single sentence is CORRECT, not "too short"). A2: 1–2 short sentences. B1: 2–4 short sentences; B2: 3–5 with some subordination. Too long to hold in working memory → lower; but do NOT penalize an A1/A2 clip for being short or simple — at those levels clarity is the goal, not density.
   - **Vocabulary band** — every content word at or below {{cefrLevel}} everyday vocabulary.
   - **Listenability** — the clip must be listenable: NOT a tongue-twister, NOT a dense number/date/proper-noun pile-up, NOT a segmentation trap so ambiguous a native could not transcribe it. One or two natural connected-speech challenges are GOOD; a wall of them is bad.
   Anchors: 0.9 publishable as-is; 0.8 one cosmetic edit; 0.65 borderline (FLAGGED); 0.5 unusable (REJECTED).
2. **levelMatch** (boolean): does the difficulty sit at {{cefrLevel}}? If a grammar-scope list is provided above, use it as the ground truth for what a {{cefrLevel}} learner has studied — treat any grammar or morphology within or below that scope as level-appropriate, and do NOT flag it as above level. If no list is provided, judge against your general knowledge of {{cefrLevel}} expectations.
3. **culturalIssues** (array): stereotyping, sensitive or unsafe content. Non-empty → REJECTED.
4. **flaggedReasons** (array): anything a reviewer should know.

## Fields that do not apply to dictation — set them as follows

- **ambiguous**: always \`false\` (there is no blank / single answer).
- **contextSpoilsAnswer**: always \`false\` (there is nothing to spoil).
- **grammarPointMatch**: always \`true\` (a dictation clip targets listening, not a single grammar point).
- Leave the \`coverage\` object empty.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

export function computeDictationValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  return {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    // Curriculum scope (grammar points at/below this level) so the validator
    // judges level against the real curriculum instead of its own sense of the
    // level — which was flagging in-scope A1 morphology (consonant softening,
    // -iyor) as A2. Injected on the spec by the db-side orchestrator; the
    // formatter gates by type (dictation now included).
    levelScopeSection: renderLevelScopeSection(
      ExerciseType.DICTATION,
      spec.language,
      spec.cefrLevel,
      spec.levelScopePoints,
    ),
  };
}

export async function buildDictationValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeDictationValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "dictation-validate-system-prompt",
    DICTATION_VALIDATION_SYSTEM_PROMPT,
    DICTATION_VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildDictationValidationUserPrompt(
  content: DictationContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Dictation clip

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}
**Title:** ${content.title}
**Reference text (read aloud):** ${content.referenceText}
**Sentence count:** ${content.sentences.length}
**Estimated duration (s):** ${content.durationSec}
**Tested (descriptive):** ${content.tested.join(", ")}

Score the dimensions in the system prompt and submit via the submit_validation_result tool. Remember: ambiguous=false, contextSpoilsAnswer=false, grammarPointMatch=true for dictation.`;
}
