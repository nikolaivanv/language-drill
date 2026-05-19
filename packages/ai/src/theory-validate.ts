/**
 * packages/ai — Theory validator core (Phase 3).
 *
 * The static surface of the validator: model constants, the tool schema,
 * and the public types `TheoryValidationResult` + `ValidateTheoryDraftResult`.
 * `parseTheoryValidationResult` lands in Task 4; `validateTheoryDraft` lands
 * in Task 5.
 *
 * Structural mirror of `validate.ts`. The model id is aliased to
 * `GENERATION_MODEL` (the same `claude-sonnet-4-5` constant the generator
 * and the exercise validator pin) so the three Claude paths cannot drift
 * — Task 6's cross-file equality assertion fails CI if one path is bumped
 * without the others.
 *
 * Deltas from the exercise validator's tool schema (intentional, per
 * design Component 1 / Req 1.5):
 *   - DROPPED: `ambiguous`, `grammarPointMatch`
 *   - ADDED: `factualErrors` (hard reject; stricter than the exercise side
 *     — a wrong rule in a theory page becomes the canonical reference for
 *     that grammar point)
 *   - ADDED: `sectionsIncomplete` (named-section gap detection — the
 *     generator produces five required sections; the validator names any
 *     that are missing or thin)
 *   - ADDED: `examplesUseGrammarPoint` (replaces `grammarPointMatch` —
 *     sharper question for prose content)
 *   - KEPT: `qualityScore`, `levelMismatch` (renamed from `levelMatch` —
 *     boolean polarity inverted to match the field name's natural reading),
 *     `culturalIssues`, `flaggedReasons`.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ClaudeUsageBreakdown } from "./cost-model.js";
import { GENERATION_MODEL } from "./generate.js";
import type {
  TheoryDraft,
  TheoryGenerationSpec,
} from "./theory-generate.js";
import {
  buildTheoryValidationSystemPrompt,
  buildTheoryValidationUserPrompt,
} from "./theory-validation-prompts.js";

// ---------------------------------------------------------------------------
// Model + sampling constants
// ---------------------------------------------------------------------------

/**
 * Authoritative model id for the theory validator. Aliased to
 * `GENERATION_MODEL` so the generator and validator stay on the same
 * Sonnet revision. Asserted equal in `theory-validate.test.ts` (Task 6) —
 * a literal mismatch fails CI.
 */
export const THEORY_VALIDATION_MODEL = GENERATION_MODEL;

export const THEORY_VALIDATION_MAX_TOKENS = 1024;

/** Strict reviewer: zero diversity, deterministic output. */
export const THEORY_VALIDATION_TEMPERATURE = 0.0;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

export const THEORY_VALIDATION_TOOL_NAME =
  "submit_theory_validation_result" as const;

/**
 * Per-property descriptions restate the routing implication so Claude can
 * self-calibrate while filling the tool input. The actual routing happens
 * in `routeTheoryValidationResult` (packages/db/src/theory-generation/
 * routing.ts), not here. The tool-name literal is also the closing-
 * directive value in `theory-validation-prompts.ts` — Task 6's test pins
 * both sides.
 */
