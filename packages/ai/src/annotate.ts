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

import { setResolvedPromptVersion } from "./observability.js";
import { getPromptOrFallback, sha8 } from "./prompts-registry.js";

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

// Bump in the same commit as any semantic edit to ANNOTATE_SYSTEM_PROMPT.
// Drives the Langfuse trace `promptVersion` tag — dashboards cohort old vs.
// new prompt traces by this string.
export const ANNOTATE_SYSTEM_PROMPT_VERSION = "annotate@2026-05-12";

export const ANNOTATE_SYSTEM_PROMPT = `You are a reading-level assistant for an intermediate-plus language-learning application. You receive a passage in ES, DE, or TR AND a server-selected list of words from that passage. For EACH word in the list, produce one enrichment entry — lemma, part of speech, English gloss, an example sentence, frequency rank, and CEFR band — and submit the full set via the provided tool.

## Enrichment Task

You will receive a passage AND a list of words from that passage. For EACH word in the list, emit one tool-use entry with lemma / pos / gloss / example / freq / cefr. Do not add words that are not in the list. Do not skip words that are in the list.

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

/**
 * Input shape for the streaming-annotation generator (task 13). The server's
 * pre-filter has already selected which surface forms are above-level, so
 * Claude's role is purely enrichment: produce a `WordFlag` per candidate.
 *
 * Selection-time inputs (`topRank`, etc.) intentionally do NOT appear here —
 * removing them prevents Claude from second-guessing the server's decision.
 */
export type AnnotateStreamInput = {
  text: string;
  language: LearningLanguage;
  proficiencyLevel: CefrLevel;
  /** Server-selected words to enrich. Must be non-empty. */
  candidates: ReadonlyArray<{ matchedForm: string; lemma: string | null }>;
  /**
   * Optional AbortSignal forwarded to the Anthropic SDK. The handler aborts
   * this when the client disconnects mid-stream so the upstream generation
   * doesn't keep running (Req 4.9).
   */
  signal?: AbortSignal;
  /**
   * Phase-2: bypass the Langfuse registry and use this verbatim as the
   * system prompt. Symmetric with `EvaluateAnswerInput.systemPromptOverride`
   * — there is no eval runner for annotation in Phase 2, but the field is
   * added uniformly so ad-hoc CLI experiments and future eval surfaces
   * can supply a candidate prompt without forking the function. When set,
   * the trace's `promptVersion` is stamped `override:<sha8(text)>`.
   */
  systemPromptOverride?: string;
};

/**
 * Event yielded by `streamAnnotation`. `flag` carries one enriched word
 * (parsed + validated against `WordFlagSchema`); `done` arrives exactly once
 * after the upstream stream completes successfully. Errors are thrown — never
 * returned as a third event variant.
 */
export type AnnotateStreamEvent =
  | { kind: "flag"; flag: WordFlag & { matchedForm: string } }
  | { kind: "done"; flaggedCount: number };

/**
 * Thrown by `streamAnnotation` when the upstream Anthropic response stopped
 * with `stop_reason: 'max_tokens'`. The handler maps this to the
 * `AI_UNAVAILABLE` SSE error code; the dedicated class lets the handler test
 * verify the specific case rather than catching every `Error`.
 */
export class AnnotateStreamMaxTokensError extends Error {
  readonly code = "MAX_TOKENS_TRUNCATED" as const;
  constructor(public readonly flaggedCount: number) {
    super(
      `[streamAnnotation] Claude stopped with stop_reason: max_tokens after ${flaggedCount} flag(s)`,
    );
    this.name = "AnnotateStreamMaxTokensError";
  }
}

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
// Streaming tool-use parser — extractNewItems
// ---------------------------------------------------------------------------
//
// Claude's `input_json_delta` events arrive as JSON-text chunks that, when
// concatenated, form the tool's full input value — shaped like
//   { "flagged": [ { ...item1... }, { ...item2... }, ... ] }
//
// `extractNewItems` is called with the growing buffer and the count of items
// already yielded by previous calls. It returns ONLY the newly-completed
// items, parsed via `JSON.parse`. The caller is `streamAnnotation` (task 13),
// which validates each item against `WordFlagSchema + matchedForm` before
// emitting a `flag` event.
//
// The parser intentionally is NOT a general-purpose streaming JSON decoder:
// it specifically watches for the close-brace of a top-level object inside
// the `flagged` array. Brace depth and in-string state (with `\\`/`\"` escape
// handling) are tracked so that braces / quotes inside string literals do
// not confuse the scanner.
//
// Behavior summary for the contract tests in `annotate-stream.test.ts`:
//   (a) one complete item in one chunk → returns [item]
//   (b) item split across chunks      → returns [] until the closing `}`
//                                       arrives, then [item] on the next call
//   (c) escaped `\"` inside an item   → does NOT terminate the string early
//   (d) nested objects in a value     → depth tracker handles arbitrary nesting
//   (e) malformed / truncated input   → returns [] without throwing

