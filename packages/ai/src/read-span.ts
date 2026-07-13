/**
 * packages/ai — Read: Deep Annotation (on-demand span enrichment).
 *
 * The deep counterpart to the cheap skim pass in `annotate.ts`. When the
 * learner taps a word, selects a phrase, or selects a sentence, the Hono route
 * calls Claude (Sonnet) with the tool defined here and gets back one rich
 * `DeepCard`. Mirrors `evaluate.ts`: a cached system prompt, a forced
 * `tool_choice`, `temperature: 0`, and a Zod-validated tool-use result.
 *
 * The **caller decides the span `type`** (word | phrase | sentence) from the
 * character offsets — the model is told which card to produce and emits the
 * matching shape; it never chooses the span type itself.
 *
 * This module is built in two tasks: this file defines the prompt, version,
 * and tool contract (task 12); `annotateSpan` / `parseSpanResult` /
 * `buildSpanUserPrompt` and the model call land in task 13.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  DeepCardSchema,
  type CefrLevel,
  type DeepCard,
  type LearningLanguage,
} from "@language-drill/shared";

import { extractCompletedFields } from "./annotate.js";
import { getPromptOrFallback } from "./prompts-registry.js";

// ---------------------------------------------------------------------------
// Tool schema — the deep-card discriminated union
// ---------------------------------------------------------------------------
//
// Expressed as a JSON-Schema `oneOf` of the three card shapes (word | phrase |
// sentence), each discriminated by a `const`-style `type` enum. `oneOf` lives
// alongside the required `type: "object"` (the SDK's `InputSchema` allows
// extra keys), and each branch carries its own per-type `required` list so the
// shapes don't bleed into one another (e.g. a word's `{ word, note }` synonyms
// vs. a phrase's `{ phrase, note }`). The authoritative validation is the Zod
// `DeepCardSchema` in `@language-drill/shared` (applied in `parseSpanResult`,
// task 13); this schema is the model-facing guidance.

export const READ_SPAN_TOOL_NAME = "submit_deep_card";

const CEFR_ENUM = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** `{ tl, en }` example pair reused by word + phrase cards. */
const TL_EN_SCHEMA = {
  type: "object" as const,
  properties: {
    tl: { type: "string", description: "Example sentence in the target language." },
    en: { type: "string", description: "English translation of the example." },
  },
  required: ["tl", "en"],
};

