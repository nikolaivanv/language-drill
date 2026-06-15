/**
 * packages/ai — Generation prompt for dictation listening clips.
 *
 * Distinct from generation-prompts.ts (cloze/translation/vocab/SC): a dictation
 * "draft" is a short passage of natural connected speech to be read aloud and
 * transcribed. There is no blank, no answer to spoil, no grammar-point target —
 * the umbrella's description/examples are theme + style guidance only. The model
 * emits text + metadata via the submit_dictation_exercise tool; voiceId/accent
 * and the decorative waveform are assigned in code (see generate.ts).
 *
 * Flat-string `{{var}}` template (Langfuse-registered as
 * `dictation-generate-system-prompt`), substituted by both `applyTemplate`
 * (fallback) and Langfuse `compile(vars)`.
 */

import { ExerciseType, Language } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// Bump in the same commit as any semantic edit to the template below.
export const DICTATION_GENERATION_PROMPT_VERSION = "dictation-generate@2026-06-15";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export const DICTATION_GENERATION_SYSTEM_PROMPT = `You are an expert author of listening-dictation clips for {{language}} learners at CEFR {{cefrLevel}}. Produce ONE short passage of natural, connected speech that a learner will hear once and transcribe by ear.

## What this clip should test

{{grammarPointDescription}}

## Style references (the kind of passage that works well)

{{positiveExamplesBullets}}

## Avoid

{{negativeExamplesBullets}}

## Listening pitfalls a good clip exercises (without becoming a tongue-twister)

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Hard constraints

- **Natural connected speech.** Write the way a native speaker actually talks: full sentences with normal punctuation, ordinary contractions and liaison. NOT a word list, NOT headings, NOT bullet points, NOT metadata.
- **Length for level.** B1: 2–4 short sentences. B2: 3–5 sentences with some subordination. Keep it to one breath-group per sentence — a learner must be able to hold it in working memory.
- **Listenable, not a trap.** Avoid deliberate tongue-twisters, dense number/date sequences, proper-noun pile-ups, and segmentation traps so ambiguous that even a native could not transcribe them. One or two natural connected-speech challenges (sinalefa, a silent letter, a tricky boundary) are good; a wall of them is not.
- **Vocabulary band.** Every content word at or below CEFR {{cefrLevel}} everyday vocabulary. No above-level or specialist terms.
- **Safe, neutral topics.** Home, food, daily routine, travel, weather, study/work. Avoid weapons, substances, violence, and culturally sensitive or stereotyping content.
- **referenceText is the single source of truth.** \`sentences\` MUST be exactly \`referenceText\` split into its sentences (joining them with single spaces reproduces \`referenceText\`). \`durationSec\` is your best estimate of the spoken length at a natural pace.
- **One clip per tool call.** Do not batch multiple passages.
- You MUST use the {{toolName}} tool. Do not return plain text.

## Output

Use the {{toolName}} tool with all required fields populated.`;

export function computeDictationGenerationPromptVars(
  inputs: GenerationPromptInputs,
): Record<string, string> {
  if (inputs.exerciseType !== ExerciseType.DICTATION) {
    throw new Error(
      "computeDictationGenerationPromptVars: non-dictation cell routed to the dictation prompt",
    );
  }
  const { language, cefrLevel, grammarPoint } = inputs;
  return {
    language,
    cefrLevel,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    toolName: "submit_dictation_exercise",
  };
}

export async function buildDictationGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
): Promise<string> {
  const vars = computeDictationGenerationPromptVars(inputs);
  const { text } = await getPromptWithVarsOrFallback(
    "dictation-generate-system-prompt",
    DICTATION_GENERATION_SYSTEM_PROMPT,
    DICTATION_GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildDictationGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
): string {
  const domain = topicDomain ?? "mixed everyday topics";
  return `Produce dictation clip #${ordinal + 1}.

Topic domain: ${domain}

Vary the domain, sentence shapes, and vocabulary from clip to clip so a batch is diverse. Use the submit_dictation_exercise tool.`;
}