const FLAGGED_KEY = '"flagged"';

/**
 * Internal helper: parse newly-completed array items out of the partial
 * tool-use JSON buffer. Items at indices `< alreadyYielded` are skipped (the
 * caller has already seen them). The function never throws — malformed or
 * truncated input yields an empty result.
 *
 * @internal
 */
export function extractNewItems(buffer: string, alreadyYielded: number): unknown[] {
  const flaggedKeyAt = buffer.indexOf(FLAGGED_KEY);
  if (flaggedKeyAt === -1) return [];

  const arrayStart = buffer.indexOf("[", flaggedKeyAt + FLAGGED_KEY.length);
  if (arrayStart === -1) return [];

  const items: unknown[] = [];
  let i = arrayStart + 1;
  let count = 0;

  while (i < buffer.length) {
    // Skip whitespace / commas between array elements.
    while (i < buffer.length && (buffer[i] === "," || /\s/.test(buffer[i]))) i++;
    if (i >= buffer.length) break;

    const c = buffer[i];
    if (c === "]") break; // end of `flagged` array
    if (c !== "{") break; // truncated or malformed — bail.

    // Scan one top-level object, tracking nested brace depth + string state.
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let objEnd = -1;

    for (; i < buffer.length; i++) {
      const ch = buffer[i];
      if (escape) {
        // The previous char was a backslash; consume this char as a literal.
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      // Not in a string.
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          objEnd = i;
          break;
        }
      }
    }

    if (objEnd === -1) break; // object isn't closed yet — wait for more bytes.

    if (count >= alreadyYielded) {
      try {
        items.push(JSON.parse(buffer.slice(objStart, objEnd + 1)));
      } catch {
        // The brace tracker said this was a complete object, but JSON.parse
        // disagrees. Drop the item silently — the caller logs at warn level.
        // Continue scanning so a single broken item doesn't abort the stream.
      }
    }
    count++;
    i = objEnd + 1;
  }

  return items;
}

// ---------------------------------------------------------------------------
// User-prompt builders
// ---------------------------------------------------------------------------

/**
 * Enrichment-only user prompt for `streamAnnotation` (task 13). Embeds the
 * server-selected candidate list as a numbered list so Claude treats it as a
 * one-to-one enrichment task.
 *
 * Throws on an empty candidate list: in the production handler that path is
 * already short-circuited (Req 1.6 / 2.7 emit `meta` + `done` without calling
 * Claude), so reaching the builder with zero candidates would indicate a bug
 * upstream — fail loud rather than send Claude an empty enrichment request.
 */
export function buildAnnotateUserPrompt(input: AnnotateStreamInput): string {
  if (input.candidates.length === 0) {
    throw new Error(
      "buildAnnotateUserPrompt: candidates must be non-empty (empty lists are short-circuited upstream)",
    );
  }

  const numberedList = input.candidates
    .map((c, i) => {
      const lemmaSuffix = c.lemma !== null && c.lemma !== c.matchedForm ? ` (lemma: ${c.lemma})` : "";
      return `${i + 1}. ${c.matchedForm}${lemmaSuffix}`;
    })
    .join("\n");

  return `## Enrichment Task

**Language:** ${input.language}
**User CEFR Level:** ${input.proficiencyLevel}

**Passage:**
${input.text}

**Words to enrich (${input.candidates.length}):**
${numberedList}

For each word above, emit one tool-use entry whose \`matchedForm\` is exactly the surface form shown. Do not add other words. Do not skip any. Submit via the \`${ANNOTATE_TOOL_NAME}\` tool.`;
}

/**
 * Legacy user prompt for the soon-to-be-removed `annotateText`. Inlined here
 * so the call site doesn't break during the task 12 → 13 transition; deleted
 * in task 13 alongside `annotateText`.
 *
 * @internal
 */
