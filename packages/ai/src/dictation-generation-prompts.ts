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

import { ExerciseType } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";
import { renderLevelScopeSection } from "./level-scope.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// Bump in the same commit as any semantic edit to the template below.
export const DICTATION_GENERATION_PROMPT_VERSION = "dictation-generate@2026-06-23";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Curated everyday topic domains for dictation clips. A1-expressible (a learner
 * can hear a simple sentence on any of these). The generator gets a DISTINCT
 * domain per ordinal (see `dictationDomainForOrdinal`) so a batch spreads across
 * topics instead of collapsing on one scene — the dedup index (`_dedupKey` =
 * normalized referenceText) otherwise rejects the near-duplicates, starving the
 * pool at A1/A2 where the per-domain sentence space is small.
 */
export const DICTATION_DOMAINS: readonly string[] = [
  "home and family",
  "food and meals",
  "daily routine",
  "weather and seasons",
  "school and study",
  "shopping and the market",
  "free time and the weekend",
  "work and jobs",
  "travel and transport",
  "health and the body",
];

/**
 * Distinct topic domain for a draft. Rotates `DICTATION_DOMAINS` by `ordinal`,
 * offset by a deterministic hash of `batchSeed` so different batches (ticks)
 * start at a different domain — giving both in-batch spread and cross-tick
 * variety without any cross-batch DB lookup. Pure; mirrors
 * `sentenceConstructionModeForOrdinal`.
 */
export function dictationDomainForOrdinal(
  ordinal: number,
  batchSeed: string,
): string {
  let offset = 0;
  for (let i = 0; i < batchSeed.length; i++) {
    offset = (offset + batchSeed.charCodeAt(i)) % DICTATION_DOMAINS.length;
  }
  return DICTATION_DOMAINS[(ordinal + offset) % DICTATION_DOMAINS.length];
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

{{levelScopeSection}}## Hard constraints

- **Natural connected speech.** Write the way a native speaker actually talks: full sentences with normal punctuation, ordinary contractions and liaison. NOT a word list, NOT headings, NOT bullet points, NOT metadata.
- **Length for level.** A1: ONE short, clearly-articulated everyday sentence — high-frequency A1 vocabulary, simple structures, minimal connected-speech reduction (a careful near-beginner should be able to transcribe it). A2: 1–2 short sentences with everyday A2 vocabulary and only light connected speech. B1: 2–4 short sentences. B2: 3–5 sentences with some subordination. Keep it to one breath-group per sentence — a learner must be able to hold it in working memory.
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
    // Curriculum scope so the generator targets the level's real morphology
    // (e.g. A1 consonant softening / -iyor are in scope) rather than guessing.
    // Mirrors the validator; formatter gates by type (dictation now included).
    levelScopeSection: renderLevelScopeSection(
      ExerciseType.DICTATION,
      language,
      cefrLevel,
      inputs.levelScopePoints,
    ),
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
  batchSeed: string,
  seedWord: string | null = null,
): string {
  // A caller-supplied topicDomain (CLI passthrough) pins all ordinals to one
  // domain; scheduled runs (null) get a distinct domain per ordinal so the batch
  // spreads across topics.
  const domain = topicDomain ?? dictationDomainForOrdinal(ordinal, batchSeed);
  // Per-ordinal frequency seed (R5-style, loose). The lemma is a lexical anchor,
  // not a hard requirement — the model may swap it for a related word of similar
  // frequency if it doesn't fit a natural clip. This is the primary diversity
  // lever; the topic domain is a secondary topical axis. Absent → domain only.
  const seedLine = seedWord
    ? `\nAnchor the clip on the word "${seedWord}" (or a closely related word of similar frequency if it does not fit a natural sentence).\n`
    : "";
  return `Produce dictation clip #${ordinal + 1}.

Topic domain: ${domain}
${seedLine}
Build the clip around this topic domain; vary the specific scene, sentence shapes, and vocabulary so it does not resemble other clips. Use the submit_dictation_exercise tool.`;
}
