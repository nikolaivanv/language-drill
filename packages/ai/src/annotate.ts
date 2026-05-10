/**
 * packages/ai — Read & Collect annotation pipeline.
 *
 * Encapsulates the system prompt, tool schema, response parser, and Claude
 * caller used by `POST /read/annotate`. Mirrors the structure of evaluate.ts
 * so the prompt-cache + tool_choice + temperature-0 pattern stays uniform
 * across the two AI surfaces.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  type CefrLevel,
  type LearningLanguage,
  type WordFlag,
  WordFlagSchema,
} from "@language-drill/shared";

// ---------------------------------------------------------------------------
// Tool schema — the structured output Claude must produce
// ---------------------------------------------------------------------------

export const ANNOTATE_TOOL_NAME = "submit_annotated_words";

export const ANNOTATE_TOOL: Anthropic.Tool = {
  name: ANNOTATE_TOOL_NAME,
  description:
    "Submit the list of words from the passage that the learner would benefit from explicitly studying.",
  input_schema: {
    type: "object" as const,
    properties: {
      flagged: {
        type: "array",
        description:
          "Words in the passage rarer than top_rank OR with a CEFR band strictly above the user's level. Empty if none qualify.",
        items: {
          type: "object",
          properties: {
            matchedForm: {
              type: "string",
              description:
                "Lowercased EXACT surface form as it appears in the passage. Becomes the map key client-side.",
            },
            lemma: {
              type: "string",
              description: "Dictionary headword (citation form).",
            },
            pos: {
              type: "string",
              description:
                "Part of speech (e.g. 'noun', 'verb', 'adjective', 'adverb').",
            },
            gloss: {
              type: "string",
              description:
                "Brief English meaning, lowercase, ≤ 80 characters.",
            },
            example: {
              type: "string",
              description:
                "Short example sentence in the target language, using the lemma.",
            },
            freq: {
              type: "integer",
              description:
                "Non-negative corpus rank — larger numbers indicate rarer words.",
            },
            cefr: {
              type: "string",
              enum: ["A1", "A2", "B1", "B2", "C1", "C2"],
              description: "CEFR band the word belongs to.",
            },
          },
          required: [
            "matchedForm",
            "lemma",
            "pos",
            "gloss",
            "example",
            "freq",
            "cefr",
          ],
        },
      },
    },
    required: ["flagged"],
  },
};

// ---------------------------------------------------------------------------
// System prompt (cached via cache_control: ephemeral on the call site)
// ---------------------------------------------------------------------------

export const ANNOTATE_SYSTEM_PROMPT = `You are a reading-level assistant for an intermediate-plus language-learning application. Given a passage in ES, DE, or TR plus the user's CEFR proficiency level and a corpus-frequency rank ceiling ("top_rank"), identify the words a learner at that level would benefit from explicitly studying — and submit them via the provided tool.

## Selection Rule

Flag a word IF AND ONLY IF at least one of the following holds:
- Its surface form OR its lemma has a corpus rank strictly rarer than \`top_rank\`.
- Its CEFR band is strictly above the user's current proficiency level.

Words at or below the user's level — and high-frequency closed-class words like articles, copulas, conjunctions, prepositions, pronouns, modal verbs, and common auxiliaries — MUST NOT be flagged regardless of frequency.

If no words qualify, submit an empty \`flagged\` array. Do not flag words "just to be helpful" — silence is the correct answer for an in-level passage.

Flag AT MOST 40 words per call. If more than 40 words qualify, return only the 40 rarest by corpus rank (largest \`freq\` values).

## Surface Form Requirement

Each flagged item MUST include a \`matchedForm\`: the EXACT lowercased surface form as it appears in the passage (with diacritics preserved). If the same lemma appears in two different inflected forms in the passage, return only the first occurrence's form — duplicates are deduped by first-seen on the server.

The other fields:
- \`lemma\`: the dictionary headword (citation form) — verb infinitive, masculine singular adjective, singular noun.
- \`pos\`: part of speech ("noun", "verb", "adjective", "adverb", etc.).
- \`gloss\`: a brief English meaning, lowercase, ≤ 80 characters.
- \`example\`: a short example sentence in the target language using the lemma (NOT the inflected match).
- \`freq\`: a non-negative integer corpus rank (rarer = larger).
- \`cefr\`: one of "A1", "A2", "B1", "B2", "C1", "C2".

## Per-Language Guidance

### Spanish (ES)

Inflected forms (verb conjugations, plural nouns, gender-marked adjectives) keep their inflection in \`matchedForm\` but reduce to the citation form in \`lemma\`. Skip closed-class words like "la", "el", "los", "un", "y", "pero", "con", "de", "que", "ser", "estar", "haber".

One-shot example — passage "La aldea recibió al pintor con cierta indiferencia.":
- \`matchedForm: "aldea"\`, \`lemma: "aldea"\`, \`pos: "noun"\`, \`gloss: "small village"\`.
- \`matchedForm: "recibió"\`, \`lemma: "recibir"\`, \`pos: "verb"\`, \`gloss: "to receive"\`.
- \`matchedForm: "indiferencia"\`, \`lemma: "indiferencia"\`, \`pos: "noun"\`, \`gloss: "indifference"\`.

### German (DE)

Compound nouns (Wirtschaftsaufschwung) are flagged as a single token. Separable verbs that appear split in the passage (e.g. "stellt … vor") are flagged on the conjugated head ("stellt"), with the lemma being the full infinitive ("vorstellen"). Capitalized nouns are LOWERCASED in \`matchedForm\` but the \`lemma\` keeps the standard noun capitalization. Skip closed-class words like "der", "die", "das", "ein", "und", "aber", "mit", "auf", "ist", "war", "haben".

One-shot example — passage "Der Wirtschaftsaufschwung überraschte die Analysten.":
- \`matchedForm: "wirtschaftsaufschwung"\`, \`lemma: "Wirtschaftsaufschwung"\`, \`pos: "noun"\`, \`gloss: "economic upswing"\`.
- \`matchedForm: "überraschte"\`, \`lemma: "überraschen"\`, \`pos: "verb"\`, \`gloss: "to surprise"\`.
- \`matchedForm: "analysten"\`, \`lemma: "Analyst"\`, \`pos: "noun"\`, \`gloss: "analyst"\`.

### Turkish (TR)

Agglutinative suffixes mean a single lemma can produce many surface forms. Flag the surface form as it appears (with all suffixes) in \`matchedForm\`; the \`lemma\` is the bare citation form (verb infinitive in -mak/-mek; bare noun without case/possessive markers). Account for vowel harmony when picking the citation form. Skip closed-class words like "ve", "ile", "için", "ama", "bu", "şu", "o", "bir".

One-shot example — passage "Aceleci davranışlarıyla yeni komşusunu şaşırttı.":
- \`matchedForm: "aceleci"\`, \`lemma: "aceleci"\`, \`pos: "adjective"\`, \`gloss: "hasty"\`.
- \`matchedForm: "davranışlarıyla"\`, \`lemma: "davranış"\`, \`pos: "noun"\`, \`gloss: "behavior"\`.
- \`matchedForm: "şaşırttı"\`, \`lemma: "şaşırtmak"\`, \`pos: "verb"\`, \`gloss: "to surprise"\`.

## Tool Use

You MUST call the \`submit_annotated_words\` tool with your output. Do not return plain text. If the passage contains no qualifying words, call the tool with \`flagged: []\`.`;

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export type AnnotateInput = {
  text: string;
  language: LearningLanguage;
  proficiencyLevel: CefrLevel;
  topRank: number;
};

export type AnnotateOutput = { flagged: Record<string, WordFlag> };

// ---------------------------------------------------------------------------
// Tool-output parsing & validation
// ---------------------------------------------------------------------------

const MatchedFormSchema = z.string().min(1).max(120);

/**
 * Validates Claude's tool-use output and shapes it into AnnotateOutput.
 *
 * - Each item must include a non-empty `matchedForm` (≤ 120 chars).
 * - The remaining fields are validated against `WordFlagSchema`.
 * - Duplicate `matchedForm` values are silently dropped (first-seen wins).
 *
 * @throws on any per-item validation failure — the route handler catches and
 *         returns 502 AI_UNAVAILABLE per Requirement 5.7.
 */