export const THEORY_VALIDATION_TOOL: Anthropic.Tool = {
  name: THEORY_VALIDATION_TOOL_NAME,
  description:
    "Submit the structured validation result for a generated grammar theory page.",
  input_schema: {
    type: "object" as const,
    properties: {
      qualityScore: {
        type: "number",
        description:
          "Overall quality of the theory page from 0.0 to 1.0. Below 0.5 will reject the page; 0.5–0.7 will flag it for human review; >= 0.7 (with no other failures) auto-approves.",
      },
      factualErrors: {
        type: "array",
        items: { type: "string" },
        description:
          'Free-text descriptions of factually-wrong claims: incorrect rule statements, wrong conjugations, mis-stated trigger conditions, etc. A single non-empty entry routes the page to "rejected" regardless of qualityScore — this is intentional and stricter than the exercise validator. A wrong rule in a theory page becomes the canonical reference learners internalize. Use only for outright factual errors, not for stylistic concerns.',
      },
      levelMismatch: {
        type: "boolean",
        description:
          "True if the page's vocabulary or concepts drift above or below the requested CEFR level. False when the page sits cleanly at the target level.",
      },
      sectionsIncomplete: {
        type: "array",
        items: { type: "string" },
        description:
          'Names of required sections that are missing or thin. The generator produces five sections in order: "what is it?", "when to use it", "formation", "examples in context", "common pitfalls". Add a section name here when it is missing, empty, or so brief it does not serve its purpose. Empty array when all five sections are adequate.',
      },
      examplesUseGrammarPoint: {
        type: "boolean",
        description:
          "True if the example blocks in the 'examples in context' section actually demonstrate the target grammar point. False when the examples are incidental or fail to feature the grammar point.",
      },
      culturalIssues: {
        type: "array",
        items: { type: "string" },
        description:
          'Free-text descriptions of cultural concerns: stereotyping, sensitive content, exclusion. A single non-empty entry routes the page to "rejected" regardless of qualityScore — this is intentional. Use sparingly.',
      },
      flaggedReasons: {
        type: "array",
        items: { type: "string" },
        description:
          'Free-text reasons that go into theory_topics.flagged_reasons when the page routes to "flagged". Add anything else a reviewer should know — voice/tone concerns, ambiguous explanations, missing edge cases. Use complete, human-readable English sentences; the strings are surfaced verbatim in the reviewer\'s terminal.',
      },
    },
    required: [
      "qualityScore",
      "factualErrors",
      "levelMismatch",
      "sectionsIncomplete",
      "examplesUseGrammarPoint",
      "culturalIssues",
      "flaggedReasons",
    ],
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TheoryValidationResult = {
  /** 0..1 inclusive. */
  qualityScore: number;
  /**
   * Factually wrong claims (grammar rules, conjugations, etc.). Non-empty
   * is a HARD REJECT — stricter than the exercise validator. A wrong rule
   * in a theory page becomes the canonical reference for that grammar
   * point, so factually problematic pages must be filtered here, not
   * deferred to manual review.
   */
  factualErrors: string[];
  /** Vocabulary or concepts above/below the spec's CEFR level. */
  levelMismatch: boolean;
  /**
   * Names of required sections (what-is-it, when-to-use, formation,
   * examples, pitfalls) that are missing or thin. Empty array when the
   * page covers all five sections adequately.
   */
  sectionsIncomplete: string[];
  /** Do the examples actually demonstrate the target grammar point? */
  examplesUseGrammarPoint: boolean;
  /**
   * Stereotyping, sensitive content, exclusion. A non-empty array is a
   * hard veto: `routeTheoryValidationResult` rejects the page regardless
   * of `qualityScore` — the human reviewer never sees rejected items, so
   * culturally problematic pages must be filtered here.
   */
  culturalIssues: string[];
  /**
   * Free-text reasons the writer denormalizes into
   * `theory_topics.flagged_reasons`. Surfaced verbatim in the reviewer's
   * terminal — use human-readable English sentences.
   */
  flaggedReasons: string[];
};

export type ValidateTheoryDraftResult = {
  result: TheoryValidationResult;
  tokenUsage: ClaudeUsageBreakdown;
};

// ---------------------------------------------------------------------------
// parseTheoryValidationResult — validates and coerces a raw tool-use input
// into a TheoryValidationResult. Throws field-level errors on shape
// mismatch. Mirrors `parseValidationResult` (validate.ts:172-208): error
// messages use the `Invalid <field>: must be <expected>, got
// <JSON.stringify(value)>` format so an operator inspecting
// `theory_generation_jobs.error_message` can find the offending field
// immediately.
//
// The helpers `isObject` + `requireStringArray` are re-declared locally
// rather than imported from `validate.ts` because validate.ts declares
// them module-private. Keeping the theory validator self-contained avoids
// reaching into another module's internals.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireStringArray(
  raw: Record<string, unknown>,
  field: string,
): string[] {
  const v = raw[field];
  if (!Array.isArray(v)) {
    throw new Error(
      `Invalid ${field}: must be an array, got ${JSON.stringify(v)}`,
    );
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      throw new Error(
        `Invalid ${field}[${i}]: must be a string, got ${JSON.stringify(v[i])}`,
      );
    }
  }
  return v as string[];
}

