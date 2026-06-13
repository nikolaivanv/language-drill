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
  coverageAxesFor,
  type CoverageAxis,
  ExerciseType,
  type SentenceConstructionContent,
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
export const VALIDATION_PROMPT_VERSION = "validate@2026-06-13";

export const VALIDATION_SYSTEM_PROMPT_TEMPLATE = `You are a strict reviewer of language exercises for {{language}} learners at CEFR {{cefrLevel}}. Your job is to validate one already-generated exercise that targets the grammar point: {{grammarPointName}}.

Be conservative. Reject anything ambiguous, anything mis-leveled, anything that fails to target the configured grammar point, and anything with cultural issues. Score on the high side only when the exercise is genuinely unambiguous, well-leveled, and on-point.

## Routing implication of your scores

Your output is routed by these rules:
- qualityScore < 0.5  OR  any cultural issue  OR  contextSpoilsAnswer  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND not ambiguous AND not contextSpoilsAnswer AND levelMatch AND grammarPointMatch
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

1. **qualityScore** (0.0–1.0): overall fitness. Anchor to one of the values below; interpolate only when a draft sits cleanly between two anchors. Do NOT default to 0.7/0.75 as a "looks OK" floor.
   - **1.0** — exceptional; could anchor a published textbook unit.
   - **0.9** — publishable as-is by a native-speaker teacher.
   - **0.8** — publishable with one cosmetic edit.
   - **0.65** — borderline; clear issue but salvageable. Routes to FLAGGED.
   - **0.5** — unusable; reject. Routes to REJECTED.
2. **ambiguous** (boolean): more than one substantively-correct answer? For **cloze**, true when multiple lexemes/forms satisfy the grammar point in this sentence AND \`acceptableAnswers\` does not enumerate them. For **translation**, surface variation is fine; structurally different correct translations is ambiguous. For **vocab_recall**, the prompt must pick out exactly one headword.
   - "Sınıfta sekiz ___ var." / \`correctAnswer: "öğrenci"\` — sandalye, kalem, kitap, defter all satisfy no-plural-after-numeral equally; needs \`acceptableAnswers\`.
   - "Evde yeni ___ var. Onlar çok güzel." / \`correctAnswer: "perdeler"\` — perdeler, kitaplar, çiçekler, lambalar all fit "plural + positive descriptor"; the follow-on doesn't disambiguate. Needs \`acceptableAnswers\` or tighter framing ("Onları yıkamayı unutma" picks out perdeler).
   - "Ben çok mutlu___" / \`correctAnswer: "um"\` or \`"yum"\` — buffer-consonant blank: vowel-final stem "mutlu" + 1sg copular \`-Im\` requires buffer \`-y-\`. Without \`acceptableAnswers\` listing both ("um" and "yum"), or embedding \`-y-\` in the visible stem as "mutluy___", set \`ambiguous = true\` AND add \`'buffer-consonant ambiguous blank'\` to \`flaggedReasons\`.
   - Translation: no clean production example yet (non-binding); judge "structurally different correct translations" against the spec.
3. **contextSpoilsAnswer** (boolean): does the draft's \`instructions\` or \`context\` state the rule's outcome, name the required suffix/form, or otherwise let the learner write the answer without engaging with the blank? Naming the rule category is fine ("vowel harmony", "plural agreement after a numeral"); stating the outcome is not. Also true when \`context\` exhaustively enumerates every member of the closed set of forms the grammar point selects between. \`true\` is a hard veto.
   - "Vowel harmony: stem 'çocuk' (u = back, unrounded → -lar)" / blank "lar" — context derives the answer from the stem.
   - "Use -da/-de after voiced consonants, -ta/-te after voiceless" / blank one of "-da/-de/-ta/-te" — closed set exhaustively enumerated.
   - "Vowel harmony: front vowel stems take -ler suffix" above "Odada pencere___" / blank "ler" — rule's outcome stated for the exact stem class.
4. **levelMatch** (boolean): does the difficulty match {{cefrLevel}}?
5. **grammarPointMatch** (boolean): does this actually test {{grammarPointName}}?
   - Set \`false\` when the blank's construction is a different grammar-point key from the cell's declared point, **even when grammatically related**. Example: \`correctAnswer: "da"\` in a \`tr-a1-vowel-harmony\` cell tests locative \`-DA\` (belongs in \`tr-a1-locative\`) — the suffix incidentally obeys vowel harmony but the blank tests locative selection. The grammar-point-key boundary is the rule, not the broader grammar family.
6. **culturalIssues** (array of strings): stereotyping, sensitive content, exclusion. Empty array when none.
7. **flaggedReasons** (array of strings): anything else a reviewer should know.
   - Cell over-concentration: when validating a draft for \`tr-a1-vowel-harmony\` (or any grammar-shape cell with multiple surface forms) where the blank tests the plural suffix \`-lAr/-lEr\`, add \`'cell over-concentrated on plural suffix'\`. Soft signal — does not change routing for this draft; aggregates at review time so a >50 % rate surfaces the imbalance.

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

// Per-cell scoring guidance lives in the (uncached, per-draft) user prompt —
// NOT the global system prompt — so a single grammar point's rubric note costs
// tokens only on its own drafts and never inflates every other cell's
// validation. `tr-a1-possessive-suffixes` needs this because the generation
// prompt mandates an overt possessor pronoun to disambiguate the person, but
// the default rubric otherwise dings that same pronoun as "over-scaffolding",
// capping clean drafts at ~0.62 (FLAGGED) instead of auto-approving them.
function clozeCellScoringNote(grammarPointKey: string): string {
  if (grammarPointKey !== "tr-a1-possessive-suffixes") return "";
  return `

