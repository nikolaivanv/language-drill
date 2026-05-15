/**
 * packages/ai — Validator core (Phase 3).
 *
 * The static surface of the validator: model constants, the tool schema, and
 * the public types `ValidationResult` and `ValidateDraftResult`.
 * `parseValidationResult` lands in Task 7; `validateDraft` lands in Task 8.
 *
 * Mirrors `evaluate.ts` structurally — same `Anthropic.Tool` shape, same
 * `tool_choice` form (Task 8), same cached `system` block (Task 8). The model
 * id is intentionally pinned to the same `claude-sonnet-4-5` constant the
 * generator and evaluator use today (resolved decision #1 in
 * `docs/exercise-generation-plan.md`); the cross-file invariant is asserted in
 * `validate.test.ts` (Task 9).
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ClaudeUsageBreakdown } from "./cost-model.js";
import {
  TOOL_NAME_BY_TYPE,
  type ExerciseDraft,
  type GenerationSpec,
} from "./generate.js";
import {
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
} from "./validation-prompts.js";

// ---------------------------------------------------------------------------
// Model + sampling constants
// ---------------------------------------------------------------------------

/**
 * Authoritative model id for the validator. Asserted equal to
 * `GENERATION_MODEL` (and to evaluate.ts's pinned literal) in
 * `validate.test.ts` so the three Claude paths (generator, validator,
 * evaluator) cannot drift independently.
 */
export const VALIDATION_MODEL = "claude-sonnet-4-5" as const;

export const VALIDATION_MAX_TOKENS = 1024;

/** Strict reviewer: zero diversity, deterministic output. */
export const VALIDATION_TEMPERATURE = 0.0;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

export const VALIDATION_TOOL_NAME = "submit_validation_result";

/**
 * Per-property descriptions restate the routing implication from plan §3.1
 * so Claude can self-calibrate while filling the tool input. The actual
 * routing happens in `routeValidationResult`
 * (packages/db/scripts/generate-exercises-validate.ts), not here.
 */