export function parseTheoryValidationResult(
  input: unknown,
): TheoryValidationResult {
  if (!isObject(input)) {
    throw new Error("Theory validation result must be an object");
  }

  const raw = input;

  // qualityScore: number in [0, 1].
  const qualityScore = raw.qualityScore;
  if (
    typeof qualityScore !== "number" ||
    qualityScore < 0 ||
    qualityScore > 1
  ) {
    throw new Error(
      `Invalid qualityScore: must be a number between 0 and 1, got ${JSON.stringify(qualityScore)}`,
    );
  }

  // Two boolean fields.
  for (const field of ["levelMismatch", "examplesUseGrammarPoint"] as const) {
    if (typeof raw[field] !== "boolean") {
      throw new Error(
        `Invalid ${field}: must be a boolean, got ${JSON.stringify(raw[field])}`,
      );
    }
  }

  // Four array-of-strings fields.
  const factualErrors = requireStringArray(raw, "factualErrors");
  const sectionsIncomplete = requireStringArray(raw, "sectionsIncomplete");
  const culturalIssues = requireStringArray(raw, "culturalIssues");
  const flaggedReasons = requireStringArray(raw, "flaggedReasons");

  return {
    qualityScore,
    factualErrors,
    levelMismatch: raw.levelMismatch as boolean,
    sectionsIncomplete,
    examplesUseGrammarPoint: raw.examplesUseGrammarPoint as boolean,
    culturalIssues,
    flaggedReasons,
  };
}

// ---------------------------------------------------------------------------
// validateTheoryDraft — single Claude call. Mirror of `validateDraft`
// (validate.ts:237-293). Pure with respect to inputs — does NOT mutate
// `draft` or `spec`.
// ---------------------------------------------------------------------------

/** Reads `response.usage` and falls back to 0 for any unset cache field.
 *  Re-declared locally — generate.ts and validate.ts have the same helper
 *  but they're module-private. Keeping the theory validator self-contained
 *  avoids reaching into other modules' internals. */
function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

/**
 * Validates one already-generated theory page via a single Claude call.
 *
 * Theory has no per-type fan-out (no equivalent of `TOOL_NAME_BY_TYPE`):
 * one Claude call per cell, one tool name. The validator's system prompt
 * is `spec`-derived only so subsequent validator calls within a cell hit
 * the prompt cache — though theory generates one draft per cell so the
 * cache hit rate is effectively zero in Phase 3. The caching is set up
 * anyway for forward-compat (Req Performance §).
 *
 * @throws Error if the Claude API call fails, the response carries no
 *   `tool_use` block, the tool name is unexpected, or the tool input
 *   fails `parseTheoryValidationResult`'s field-level checks.
 */
export async function validateTheoryDraft(
  client: Anthropic,
  draft: TheoryDraft,
  spec: TheoryGenerationSpec,
): Promise<ValidateTheoryDraftResult> {
  const systemText = await buildTheoryValidationSystemPrompt(spec);
  const userText = buildTheoryValidationUserPrompt(draft, spec);

  const response = await client.messages.create({
    model: THEORY_VALIDATION_MODEL,
    max_tokens: THEORY_VALIDATION_MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: systemText,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: userText }],
    tools: [THEORY_VALIDATION_TOOL],
    tool_choice: {
      type: "tool" as const,
      name: THEORY_VALIDATION_TOOL_NAME,
    },
    temperature: THEORY_VALIDATION_TEMPERATURE,
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUseBlock) {
    throw new Error(
      "Validator did not return a tool use block. " +
        `Stop reason: ${response.stop_reason}. ` +
        `Content types: ${response.content.map((b) => b.type).join(", ")}`,
    );
  }

  if (toolUseBlock.name !== THEORY_VALIDATION_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${THEORY_VALIDATION_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  const result = parseTheoryValidationResult(toolUseBlock.input);
  const tokenUsage = readUsage(response);
  return { result, tokenUsage };
}
