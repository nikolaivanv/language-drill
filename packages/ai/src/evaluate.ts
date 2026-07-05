/**
 * packages/ai — Core evaluation function.
 *
 * Calls Claude with tool use to get structured EvaluationResult.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ExerciseContent,
  CefrLevel,
  Language,
  EvaluationResult,
} from "@language-drill/shared";
import {
  setResolvedPromptClient,
  setResolvedPromptVersion,
} from "./observability.js";
import {
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  buildUserPrompt,
  type GrammarGuidance,
  type AttributionKey,
} from "./prompts.js";
import { getPromptOrFallback, sha8 } from "./prompts-registry.js";
import { ContentRejectedError } from "./content-rejected-error.js";

// ---------------------------------------------------------------------------
// Tool schema — mirrors EvaluationResult type
// ---------------------------------------------------------------------------

export const EVALUATION_TOOL_NAME = "submit_evaluation";

/**
 * Build the `submit_evaluation` tool. When `attributionKeys` is non-empty,
 * each error gains an OPTIONAL `grammarPointKey` whose value is constrained to
 * a closed `enum` of the exercise's in-scope curriculum keys — so the (Haiku)
 * evaluator can attribute an error to a point but can never invent a key.
 */
export function buildEvaluationTool(
  attributionKeys?: readonly AttributionKey[],
): Anthropic.Tool {
  const errorProps: Record<string, unknown> = {
    type: {
      type: "string",
      enum: ["grammar", "vocabulary", "spelling", "pragmatics"],
      description: "Category of the error.",
    },
    severity: {
      type: "string",
      enum: ["minor", "major"],
      description:
        "Severity: minor (does not impede communication) or major (changes meaning or is ungrammatical).",
    },
    text: { type: "string", description: "The erroneous text from the user's answer." },
    correction: { type: "string", description: "The corrected version of the text." },
    explanation: {
      type: "string",
      description: "Brief explanation of why this is an error and how to fix it.",
    },
  };

  if (attributionKeys && attributionKeys.length > 0) {
    errorProps.grammarPointKey = {
      type: "string",
      enum: attributionKeys.map((k) => k.key),
      description:
        "OPTIONAL. The curriculum key of the grammar point THIS error violates. " +
        "Must be one of the keys listed in the user message's 'Grammar points in scope' block. " +
        "Omit entirely if the error does not violate any listed point (e.g. a vocabulary or spelling slip).",
    };
  }

  return {
    name: EVALUATION_TOOL_NAME,
    description:
      "Submit the structured evaluation result for a language exercise answer.",
    input_schema: {
      type: "object" as const,
      // `reasoning` MUST stay the first property: with a forced tool call and
      // no extended thinking, field order is the only place the model can
      // verify morphology BEFORE committing to scores. It is private — parsed
      // out and never returned to the user (see parseEvaluationResult).
      properties: {
        reasoning: {
          type: "string",
          description:
            "Private verification scratchpad (never shown to the learner). " +
            "Before scoring: segment the user's answer morpheme by morpheme, " +
            "compare each form against what the sentence requires, and check " +
            "every rule you are about to state in feedback against these " +
            "specific forms. 2-4 short sentences.",
        },
        score: { type: "number", description: "Overall score from 0.0 to 1.0 combining all evaluation factors." },
        grammarAccuracy: { type: "number", description: "Grammar accuracy score from 0.0 to 1.0. Covers morphology, syntax, agreement, tense, word order." },
        vocabularyRange: { type: "string", description: 'CEFR level string (A1–C2) representing the sophistication of vocabulary used.' },
        taskAchievement: { type: "number", description: "Task achievement score from 0.0 to 1.0. How well the answer fulfills the exercise requirements." },
        feedback: { type: "string", description: "Concise, encouraging explanation of what was good and what needs improvement." },
        errors: {
          type: "array",
          description: "Array of specific errors found in the answer.",
          items: {
            type: "object",
            properties: errorProps,
            // grammarPointKey is intentionally NOT required (attribution is best-effort).
            required: ["type", "severity", "text", "correction", "explanation"],
          },
        },
        estimatedCefrEvidence: { type: "string", description: 'The CEFR level this answer provides evidence for (e.g. "B1").' },
      },
      required: [
        "reasoning", "score", "grammarAccuracy", "vocabularyRange",
        "taskAchievement", "feedback", "errors", "estimatedCefrEvidence",
      ],
    },
  };
}