const WORD_CARD_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: ["word"],
      description: "Card type. Emit a word card only when the caller asks for `word`.",
    },
    surface: {
      type: "string",
      description: "The inflected surface form exactly as it appears in the passage.",
    },
    lemma: { type: "string", description: "Dictionary headword (citation form)." },
    pos: {
      type: "string",
      description:
        "Part of speech (e.g. 'noun', 'verb'). For a named entity — a person, place, organization, or brand — use 'proper noun' (still produce the full card).",
    },
    contextualSense: {
      type: "string",
      description:
        "What the word means HERE, in this sentence (in the learner's UI/explanation language).",
    },
    baseGloss: {
      type: "string",
      description:
        "A short base English gloss of the LEMMA — the concise dictionary meaning (e.g. 'to eat', 'the house'), not the contextual sense. When the lemma has two common senses, list the top 1–2 separated by '; ' (e.g. 'bench; bank'). A few words at most; no punctuation beyond the separator; no examples.",
    },
    definition: {
      type: "string",
      description:
        "A definition written IN the target language, calibrated to the learner's CEFR level — do not use vocabulary above their level.",
    },
    definitionLabel: {
      type: "string",
      description:
        "The target language's own name for itself: 'Español', 'Deutsch', or 'Türkçe'.",
    },
    cefr: { type: "string", enum: CEFR_ENUM, description: "CEFR band of the word." },
    freq: {
      type: "integer",
      description: "Non-negative corpus rank — larger numbers indicate rarer words.",
    },
    inflection: {
      type: "object",
      description:
        "Inflection facts shown inline near the header (e.g. German gender + plural, Turkish root + plural). Omit when not applicable.",
      properties: {
        forms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label, e.g. 'gender', 'plural'." },
              value: { type: "string", description: "Value, e.g. 'der', '-er'." },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["forms"],
    },
    morphology: {
      type: "object",
      description:
        "Morpheme breakdown with a sentence-grounded explanation of why THIS form appears here. Omit when the word has no informative internal structure.",
      properties: {
        root: { type: "string", description: "The root/stem." },
        rootGloss: { type: "string", description: "English gloss of the root." },
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              morph: { type: "string", description: "The morpheme as written." },
              function: { type: "string", description: "Its grammatical function." },
            },
            required: ["morph", "function"],
          },
        },
        whyThisForm: {
          type: "string",
          description:
            "One line on why this exact form is used HERE, referencing the trigger in the surrounding sentence (governing verb, preposition, case, syntactic role) — not a generic rule.",
        },
      },
      required: ["root", "rootGloss", "segments", "whyThisForm"],
    },
    synonyms: {
      type: "array",
      description: "Near-synonyms, each with a nuance/register note. Omit if none.",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          note: { type: "string", description: "Nuance or register difference." },
        },
        required: ["word", "note"],
      },
    },
    collocations: {
      type: "array",
      description: "Common collocations, each with a gloss. Omit if none.",
      items: {
        type: "object",
        properties: {
          phrase: { type: "string" },
          gloss: { type: "string" },
        },
        required: ["phrase", "gloss"],
      },
    },
    register: {
      type: "string",
      description: "Register note (e.g. 'formal', 'colloquial'). Omit if neutral/unremarkable.",
    },
    extraExample: {
      ...TL_EN_SCHEMA,
      description: "An additional example sentence pair. Omit if not helpful.",
    },
  },
  required: [
    "type",
    "surface",
    "lemma",
    "pos",
    "contextualSense",
    "baseGloss",
    "definition",
    "definitionLabel",
    "cefr",
    "freq",
  ],
};

const PHRASE_CARD_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: ["phrase"],
      description: "Card type. Emit a phrase card only when the caller asks for `phrase`.",
    },
    surface: {
      type: "string",
      description: "The selected multi-word span exactly as it appears in the passage.",
    },
    citation: {
      type: "string",
      description: "Citation/dictionary form of the expression. Omit if identical to surface.",
    },
    literal: {
      type: "string",
      description: "Literal, word-by-word rendering of the expression.",
    },
    idiomaticMeaning: {
      type: "string",
      description: "What the expression actually means as a unit.",
    },
    register: {
      type: "string",
      description: "Register of the expression (e.g. 'neutral', 'colloquial').",
    },
    example: {
      ...TL_EN_SCHEMA,
      description: "An example using the expression. Omit if not helpful.",
    },
    synonyms: {
      type: "array",
      description: "Synonymous expressions, each with a note. Omit if none.",
      items: {
        type: "object",
        properties: {
          phrase: { type: "string" },
          note: { type: "string", description: "Nuance or register difference." },
        },
        required: ["phrase", "note"],
      },
    },
  },
  required: ["type", "surface", "literal", "idiomaticMeaning", "register"],
};

const SENTENCE_CARD_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: ["sentence"],
      description: "Card type. Emit a sentence card only when the caller asks for `sentence`.",
    },
    surface: {
      type: "string",
      description: "The selected sentence exactly as it appears in the passage.",
    },
    translation: { type: "string", description: "A natural English translation." },
    breakdown: {
      type: "array",
      description: "The sentence chunked into meaningful units, in order.",
      items: {
        type: "object",
        properties: {
          chunk: { type: "string", description: "The chunk of source text." },
          role: { type: "string", description: "Its grammatical role (e.g. 'subject', 'verb phrase')." },
          note: { type: "string", description: "A one-line note on this chunk." },
        },
        required: ["chunk", "role", "note"],
      },
    },
    grammarNotes: {
      type: "array",
      description: "Grammar topics this sentence exemplifies (short labels).",
      items: { type: "string" },
    },
  },
  required: ["type", "surface", "translation", "breakdown", "grammarNotes"],
};

