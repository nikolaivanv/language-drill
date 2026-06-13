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
} from "./prompts.js";
import { getPromptOrFallback, sha8 } from "./prompts-registry.js";

// ---------------------------------------------------------------------------
// Tool schema — mirrors EvaluationResult type
// ---------------------------------------------------------------------------

export const EVALUATION_TOOL_NAME = "submit_evaluation";

export const EVALUATION_TOOL: Anthropic.Tool = {
  name: EVALUATION_TOOL_NAME,
  description:
    "Submit the structured evaluation result for a language exercise answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description:
          "Overall score from 0.0 to 1.0 combining all evaluation factors.",
      },
      grammarAccuracy: {
        type: "number",
        description:
          "Grammar accuracy score from 0.0 to 1.0. Covers morphology, syntax, agreement, tense, word order.",
      },
      vocabularyRange: {
        type: "string",
        description:
          'CEFR level string (A1–C2) representing the sophistication of vocabulary used.',
      },
      taskAchievement: {
        type: "number",
        description:
          "Task achievement score from 0.0 to 1.0. How well the answer fulfills the exercise requirements.",
      },
      feedback: {
        type: "string",
        description:
          "Concise, encouraging explanation of what was good and what needs improvement.",
      },
      errors: {
        type: "array",
        description:
          "Array of specific errors found in the answer.",
        items: {
          type: "object",
          properties: {
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
            text: {
              type: "string",
              description: "The erroneous text from the user's answer.",
            },
            correction: {
              type: "string",
              description: "The corrected version of the text.",
            },
            explanation: {
              type: "string",
              description: "Brief explanation of why this is an error and how to fix it.",
            },
          },
          required: ["type", "severity", "text", "correction", "explanation"],
        },
      },
      estimatedCefrEvidence: {
        type: "string",
        description:
          'The CEFR level this answer provides evidence for (e.g. "B1").',
      },
    },
    required: [
      "score",
      "grammarAccuracy",
      "vocabularyRange",
      "taskAchievement",
      "feedback",
      "errors",
      "estimatedCefrEvidence",
    ],
  },
};

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
   * appended to the user prompt so the (Haiku) evaluator grounds its feedback
   * in the curriculum rather than confabulating a rule. Omitted when the
   * exercise has no `grammarPointKey` or the key is unknown.
   */
  grammarGuidance?: GrammarGuidance;
  /**
   * Phase-2: bypass the Langfuse registry and use this verbatim as the
   * system prompt. Used by `pnpm eval` (the eval runner) to evaluate
   * dataset items against a candidate prompt. When set, the trace's
   * `promptVersion` is stamped `override:<sha8(text)>` so dashboards
   * can cohort eval-run traffic separately from production traces.
   */
  systemPromptOverride?: string;
};

// ---------------------------------------------------------------------------
// Result parsing & validation
// ---------------------------------------------------------------------------

const VALID_ERROR_TYPES = new Set(["grammar", "vocabulary", "spelling", "pragmatics"]);
const VALID_SEVERITIES = new Set(["minor", "major"]);

/**
 * Validates and coerces a raw tool-use input into an EvaluationResult.
 * Throws if the structure is invalid.
 */
export function parseEvaluationResult(input: unknown): EvaluationResult {
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

    return {
      type: e.type as "grammar" | "vocabulary" | "spelling" | "pragmatics",
      severity: e.severity as "minor" | "major",
      text: e.text as string,
      correction: e.correction as string,
      explanation: e.explanation as string,
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

// Evaluation runs on Haiku 4.5 (same precedent as the annotate/skim
// `STREAM_MODEL`). The evaluation output is small and bounded (a single
// `submit_evaluation` tool call, ≤1024 tokens), so Haiku's ~2–3× speedup on
// structured tool-use is a large interactive-latency win with little reasoning
// risk; the swap is gated by the `pnpm eval` Langfuse-dataset harness and is
// reversible by restoring this one constant. NOTE: changing the model is NOT a
// prompt-body edit, so `EVALUATION_SYSTEM_PROMPT_VERSION` is intentionally NOT
// bumped — Langfuse records the model natively on each generation, and bumping
// the prompt-version cohort for a model-only change would corrupt prompt A/B
// comparisons (see CLAUDE.md "Prompt Editing").
const MODEL = "claude-haiku-4-5-20251001" as const;

/** Max tokens for evaluation responses */
const MAX_TOKENS = 1024;

/**
 * SDK request timeout for the (non-streaming, user-waiting) evaluation call.
 * The submit→feedback loop is interactive, so we fail fast rather than inherit
 * the SDK's 10-minute default. ~18 s leaves room for a slow-but-real Haiku
 * response while bounding the tail. (Req 4.1)
 */
export const EVAL_REQUEST_TIMEOUT_MS = 18_000;

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
    systemPromptOverride,
  } = input;

  const userPrompt = buildUserPrompt(
    exercise,
    userAnswer,
    language,
    difficulty,
    grammarGuidance,
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
    model: MODEL,
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
    tools: [EVALUATION_TOOL],
    tool_choice: {
      type: "tool" as const,
      name: EVALUATION_TOOL_NAME,
    },
    temperature: 0,
  });

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

  return parseEvaluationResult(toolUseBlock.input);
}