/** Back-compat default tool (no attribution field). */
export const EVALUATION_TOOL: Anthropic.Tool = buildEvaluationTool();

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type EvaluateAnswerInput = {
  exercise: ExerciseContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  /**
   * Authoritative curriculum grounding for the exercise's grammar point,
   * resolved by the caller from `exercises.grammarPointKey`. When present it is
   * appended to the user prompt so the evaluator grounds its feedback
   * in the curriculum rather than confabulating a rule. Omitted when the
   * exercise has no `grammarPointKey` or the key is unknown.
   */
  grammarGuidance?: GrammarGuidance;
  /**
   * The closed set of curriculum grammar-point keys (key + display name) in
   * scope for this exercise's (language, level). Resolved by the caller from
   * `grammarPointsAtOrBelow`. When present, the evaluator may attribute each
   * error to one of these keys (constrained by the tool-schema enum + the
   * user-prompt list); when absent, attribution is skipped (keys → null).
   */
  attributionKeys?: readonly AttributionKey[];
  /**
   * Phase-2: bypass the Langfuse registry and use this verbatim as the
   * system prompt. Used by `pnpm eval` (the eval runner) to evaluate
   * dataset items against a candidate prompt. When set, the trace's
   * `promptVersion` is stamped `override:<sha8(text)>` so dashboards
   * can cohort eval-run traffic separately from production traces.
   */
  systemPromptOverride?: string;
  /**
   * Eval-runner escape hatch (sibling of `systemPromptOverride`): run this
   * evaluation on a different model than the production `MODEL` constant.
   * Used by `pnpm eval --model <id>` to A/B model arms against a dataset.
   * Never set on the production request path.
   */
  modelOverride?: string;
};

// ---------------------------------------------------------------------------
// Result parsing & validation
// ---------------------------------------------------------------------------

const VALID_ERROR_TYPES = new Set(["grammar", "vocabulary", "spelling", "pragmatics"]);
const VALID_SEVERITIES = new Set(["minor", "major"]);

/**
 * Validates and coerces a raw tool-use input into an EvaluationResult.
 * Throws if the structure is invalid.
 *
 * @param validKeys When present, each error's `grammarPointKey` is kept only
 *   if it is in this set; keys absent from the set (or the set itself absent)
 *   are coerced to null.
 */