**Scoring note for this possessive-suffix (İyelik) cell:** an overt genitive possessor pronoun (benim/senin/onun/bizim/sizin/onların) in the sentence is the INTENDED person-disambiguator — it is what makes the blank unambiguous (the same sentence without it would admit every person). Do NOT lower qualityScore for that pronoun as "over-scaffolding", "telegraphing the person/number", "redundant", or "too mechanical", and do NOT suggest blanking only the suffix (the whole-word blank is by design). The learner must still produce the correctly harmonised WHOLE form, including the 3sg -s- buffer and the dropped buffer vowel after vowel-final stems. Score on naturalness, A1 vocabulary, and whether the stem actually exercises the suffix — a clean draft of this kind (e.g. "Onun ___ çok güzel. (araba)" → arabası) is 0.8+, not 0.62.`;
}

function buildClozeValidationUserPrompt(
  content: ClozeContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Cloze exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Sentence:** ${content.sentence}
**Correct Answer:** ${content.correctAnswer}
${content.acceptableAnswers && content.acceptableAnswers.length > 0 ? `**Acceptable Answers (also accepted):** ${content.acceptableAnswers.join(", ")}` : "**Acceptable Answers (also accepted):** (none declared — `correctAnswer` must be the only plausible fill)"}
${content.options ? `**Options:** ${content.options.join(", ")}` : ""}
${content.context ? `**Context:** ${content.context}` : ""}${clozeCellScoringNote(spec.grammarPoint.key)}

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

function buildSentenceConstructionValidationUserPrompt(
  content: SentenceConstructionContent,
  spec: GenerationSpec,
): string {
  const keywordsLine =
    content.keywords && content.keywords.length > 0
      ? `**Keywords:** ${content.keywords.join(", ")}`
      : "";
  const structureLine = content.targetStructure
    ? `**Target structure:** ${content.targetStructure}`
    : "";
  const registerLine = content.register ? `**Register:** ${content.register}` : "";
  return `## Validate this Sentence Construction exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Prompt mode:** ${content.promptMode}
**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
${keywordsLine}
${structureLine}
${registerLine}
**Model answers:** ${content.modelAnswers.join(" | ")}

Score the dimensions in the system prompt. Treat the exercise as well-formed only if the prompt is unambiguous and solvable at the target level, AND every model answer genuinely satisfies the prompt (keywords used / goal met / target structure used) at the target CEFR level. If a model answer does not exercise the grammar point, set grammarPointMatch=false. Submit via the tool.`;
}

// Per-axis instruction copy for the realized-coverage tags. Appended to the
// (uncached, per-draft) user prompt only for the axes applicable to the cell —
// so non-applicable cells pay zero tokens and the CACHED system prompt stays
// byte-identical. The tool field that receives these is `coverage` (validate.ts).
const COVERAGE_AXIS_DIRECTIVE: Record<CoverageAxis, string> = {
  person:
    "- `coverage.person`: the grammatical person/number the target answer realizes (1sg/2sg/3sg/1pl/2pl/3pl). Report what the draft ACTUALLY produced, not what was requested.",
  wordClass:
    "- `coverage.wordClass`: the part of speech of the target word (noun/verb/adjective/adverb/other).",
  polarity:
    "- `coverage.polarity`: whether the target sentence is affirmative or negative.",
  sentenceType:
    "- `coverage.sentenceType`: the clause type of the target sentence (declarative/interrogative/imperative).",
};

function renderCoverageDirective(spec: GenerationSpec): string {
  const axes = coverageAxesFor(
    spec.exerciseType,
    spec.grammarPoint.personRotation === true,
  );
  if (axes.length === 0) return "";
  const lines = axes.map((axis) => COVERAGE_AXIS_DIRECTIVE[axis]).join("\n");
  return `\n\n**Coverage tags (descriptive only — do NOT change qualityScore based on these):** also fill the \`coverage\` object with the realized value(s) for this draft:\n${lines}`;
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
  let base: string;
  switch (content.type) {
    case ExerciseType.CLOZE:
      base = buildClozeValidationUserPrompt(content, spec);
      break;
    case ExerciseType.TRANSLATION:
      base = buildTranslationValidationUserPrompt(content, spec);
      break;
    case ExerciseType.VOCAB_RECALL:
      base = buildVocabRecallValidationUserPrompt(content, spec);
      break;
    case ExerciseType.SENTENCE_CONSTRUCTION:
      base = buildSentenceConstructionValidationUserPrompt(content, spec);
      break;
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `buildValidationUserPrompt: unsupported content type ${(_exhaustive as { type: ExerciseType }).type}`,
      );
    }
  }
  return base + renderCoverageDirective(spec);
}