function buildLegacyAnnotateUserPrompt(input: AnnotateInput): string {
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
        content: buildLegacyAnnotateUserPrompt(input),
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

// ---------------------------------------------------------------------------
// Streaming caller — streamAnnotation (Req 4.1–4.9)
// ---------------------------------------------------------------------------
//
// Uses the Anthropic SDK's `messages.stream` API and yields one event per
// completed array item in the tool-use payload. The buffer accumulates only
// `input_json_delta` content; `extractNewItems` parses completed objects out
// of it; `WordFlagSchema + matchedForm` validate each item before yielding.
//
// One-bad-item-shouldn't-abort-the-stream behavior is implemented by catching
// per-item validation errors and warning them — the index counter still
// advances so the next call to `extractNewItems` doesn't re-extract the bad
// item.

/** Empirical worst-case budget for a 40-candidate enrichment. PR #49. */
const STREAM_MAX_TOKENS = 8192;
// Annotation is the only AI surface on Haiku 4.5 — same precedent as PR #51
// for the original (pre-streaming) `/read/annotate` handler. The task is
// enrichment, not reasoning: structured tool-use output for each candidate
// word (lemma / pos / gloss / example). Haiku is 2–3× faster than Sonnet on
// streaming tool-use, which is what lets us fit under the 29 s Lambda
// ceiling even on cold-start passages. Other AI surfaces (`evaluate`,
// `validate`, `generate`) keep Sonnet — their outputs are small and
// bounded, and reasoning quality matters more than wall-clock.
const STREAM_MODEL = "claude-haiku-4-5-20251001" as const;

export async function* streamAnnotation(
  client: Anthropic,
  input: AnnotateStreamInput,
): AsyncIterable<AnnotateStreamEvent> {
  if (input.candidates.length === 0) {
    // Defense-in-depth — the handler short-circuits before reaching us when
    // candidates is empty (Req 1.6 / 2.7). Reaching here would mean sending
    // Claude an enrichment request with no words to enrich.
    throw new Error(
      "streamAnnotation: candidates must be non-empty (empty lists are short-circuited upstream)",
    );
  }

  // Resolve the system prompt. Three paths (mirror `evaluateAnswer`):
  //   - override (CLI / eval): use verbatim, stamp `override:<sha8>`.
  //   - registry hit: `langfuse:<N>` cohort, fromFallback=false.
  //   - registry miss / outage / unset: `fallback:<localVersion>` cohort.
  // The fetch happens BEFORE `client.messages.stream` so the resolved
  // version lands on the ALS frame before the Phase-1 Proxy reads it.
  // Annotation already awaits upstream setup before opening the SSE
  // stream, so the extra await is free on time-to-first-event.
  let systemPromptText: string;
  if (input.systemPromptOverride !== undefined) {
    systemPromptText = input.systemPromptOverride;
    setResolvedPromptVersion(
      `override:${sha8(input.systemPromptOverride)}`,
      false,
    );
  } else {
    const resolved = await getPromptOrFallback(
      "annotate-system-prompt",
      ANNOTATE_SYSTEM_PROMPT,
      ANNOTATE_SYSTEM_PROMPT_VERSION,
    );
    systemPromptText = resolved.text;
  }

  const stream = client.messages.stream(
    {
      model: STREAM_MODEL,
      max_tokens: STREAM_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: systemPromptText,
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
    },
    input.signal !== undefined ? { signal: input.signal } : undefined,
  );

  let buffer = "";
  let processed = 0; // count of items returned by extractNewItems (yielded OR dropped)
  let flaggedCount = 0; // count of items successfully yielded

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta"
    ) {
      buffer += event.delta.partial_json;

      for (const item of extractNewItems(buffer, processed)) {
        processed++;
        try {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new Error("Item is not a non-null object");
          }
          const itemObj = item as Record<string, unknown>;
          const matchedForm = MatchedFormSchema.parse(itemObj.matchedForm);
          // Strip matchedForm before validating the remainder against
          // WordFlagSchema (matched the existing parseAnnotateResult pattern).
          const { matchedForm: _matchedForm, ...rest } = itemObj;
          void _matchedForm;
          const flag = WordFlagSchema.parse(rest);
          yield { kind: "flag", flag: { ...flag, matchedForm } };
          flaggedCount++;
        } catch (err) {
          // Req 4.8: drop a single bad item, log at warn, continue.
          console.warn("[streamAnnotation] dropped malformed item", err);
        }
      }
    }
  }

  const finalMessage = await stream.finalMessage();
  if (finalMessage.stop_reason === "max_tokens") {
    console.warn("[streamAnnotation] truncated by max_tokens", {
      yielded: flaggedCount,
    });
    throw new AnnotateStreamMaxTokensError(flaggedCount);
  }

  yield { kind: "done", flaggedCount };
}
