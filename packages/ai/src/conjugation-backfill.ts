/**
 * LLM-assisted backfill of the structured conjugation feature bundle
 * (`features[]` + `subject`) onto exercises that predate PR #386 and carry only
 * the flat `featureBundle` string.
 *
 * In-repo prompt + forced tool + pure parser. NOT a runtime Lambda path and NOT
 * registered in Langfuse — it is a one-off maintenance aid run by a human via
 * the `backfill:conjugation` CLI (same shape as `propose:coverage-spec` and
 * `revalidate:cloze`). It does NOT generate new exercises: it derives the two
 * display fields from a row's existing `(lemma, lemmaGloss, featureBundle,
 * targetForm)` so the row can be enriched in place. Bump the version on prompt
 * edits.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  ZERO_USAGE,
  type ClaudeUsageBreakdown,
} from "./cost-model";

export const CONJUGATION_BACKFILL_PROMPT_VERSION = "conjugation-backfill@2026-06-20";
export const DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME = "submit_conjugation_structure";
const BACKFILL_MODEL = "claude-sonnet-4-6";
const BACKFILL_MAX_TOKENS = 512;
const BACKFILL_TEMPERATURE = 0;

/** The cell descriptor read off an existing flat conjugation row. */
export type ConjugationCellDescriptor = {
  language: string;
  lemma: string;
  lemmaGloss: string;
  featureBundle: string;
  targetForm: string;
};

/** The structured fields produced by the backfill. `subject` is omitted for
 *  cells with no person/number (e.g. nominal inflection like the locative). */
export type ConjugationStructure = {
  features: Array<{ term: string; gloss: string }>;
  subject?: { pronoun: string; gloss: string };
};

export const CONJUGATION_BACKFILL_SYSTEM_PROMPT = `You decompose a single, already-correct conjugation drill cell into a structured, glossed form for display. You are NOT inventing a new exercise — the cell is fixed; you only restate its existing feature bundle.

You are given the verb (lemma + English gloss), the human-readable feature bundle that names the cell in the target language's conventional grammar notation, and the correct target form (so you can disambiguate person/number — do NOT echo it in your output).

Produce exactly two things via the ${DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME} tool:

- \`features\`: the grammar dimensions OTHER than person/number — the tense/mood, and polarity where the bundle marks it — in the order they appear in the feature bundle. Each entry pairs the target-language term in its conventional notation (\`term\`, copied faithfully from the bundle) with a 1-2 word English gloss (\`gloss\`). Do NOT put person/number in \`features\`.
- \`subject\`: the person/number cue, WHEN the cell has one. \`pronoun\` is the representative target-language subject pronoun for the cell (e.g. Turkish "o", Spanish "nosotros", German "ich"); \`gloss\` is its short English gloss (e.g. "he / she / it", "we", "I"). OMIT \`subject\` entirely for cells with no grammatical subject — e.g. nominal inflection (case/number on a noun) where the bundle names no person.

Rules:
- \`features\` (plus \`subject\` when present) must describe the SAME cell as the feature bundle — no more, no fewer dimensions.
- NEVER include the target form (the answer) anywhere in the output.
- Keep \`term\` faithful to the bundle's wording; keep glosses short and standard.`;

export function buildConjugationBackfillUserPrompt(
  cell: ConjugationCellDescriptor,
): string {
  return `Language: ${cell.language}
Verb (lemma): ${cell.lemma}
Verb gloss: ${cell.lemmaGloss}
Feature bundle: ${cell.featureBundle}
Correct target form (context only — do NOT output it): ${cell.targetForm}

Decompose this cell into features + subject.`;
}

export const DERIVE_CONJUGATION_STRUCTURE_TOOL: Anthropic.Tool = {
  name: DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME,
  description:
    "Submit the structured, glossed decomposition (features + subject) of one conjugation cell.",
  input_schema: {
    type: "object" as const,
    properties: {
      features: {
        type: "array",
        description:
          "Ordered grammar dimensions OTHER than person/number (tense/mood, and polarity where present). Each item: target-language term + short English gloss.",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Target-language grammar term, copied from the feature bundle." },
            gloss: { type: "string", description: "Short English gloss, 1-2 words." },
          },
          required: ["term", "gloss"],
        },
      },
      subject: {
        type: "object",
        description: "The person/number cue. OMIT for cells with no grammatical subject (e.g. nominal inflection).",
        properties: {
          pronoun: { type: "string", description: "Representative target-language subject pronoun for the cell." },
          gloss: { type: "string", description: "English gloss of the pronoun." },
        },
        required: ["pronoun", "gloss"],
      },
    },
    required: ["features"],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireTrimmed(obj: Record<string, unknown>, field: string, ctx: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`${ctx}: ${field} must be a non-empty string, got ${JSON.stringify(v)}`);
  }
  return v.trim();
}

/** Pure validator for the tool output. Throws on any illegality. */
export function parseConjugationStructure(input: unknown): ConjugationStructure {
  if (!isObject(input)) {
    throw new Error("conjugation structure must be an object");
  }
  if (!Array.isArray(input.features) || input.features.length === 0) {
    throw new Error("conjugation structure: features must be a non-empty array");
  }
  const features = input.features.map((item, i) => {
    if (!isObject(item)) {
      throw new Error(`conjugation structure: features[${i}] must be an object`);
    }
    return {
      term: requireTrimmed(item, "term", `features[${i}]`),
      gloss: requireTrimmed(item, "gloss", `features[${i}]`),
    };
  });
  if (input.subject === undefined) {
    // Subjectless cell (e.g. nominal inflection): features only.
    return { features };
  }
  if (!isObject(input.subject)) {
    throw new Error("conjugation structure: subject must be an object when present");
  }
  const subject = {
    pronoun: requireTrimmed(input.subject, "pronoun", "subject"),
    gloss: requireTrimmed(input.subject, "gloss", "subject"),
  };
  return { features, subject };
}

function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Call Claude with the forced tool and return the validated structure + usage. */
export async function deriveConjugationStructure(
  client: Anthropic,
  cell: ConjugationCellDescriptor,
  signal?: AbortSignal,
): Promise<{ structure: ConjugationStructure; tokenUsage: ClaudeUsageBreakdown }> {
  const response = await client.messages.create(
    {
      model: BACKFILL_MODEL,
      max_tokens: BACKFILL_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: CONJUGATION_BACKFILL_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: buildConjugationBackfillUserPrompt(cell) }],
      tools: [DERIVE_CONJUGATION_STRUCTURE_TOOL],
      tool_choice: { type: "tool" as const, name: DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME },
      temperature: BACKFILL_TEMPERATURE,
    },
    { signal },
  );
  const tokenUsage = response.usage ? readUsage(response) : ZERO_USAGE;
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `conjugation backfill: no tool_use block (stop_reason ${response.stop_reason})`,
    );
  }
  return { structure: parseConjugationStructure(toolUse.input), tokenUsage };
}