export function parseAnnotateResult(input: unknown): AnnotateOutput {
  if (typeof input !== "object" || input === null) {
    throw new Error(
      `Annotate result must be an object (got typeof ${typeof input})`,
    );
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.flagged)) {
    throw new Error(
      `Annotate result.flagged must be an array (got typeof ${typeof raw.flagged}; keys: [${Object.keys(raw).join(", ")}])`,
    );
  }

  const flagged: Record<string, WordFlag> = {};
  for (const item of raw.flagged) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each flagged item must be an object");
    }
    const { matchedForm, ...rest } = item as Record<string, unknown>;
    const key = MatchedFormSchema.parse(matchedForm);
    if (Object.prototype.hasOwnProperty.call(flagged, key)) continue;
    flagged[key] = WordFlagSchema.parse(rest);
  }

  return { flagged };
}

// ---------------------------------------------------------------------------
// User-prompt builder
// ---------------------------------------------------------------------------

function buildAnnotateUserPrompt(input: AnnotateInput): string {
  return `## Passage to annotate

**Language:** ${input.language}
**User CEFR Level:** ${input.proficiencyLevel}
**top_rank:** ${input.topRank}

**Passage:**
${input.text}

Flag every word in the passage rarer than top-${input.topRank} OR with a CEFR band strictly above ${input.proficiencyLevel}. Skip closed-class words. Submit via the \`${ANNOTATE_TOOL_NAME}\` tool.`;
}

