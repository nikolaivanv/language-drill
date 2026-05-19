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
import { setResolvedPromptVersion } from "./observability.js";
import {
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  buildUserPrompt,
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

/** Default model for evaluation */
const MODEL = "claude-sonnet-4-5" as const;

/** Max tokens for evaluation responses */
const MAX_TOKENS = 1024;

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
  const { exercise, userAnswer, language, difficulty, systemPromptOverride } =
    input;

  const userPrompt = buildUserPrompt(exercise, userAnswer, language, difficulty);

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