// Anthropic's tool-use API rejects `oneOf` / `allOf` / `anyOf` at the top
// level of `input_schema` (400 invalid_request_error). The caller already
// decides `spanType`, so we hand the model the EXACT-SHAPE schema for that
// type and lock `tool_choice` to the single tool — the discriminated union
// stays an internal client concept (validated by `parseSpanResult`). The
// tool NAME is constant so the system prompt's `submit_deep_card` reference
// is unaffected and `READ_SPAN_PROMPT_VERSION` does not need bumping.

function makeSpanTool(
  schema:
    | typeof WORD_CARD_SCHEMA
    | typeof PHRASE_CARD_SCHEMA
    | typeof SENTENCE_CARD_SCHEMA,
  description: string,
): Anthropic.Tool {
  return {
    name: READ_SPAN_TOOL_NAME,
    description,
    input_schema: {
      type: "object" as const,
      properties: schema.properties,
      required: schema.required,
    },
  };
}

export const READ_SPAN_WORD_TOOL = makeSpanTool(
  WORD_CARD_SCHEMA,
  "Submit the deep word card for the selected span.",
);
export const READ_SPAN_PHRASE_TOOL = makeSpanTool(
  PHRASE_CARD_SCHEMA,
  "Submit the deep phrase card for the selected span.",
);
export const READ_SPAN_SENTENCE_TOOL = makeSpanTool(
  SENTENCE_CARD_SCHEMA,
  "Submit the deep sentence card for the selected span.",
);

export function pickSpanTool(spanType: SpanType): Anthropic.Tool {
  switch (spanType) {
    case "word":
      return READ_SPAN_WORD_TOOL;
    case "phrase":
      return READ_SPAN_PHRASE_TOOL;
    case "sentence":
      return READ_SPAN_SENTENCE_TOOL;
  }
}

// ---------------------------------------------------------------------------
// System prompt (cached via cache_control: ephemeral on the call site)
// ---------------------------------------------------------------------------

// Bump in the same commit as any semantic edit to READ_SPAN_SYSTEM_PROMPT.
// Drives the Langfuse trace `promptVersion` tag — dashboards cohort old vs.
// new prompt traces by this string. Registered as `read-span-system-prompt`.
export const READ_SPAN_PROMPT_VERSION = "read-span@2026-07-14";