// ---------------------------------------------------------------------------
// Main caller
// ---------------------------------------------------------------------------

// Haiku, not Sonnet — annotate is the only AI surface where output volume can
// approach the 29s Lambda budget (A1 + Turkish ⇒ many flags × 7-field JSON
// entries). Sonnet's per-token output rate caused Lambda timeouts in prod
// after the MAX_TOKENS bump in PR #49; Haiku is 2–3× faster on tool-use and
// fits comfortably inside the 29s ceiling. Other AI surfaces (evaluate,
// validate, generate) keep Sonnet — they have small, bounded outputs.
const MODEL = "claude-haiku-4-5-20251001" as const;
// Sized for the worst case (A1 user → top_rank 750 → most content words in a
// 2000-char passage qualify, each emitted as a 7-field JSON entry). 2048 was
// undersized and truncated mid-tool-call, leaving `flagged` non-array at parse
// time. The prompt also caps output to 40 words so realistic usage stays far
// below this budget.
const MAX_TOKENS = 8192;

/**
 * Annotates a passage via Claude tool-use. Throws on SDK/API failures or
 * malformed tool output; the route translates throws to 502 AI_UNAVAILABLE.
 */
export async function annotateText(
  client: Anthropic,
  input: AnnotateInput,
): Promise<AnnotateOutput> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: ANNOTATE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      {
        role: "user" as const,
        content: buildAnnotateUserPrompt(input),
      },
    ],
    tools: [ANNOTATE_TOOL],
    tool_choice: {
      type: "tool" as const,
      name: ANNOTATE_TOOL_NAME,
    },
    temperature: 0,
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUseBlock) {
    throw new Error(
      "Claude did not return a tool use block. " +
        `Stop reason: ${response.stop_reason}. ` +
        `Content types: ${response.content.map((b) => b.type).join(", ")}`,
    );
  }

  if (toolUseBlock.name !== ANNOTATE_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${ANNOTATE_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  // Named branch for the truncation case so CloudWatch shows the cause
  // directly. The SDK aggregates partial input_json_delta chunks into
  // `input`, which leaves `flagged` missing or non-array — without this
  // check the generic parser error wins and the truncation signal is lost.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Claude annotation truncated by max_tokens (output exceeded budget)",
    );
  }

  return parseAnnotateResult(toolUseBlock.input);
}