export const VALIDATION_TOOL: Anthropic.Tool = {
  name: VALIDATION_TOOL_NAME,
  description:
    "Submit the structured validation result for a generated language exercise.",
  input_schema: {
    type: "object" as const,
    properties: {
      qualityScore: {
        type: "number",
        description:
          "Overall quality from 0.0 to 1.0. Below 0.5 will reject the draft; 0.5–0.7 will flag it for human review; >= 0.7 (with no other failures) auto-approves.",
      },
      ambiguous: {
        type: "boolean",
        description:
          "True if more than one substantively different answer would be equally correct given the surrounding context. Cloze/vocab require exactly one correct answer; translation allows surface variation but must have one canonical meaning.",
      },
      levelMatch: {
        type: "boolean",
        description:
          "True if the exercise sits at the requested CEFR level. False if vocabulary or grammar drifts above or below the target level.",
      },
      grammarPointMatch: {
        type: "boolean",
        description:
          "True if the exercise actually tests the target grammar point. False if the targeting is incidental or absent.",
      },
      culturalIssues: {
        type: "array",
        items: { type: "string" },
        description:
          'Free-text descriptions of cultural concerns: stereotyping, sensitive content, exclusion. A single non-empty entry routes the draft to "rejected" regardless of qualityScore — this is intentional. Use sparingly.',
      },
      flaggedReasons: {
        type: "array",
        items: { type: "string" },
        description:
          'Free-text reasons that go into exercises.flagged_reasons when the draft routes to "flagged". Add anything that future-you would want to see when reviewing manually.',
      },
    },
    required: [
      "qualityScore",
      "ambiguous",
      "levelMatch",
      "grammarPointMatch",
      "culturalIssues",
      "flaggedReasons",
    ],
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ValidationResult = {
  /** 0..1 inclusive. */
  qualityScore: number;
  /** Multiple equally-correct answers? */
  ambiguous: boolean;
  /** Does the draft sit at the requested CEFR level? */
  levelMatch: boolean;
  /** Does the draft actually test the target grammar point? */
  grammarPointMatch: boolean;
  /**
   * Sensitive content, stereotyping, exclusion. A non-empty array is a hard
   * veto: `routeValidationResult` rejects the draft regardless of
   * `qualityScore` (intentional from plan §3.1 — the human reviewer never
   * sees rejected items, so culturally problematic drafts must be filtered
   * here, not deferred to manual review).
   */
  culturalIssues: string[];
  /** Free-text reasons the writer denormalizes into `exercises.flagged_reasons`. */
  flaggedReasons: string[];
};

export type ValidateDraftResult = {
  result: ValidationResult;
  tokenUsage: ClaudeUsageBreakdown;
};

// ---------------------------------------------------------------------------
// parseValidationResult — validates and coerces a raw tool-use input into a
// ValidationResult. Throws field-level errors on shape mismatch. Mirrors
// `parseEvaluationResult` (evaluate.ts:128-200): error messages use the
// `Invalid <field>: must be <expected>, got <JSON.stringify(value)>` format
// so an operator inspecting `generation_jobs.error_message` can find the
// offending field immediately.
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

export function parseValidationResult(input: unknown): ValidationResult {
  if (!isObject(input)) {
    throw new Error("Validation result must be an object");
  }

  const raw = input;

  // qualityScore: number in [0, 1].
  const qualityScore = raw.qualityScore;
  if (typeof qualityScore !== "number" || qualityScore < 0 || qualityScore > 1) {
    throw new Error(
      `Invalid qualityScore: must be a number between 0 and 1, got ${JSON.stringify(qualityScore)}`,
    );
  }

  // Three boolean fields.
  for (const field of ["ambiguous", "levelMatch", "grammarPointMatch"] as const) {
    if (typeof raw[field] !== "boolean") {
      throw new Error(
        `Invalid ${field}: must be a boolean, got ${JSON.stringify(raw[field])}`,
      );
    }
  }

  // Two array-of-strings fields.
  const culturalIssues = requireStringArray(raw, "culturalIssues");
  const flaggedReasons = requireStringArray(raw, "flaggedReasons");

  return {
    qualityScore,
    ambiguous: raw.ambiguous as boolean,
    levelMatch: raw.levelMatch as boolean,
    grammarPointMatch: raw.grammarPointMatch as boolean,
    culturalIssues,
    flaggedReasons,
  };
}

// ---------------------------------------------------------------------------
// validateDraft — single Claude call. Mirror of `evaluateAnswer`
// (evaluate.ts:220-272) and `generateBatch`'s per-iter call shape
// (generate.ts:551-580). Pure with respect to inputs — does NOT mutate
// `draft` or `spec`.
// ---------------------------------------------------------------------------

/** Reads `response.usage` and falls back to 0 for any unset cache field.
 *  Re-declared locally — generate.ts has the same helper but it's module-
 *  private. Keeping the validator self-contained avoids a circular import. */
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
 * Validates one already-generated draft via a single Claude call.
 *
 * @throws Error if Claude API call fails, the response carries no tool_use
 *   block, the tool name is unexpected, or the tool input fails
 *   `parseValidationResult`'s field-level checks.
 */
export async function validateDraft(
  client: Anthropic,
  draft: ExerciseDraft,
  spec: GenerationSpec,
  signal?: AbortSignal,
): Promise<ValidateDraftResult> {
  // Top-of-function guard. Keys off `draft.contentJson.type` (not
  // `spec.exerciseType`) so a caller that hands the validator a draft whose
  // content type doesn't match the spec is caught here independently of spec
  // validation. Phase 6 widens TOOL_NAME_BY_TYPE to add new types; this guard
  // is the seam.
  if (!(draft.contentJson.type in TOOL_NAME_BY_TYPE)) {
    throw new Error(
      `Unsupported draft.contentJson.type: ${draft.contentJson.type}`,
    );
  }

  const systemText = buildValidationSystemPrompt(spec);
  const userText = buildValidationUserPrompt(draft, spec);

  const response = await client.messages.create(
    {
      model: VALIDATION_MODEL,
      max_tokens: VALIDATION_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: systemText,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: userText }],
      tools: [VALIDATION_TOOL],
      tool_choice: { type: "tool" as const, name: VALIDATION_TOOL_NAME },
      temperature: VALIDATION_TEMPERATURE,
    },
    { signal },
  );

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

  if (toolUseBlock.name !== VALIDATION_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${VALIDATION_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  const result = parseValidationResult(toolUseBlock.input);
  const tokenUsage = readUsage(response);
  return { result, tokenUsage };
}