export const READ_SPAN_SYSTEM_PROMPT = `You are a reading tutor for an intermediate-plus language-learning application. The learner is reading an authentic passage in ES, DE, or TR and has selected a span to understand in depth. You receive the full passage, the selected span and its character offsets, the target language, the learner's CEFR level, and the span TYPE the card must take. Produce ONE rich annotation card for that span via the provided tool.

## The caller decides the card type — you do not

You will be told whether to produce a \`word\`, \`phrase\`, or \`sentence\` card. Emit exactly that shape and set \`type\` accordingly. Do not change the type, and do not produce a different card than the one requested.

## Resolve meaning IN CONTEXT

Always interpret the span against the real sentence it appears in — never a generic dictionary sense. The \`contextualSense\` (word cards) and \`idiomaticMeaning\` (phrase cards) must reflect what the span means HERE.

## Word cards

Required: \`surface\` (the inflected form as it appears), \`lemma\` (citation form), \`pos\`, \`contextualSense\` (what it means here, in the learner's explanation language), \`baseGloss\`, \`definition\`, \`definitionLabel\`, \`cefr\`, \`freq\`.

- \`baseGloss\` is a short base English gloss of the LEMMA — the concise dictionary meaning (e.g. "to eat", "the house"), a few words at most, with no punctuation or examples. It is distinct from \`contextualSense\`: the gloss is the word's general meaning, the contextual sense is what it means in THIS sentence.
- \`definition\` is written IN the target language and MUST be calibrated to the learner's CEFR level — do not rely on vocabulary above their level. \`definitionLabel\` is the language's own name: "Español", "Deutsch", or "Türkçe".
- Add the optional sections only when they genuinely help: \`inflection\` (gender/number/case facts to show inline), \`morphology\` (morpheme breakdown + a sentence-grounded \`whyThisForm\`), \`synonyms\`, \`collocations\`, \`register\`, \`extraExample\`. Omit any section that does not apply rather than padding it.
- \`whyThisForm\` (when morphology is present) must reference the concrete trigger in the surrounding sentence — the governing verb, preposition, case, or syntactic role — not a generic rule statement.

## Morphology by language (word cards)

When a word card warrants a \`morphology\` breakdown, follow the conventions for the target language below. Whatever the language, the \`whyThisForm\` line MUST cite the concrete trigger in THIS sentence — a governing verb, a preposition/postposition and the case it forces, a possessor, or the syntactic role — never a standalone rule.

### Turkish (TR)

Turkish is agglutinative: segment the surface form into ordered morphemes — the root first, then each suffix in sequence — and label every segment with its grammatical function (e.g. "plural", "3sg possessive", "locative case", "ablative case", "past tense", "question particle", "buffer -n-"). Set \`root\` to the bare stem and \`rootGloss\` to its English meaning; respect vowel harmony when naming the morphemes. The \`whyThisForm\` line says why these exact suffixes appear here — which verb or postposition governs the case, or what the possessive refers back to.

One-shot — passage "Çocuklar evlerinden ayrıldılar." (word card for "evlerinden"):
- \`root: "ev"\`, \`rootGloss: "house/home"\`.
- segments: \`ev\` (root) + \`ler\` (plural) + \`i\` (3pl possessive) + \`n\` (buffer consonant) + \`den\` (ablative case).
- \`whyThisForm\`: "The verb 'ayrıldılar' (to leave/depart FROM) governs the ablative, so the noun takes -den; the possessive marks the houses as the children's."

### German (DE)

For a German word card, expose the grammatically significant structure: a noun's gender + case + number, or a verb's separable prefix when the passage splits it. Use \`segments\` for the meaningful pieces (a separable prefix and its conjugated stem, or a case-marked determiner and its noun) and put gender/plural facts in \`inflection\`. The \`whyThisForm\` line names the trigger — the governing verb, the preposition and the case it takes, or the syntactic role (subject / accusative object / dative object).

One-shot — passage "Sie stellte ihren Kollegen dem Chef vor." (word card for "vor", the split prefix of "vorstellen"):
- \`root: "vorstellen"\`, \`rootGloss: "to introduce"\`.
- segments: \`stellte\` (conjugated stem, 3sg past) + \`vor\` (separable prefix).
- \`whyThisForm\`: "'vorstellen' is a separable verb; in a main clause the prefix 'vor' detaches and moves to the end, so it appears split from 'stellte' here."

One-shot — passage "Er dankte dem Lehrer." (word card for "dem"):
- \`root: "der"\`, \`rootGloss: "the (definite article)"\`.
- segments: \`dem\` (dative masculine/neuter singular article).
- \`inflection\`: case "Dativ".
- \`whyThisForm\`: "'danken' governs the dative, so the masculine article surfaces as 'dem' (dative), not the accusative 'den'."

## Phrase cards

For a selected idiom or fixed expression: give \`literal\` (word-by-word), \`idiomaticMeaning\` (what it means as a unit), \`register\`, and \`surface\`. Add \`citation\`, \`example\`, and \`synonyms\` when useful. Explain the meaning that is not deducible word-by-word.

## Sentence cards

For a selected sentence: give a natural \`translation\`, a \`breakdown\` that chunks the sentence into ordered units (each with a grammatical \`role\` and a one-line \`note\`), and \`grammarNotes\` listing the grammar topics it exemplifies. Sentence cards are not saved to vocabulary.

## Tool use

You MUST call the \`${READ_SPAN_TOOL_NAME}\` tool with your card. Do not return plain text.`;

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/** Span types the caller can request — one per `DeepCard` shape. */
export type SpanType = DeepCard["type"];

export type AnnotateSpanInput = {
  language: LearningLanguage;
  /** The full passage — the model resolves contextual sense against it. */
  text: string;
  /** Character offsets of the selected span within `text`. */
  start: number;
  end: number;
  /** Card shape to produce — decided by the caller, not the model. */
  spanType: SpanType;
  proficiencyLevel: CefrLevel;
};