export function parseEvaluationResult(
  input: unknown,
  validKeys?: ReadonlySet<string>,
): EvaluationResult {
  if (typeof input !== "object" || input === null) {
    throw new Error("Evaluation result must be an object");
  }

  const raw = input as Record<string, unknown>;

  // Validate required numeric fields
  for (const field of ["score", "grammarAccuracy", "taskAchievement"] as const) {
    if (typeof raw[field] !== "number" || raw[field] < 0 || raw[field] > 1) {
      throw new Error(
        `Invalid ${field}: must be a number between 0 and 1, got ${JSON.stringify(raw[field])}`,
      );
    }
  }

  // Validate required string fields
  for (const field of ["vocabularyRange", "feedback", "estimatedCefrEvidence"] as const) {
    if (typeof raw[field] !== "string" || (raw[field] as string).length === 0) {
      throw new Error(
        `Invalid ${field}: must be a non-empty string, got ${JSON.stringify(raw[field])}`,
      );
    }
  }

  // Validate errors array
  if (!Array.isArray(raw.errors)) {
    throw new Error("Invalid errors: must be an array");
  }

  const errors = (raw.errors as unknown[]).map((err, i) => {
    if (typeof err !== "object" || err === null) {
      throw new Error(`Invalid error at index ${i}: must be an object`);
    }
    const e = err as Record<string, unknown>;

    if (!VALID_ERROR_TYPES.has(e.type as string)) {
      throw new Error(
        `Invalid error type at index ${i}: got ${JSON.stringify(e.type)}`,
      );
    }
    if (!VALID_SEVERITIES.has(e.severity as string)) {
      throw new Error(
        `Invalid error severity at index ${i}: got ${JSON.stringify(e.severity)}`,
      );
    }
    for (const field of ["text", "correction", "explanation"] as const) {
      if (typeof e[field] !== "string") {
        throw new Error(
          `Invalid error ${field} at index ${i}: must be a string`,
        );
      }
    }

    // Per-error attribution (Phase 3): keep the key only if it is in the
    // exercise's in-scope set; otherwise null. Null when absent or no set.
    let grammarPointKey: string | null = null;
    if (validKeys && typeof e.grammarPointKey === "string" && validKeys.has(e.grammarPointKey)) {
      grammarPointKey = e.grammarPointKey;
    }

    return {
      type: e.type as "grammar" | "vocabulary" | "spelling" | "pragmatics",
      severity: e.severity as "minor" | "major",
      text: e.text as string,
      correction: e.correction as string,
      explanation: e.explanation as string,
      grammarPointKey,
    };
  });

  return {
    score: raw.score as number,
    grammarAccuracy: raw.grammarAccuracy as number,
    vocabularyRange: raw.vocabularyRange as string,
    taskAchievement: raw.taskAchievement as number,
    feedback: raw.feedback as string,
    errors,
    estimatedCefrEvidence: raw.estimatedCefrEvidence as string,
  };
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

// Evaluation runs on Sonnet 4.6. It briefly ran on Haiku 4.5 as a latency
// optimization ("little reasoning risk" for bounded structured output), but
// production traffic falsified that assumption on Turkish morphology: Haiku
// passed a real error as grammatically correct ("çalışmayorum" scored 0.85,
// grammarAccuracy 1.0), confabulated suffix paradigms in feedback (invented
// "-do/-dö" forms of -DI), and misattributed a slip to deliberate vocabulary
// choice ("atışlar"). Verdict quality gates this surface — a missed error
// corrupts mastery tracking, not just feedback prose. Model changes are gated
// by the `pnpm eval` Langfuse-dataset harness (see eval-runs/README notes) and
// reversible by restoring this one constant. NOTE: changing the model is NOT a
// prompt-body edit, so `EVALUATION_SYSTEM_PROMPT_VERSION` is intentionally NOT
// bumped for the model part of a change — Langfuse records the model natively
// on each generation (the 2026-07-05 bump reflects the simultaneous prompt
// hardening, not the model swap).
const MODEL = "claude-sonnet-4-6" as const;

/**
 * Max tokens for evaluation responses. Sized for the required `reasoning`
 * scratchpad (first tool field) plus feedback + errors; 1024 was the
 * pre-reasoning budget and risks truncating the forced tool call mid-JSON.
 */
const MAX_TOKENS = 2048;

/**
 * SDK request timeout for the (non-streaming, user-waiting) evaluation call.
 * The submit→feedback loop is interactive, so we fail fast rather than inherit
 * the SDK's 10-minute default. ~30 s leaves room for a slow-but-real Sonnet
 * response generating up to MAX_TOKENS (reasoning + feedback) while bounding
 * the tail; free-writing eval (longer outputs) uses 45 s. (Req 4.1)
 */
export const EVAL_REQUEST_TIMEOUT_MS = 30_000;

/**
 * One retry instead of the SDK default of 2. A transient upstream blip gets a
 * single fast retry; beyond that we surface the failure as `502 AI_UNAVAILABLE`
 * rather than letting exponential backoff triple the latency a user waits
 * through. (Req 4.1, 4.5)
 */
export const EVAL_MAX_RETRIES = 1;

/**
 * Evaluates a user's answer to a language exercise using Claude.
 *
 * Constructs the prompt, calls Claude with tool use for structured output,
 * parses and returns a validated EvaluationResult.
 *
 * @throws Error if Claude API call fails or response is malformed
 */
export async function evaluateAnswer(
  client: Anthropic,
  input: EvaluateAnswerInput,
): Promise<EvaluationResult> {
  const {
    exercise,
    userAnswer,
    language,
    difficulty,
    grammarGuidance,
    attributionKeys,
    systemPromptOverride,
    modelOverride,
  } = input;

  const userPrompt = buildUserPrompt(
    exercise,
    userAnswer,
    language,
    difficulty,
    grammarGuidance,
    attributionKeys,
  );

  // Resolve the system prompt. Three paths:
  //   - override (eval runner): use verbatim, stamp `override:<sha8>` cohort.
  //   - registry hit: `langfuse:<N>` cohort, fromFallback=false.
  //   - registry miss / outage / unset: `fallback:<localVersion>` cohort.
  // The registry helper handles `setResolvedPromptVersion` for the latter
  // two; the override path sets it explicitly here.
  let systemPromptText: string;
  if (systemPromptOverride !== undefined) {
    systemPromptText = systemPromptOverride;
    setResolvedPromptVersion(`override:${sha8(systemPromptOverride)}`, false);
    // No live Langfuse prompt to link — clear in case a prior call in this
    // ALS scope had set a real client. (Today there's never a second call
    // in scope, but keep the invariant: every promptVersion set is paired
    // with a matching promptClient set.)
    setResolvedPromptClient(null);
  } else {
    const resolved = await getPromptOrFallback(
      "evaluate-system-prompt",
      EVALUATION_SYSTEM_PROMPT,
      EVALUATION_SYSTEM_PROMPT_VERSION,
    );
    systemPromptText = resolved.text;
  }

  const response = await client.messages.create({
    model: modelOverride ?? MODEL,
    max_tokens: MAX_TOKENS,
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
        content: userPrompt,
      },
    ],
    tools: [buildEvaluationTool(attributionKeys)],
    tool_choice: {
      type: "tool" as const,
      name: EVALUATION_TOOL_NAME,
    },
    temperature: 0,
  });

  // A safety refusal arrives as a 200 with stop_reason "refusal" and no tool
  // block. Surface it as a distinct, expected outcome (the route maps it to a
  // user-facing rejection) rather than a generic "no tool block" infra error.
  if (response.stop_reason === "refusal") {
    throw new ContentRejectedError(
      "Claude refused to evaluate this answer.",
      response.stop_reason,
    );
  }

  // Extract tool use block from response
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

  if (toolUseBlock.name !== EVALUATION_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${EVALUATION_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  const validKeys =
    attributionKeys && attributionKeys.length > 0
      ? new Set(attributionKeys.map((k) => k.key))
      : undefined;
  return parseEvaluationResult(toolUseBlock.input, validKeys);
}