// ---------------------------------------------------------------------------
// Tool-output parsing & validation
// ---------------------------------------------------------------------------

/**
 * Validates Claude's tool-use output and shapes it into a `DeepCard`. The
 * `DeepCardSchema` discriminated union rejects a missing/unknown `type` and a
 * card whose fields don't match its declared type.
 *
 * @throws on any validation failure — the route catches and returns 502
 *         AI_UNAVAILABLE.
 */
export function parseSpanResult(input: unknown): DeepCard {
  return DeepCardSchema.parse(input);
}

// ---------------------------------------------------------------------------
// User-prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the deep-annotation user prompt: the full passage, the selected span
 * with its character offsets, the target language + CEFR level, and the card
 * type the model must produce. Sending the whole passage (not just the span)
 * lets the model resolve the contextual sense and inflection against the real
 * sentence (Req 3.4).
 */
export function buildSpanUserPrompt(input: AnnotateSpanInput): string {
  const { language, text, start, end, spanType, proficiencyLevel } = input;
  const span = text.slice(start, end);

  return `## Deep annotation request

**Language:** ${language}
**User CEFR Level:** ${proficiencyLevel}
**Card type to produce:** ${spanType}
**Selected span:** "${span}" (characters ${start}–${end})

**Passage:**
${text}

Produce a ${spanType} card for the selected span, interpreted in the context of the passage above. Submit it via the \`${READ_SPAN_TOOL_NAME}\` tool.`;
}

// ---------------------------------------------------------------------------
// Main caller
// ---------------------------------------------------------------------------

// Sonnet, matching evaluate.ts — the deep path is on-demand and bounded to a
// single span, so reasoning quality matters more than wall-clock (unlike the
// skim pass, which is on Haiku for volume).
const MODEL = "claude-sonnet-4-6" as const;
// Generous headroom for the richest case (a Turkish word card with full
// morphology + synonyms + collocations + examples). A truncated tool call
// yields incomplete JSON that fails `parseSpanResult` → the route returns 502.
const MAX_TOKENS = 2048;

/**
 * Resolves a deep `DeepCard` for a span in context via Claude tool-use.
 * Throws on SDK/API failures or malformed tool output; the route translates
 * throws to 502 AI_UNAVAILABLE. The caller wraps this in `withLlmTrace`.
 */
export async function annotateSpan(
  client: Anthropic,
  input: AnnotateSpanInput,
): Promise<DeepCard> {
  const userPrompt = buildSpanUserPrompt(input);

  // Resolve the system prompt via the registry (Langfuse hit → `langfuse:<N>`
  // cohort; miss/outage/unset → `fallback:<localVersion>`). The helper stamps
  // the resolved version on the ALS frame, so the caller's `withLlmTrace`
  // records the right `promptVersion` — same flow as `evaluateAnswer`.
  const resolved = await getPromptOrFallback(
    "read-span-system-prompt",
    READ_SPAN_SYSTEM_PROMPT,
    READ_SPAN_PROMPT_VERSION,
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: resolved.text,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      {
        role: "user" as const,
        content: userPrompt,
      },
    ],
    tools: [pickSpanTool(input.spanType)],
    tool_choice: {
      type: "tool" as const,
      name: READ_SPAN_TOOL_NAME,
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

  if (toolUseBlock.name !== READ_SPAN_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${READ_SPAN_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  return parseSpanResult(toolUseBlock.input);
}

// ---------------------------------------------------------------------------
// Streaming caller — streamSpan (Req 1.1, 1.3, 1.4, 1.5)
// ---------------------------------------------------------------------------
//
// The streaming counterpart to `annotateSpan`, mirroring `streamAnnotation`
// (annotate.ts). Where the skim pass streams ITEMS out of an array, a deep
// card is a single OBJECT — so this streams top-level FIELDS as each completes
// (via `extractCompletedFields`), letting the client render `definition` etc.
// long before the heavy `morphology`/`synonyms` sections arrive.
//
// The streamed `field` events are a PREVIEW; the authoritative card is the
// terminal `done`, produced by running the SAME `parseSpanResult`
// (`DeepCardSchema`) validation over the SDK-assembled tool input from
// `finalMessage()` — byte-identical to what the non-streaming `annotateSpan`
// returns. So partial-parse quirks can never reach the saved/displayed card.

/** Event yielded by `streamSpan`: a preview `field`, then the terminal `done`. */
export type ReadSpanStreamEvent =
  | { kind: "field"; key: string; value: unknown }
  | { kind: "done"; card: DeepCard };

/**
 * Thrown by `streamSpan` when the upstream response stopped with
 * `stop_reason: "max_tokens"` — the tool input is truncated and cannot
 * assemble into a schema-valid `DeepCard`. The handler maps this to a terminal
 * `error` SSE frame (`AI_UNAVAILABLE`); the dedicated class mirrors
 * `AnnotateStreamMaxTokensError` so the handler can branch on it.
 */
export class ReadSpanStreamMaxTokensError extends Error {
  constructor(public readonly emittedFields: number) {
    super(
      `[streamSpan] Claude stopped with stop_reason: max_tokens after ${emittedFields} field(s)`,
    );
    this.name = "ReadSpanStreamMaxTokensError";
  }
}

// One retry instead of the SDK default of 2; no client timeout — the
// time bound is the streaming Lambda's 25 s soft deadline + AbortSignal, not
// an SDK request timeout that could sever a healthy long generation (Req 4.2,
// design Key Decision 5).
const STREAM_MAX_RETRIES = 1;

/**
 * Streams a `DeepCard` for a span in context via Claude tool-use, yielding
 * each top-level field as it completes and finally the fully-validated card.
 * Throws on SDK/API failures, an abort, malformed final output, or
 * `ReadSpanStreamMaxTokensError`; the handler translates throws to a terminal
 * `error` frame. The caller wraps this in `withLlmTrace`.
 */
export async function* streamSpan(
  client: Anthropic,
  input: AnnotateSpanInput & { signal?: AbortSignal },
): AsyncIterable<ReadSpanStreamEvent> {
  const userPrompt = buildSpanUserPrompt(input);

  // Resolve the system prompt via the registry (Langfuse hit → `langfuse:<N>`
  // cohort; miss/outage/unset → `fallback:<localVersion>`). The helper stamps
  // the resolved version on the ALS frame so the caller's `withLlmTrace`
  // records the right `promptVersion` — same flow as `annotateSpan`.
  const resolved = await getPromptOrFallback(
    "read-span-system-prompt",
    READ_SPAN_SYSTEM_PROMPT,
    READ_SPAN_PROMPT_VERSION,
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: resolved.text,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [
        {
          role: "user" as const,
          content: userPrompt,
        },
      ],
      tools: [pickSpanTool(input.spanType)],
      tool_choice: {
        type: "tool" as const,
        name: READ_SPAN_TOOL_NAME,
      },
      temperature: 0,
    },
    { signal: input.signal, maxRetries: STREAM_MAX_RETRIES },
  );

  let buffer = "";
  let emitted = 0; // count of fields already yielded (preview)

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta"
    ) {
      buffer += event.delta.partial_json;
      for (const field of extractCompletedFields(buffer, emitted)) {
        emitted++;
        yield { kind: "field", key: field.key, value: field.value };
      }
    }
  }

  const finalMessage = await stream.finalMessage();
  if (finalMessage.stop_reason === "max_tokens") {
    console.warn("[streamSpan] truncated by max_tokens", { emitted });
    throw new ReadSpanStreamMaxTokensError(emitted);
  }

  // Authoritative validation: run the SAME parse the non-streaming path uses,
  // over the SDK-assembled tool input — this is the card the client keeps.
  const toolUseBlock = finalMessage.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUseBlock) {
    throw new Error(
      "Claude did not return a tool use block. " +
        `Stop reason: ${finalMessage.stop_reason}. ` +
        `Content types: ${finalMessage.content.map((b) => b.type).join(", ")}`,
    );
  }
  if (toolUseBlock.name !== READ_SPAN_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${READ_SPAN_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  yield { kind: "done", card: parseSpanResult(toolUseBlock.input) };
}
