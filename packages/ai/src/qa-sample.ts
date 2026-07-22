import type Anthropic from "@anthropic-ai/sdk";
import { ExerciseType } from "@language-drill/shared";
import type { ExerciseContent } from "@language-drill/shared";
import { ZERO_USAGE, type ClaudeUsageBreakdown } from "./cost-model.js";

/**
 * Render exactly what a learner sees for one exercise, as plain text — the
 * crafter's input. Deliberately OMITS every reference/answer field
 * (correctAnswer, acceptableAnswers, referenceTranslation, expectedWord,
 * modelAnswers, targetForm/acceptableForms, breakdown, exampleSentences,
 * referenceParaphrases) so the crafter solves blind, as a user would.
 */
export function renderLearnerView(content: ExerciseContent): string {
  const lines: string[] = [];
  switch (content.type) {
    case ExerciseType.CLOZE: {
      lines.push(content.instructions);
      if (content.context) lines.push(`Context: ${content.context}`);
      if (content.glossEn) lines.push(`Meaning: ${content.glossEn}`);
      lines.push(content.sentence);
      if (content.options?.length) lines.push(`Options: ${content.options.join(", ")}`);
      break;
    }
    case ExerciseType.TRANSLATION: {
      lines.push(content.instructions);
      lines.push(`(${content.sourceLanguage} → ${content.targetLanguage})`);
      lines.push(content.sourceText);
      break;
    }
    case ExerciseType.VOCAB_RECALL: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.exampleSentence) lines.push(`Example: ${content.exampleSentence}`);
      if (content.hints?.length) lines.push(`Hints: ${content.hints.join(", ")}`);
      break;
    }
    case ExerciseType.SENTENCE_CONSTRUCTION: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.keywords?.length) lines.push(`Keywords: ${content.keywords.join(", ")}`);
      if (content.targetStructure) lines.push(`Target structure: ${content.targetStructure}`);
      if (content.register) lines.push(`Register: ${content.register}`);
      break;
    }
    case ExerciseType.CONJUGATION: {
      lines.push(content.instructions);
      lines.push(`Verb: ${content.lemma} (${content.lemmaGloss})`);
      if (content.subject) lines.push(`Subject: ${content.subject.pronoun} (${content.subject.gloss})`);
      lines.push(`Form required: ${content.featureBundle}`);
      break;
    }
    case ExerciseType.CONTEXTUAL_PARAPHRASE: {
      lines.push(content.instructions);
      lines.push(content.sourceText);
      lines.push(content.constraintLabel);
      if (content.bannedTerms?.length) lines.push(`Do not use: ${content.bannedTerms.join(", ")}`);
      if (content.targetRegister) lines.push(`Target register: ${content.targetRegister}`);
      if (content.audience) lines.push(`Audience: ${content.audience}`);
      break;
    }
    default: {
      // Free-writing / dictation are out of scope; caller filters them out.
      const _exhaustive: never = content as never;
      throw new Error(`renderLearnerView: unsupported content type ${(content as ExerciseContent).type}`);
    }
  }
  return lines.join("\n");
}

/** Score at/above which the evaluator is treated as accepting the answer. */
export const PASS_THRESHOLD = 0.8;
/** Score at/below which the evaluator is treated as rejecting the answer. */
export const FAIL_THRESHOLD = 0.4;
/** Below this self-reported confidence, correct/alt flags are suppressed. */
export const MIN_CORRECT_CONFIDENCE = 0.7;

export type QaFlagReason =
  | "false_negative"
  | "false_positive"
  | "acceptable_answers_gap"
  | "low_confidence_solve";

export type ProbeScores = {
  correct: number;
  wrong: number;
  /** null when the exercise has a single canonical answer (no alt crafted). */
  alt: number | null;
};

type Band = "pass" | "fail" | "deadzone";
function band(score: number): Band {
  if (score >= PASS_THRESHOLD) return "pass";
  if (score <= FAIL_THRESHOLD) return "fail";
  return "deadzone";
}

/**
 * Map probe scores to defect reasons. Only *clear* band crossings flag; dead-zone
 * scores never flag. The confidence gate suppresses correct/alt-derived flags
 * (shaky ground truth) but never the false_positive signal (a wrong answer being
 * accepted is independent of how sure the solver was about the correct answer).
 * Emission order is stable: false_negative, false_positive, acceptable_answers_gap,
 * then low_confidence_solve.
 */
export function classifyVerdicts(
  scores: ProbeScores,
  correctConfidence: number,
): QaFlagReason[] {
  const flags: QaFlagReason[] = [];
  const lowConfidence = correctConfidence < MIN_CORRECT_CONFIDENCE;

  if (!lowConfidence && band(scores.correct) === "fail") flags.push("false_negative");
  if (band(scores.wrong) === "pass") flags.push("false_positive");
  if (!lowConfidence && scores.alt !== null && band(scores.alt) === "fail") {
    flags.push("acceptable_answers_gap");
  }
  if (lowConfidence) flags.push("low_confidence_solve");

  return flags;
}

export const QA_SAMPLE_PROMPT_VERSION = "qa-sample@2026-07-22";
export const QA_CRAFTER_MODEL = "claude-opus-4-8" as const;
export const QA_CRAFTER_TOOL_NAME = "submit_probe_answers";
const QA_CRAFTER_MAX_TOKENS = 1024;

export const QA_SAMPLE_SYSTEM_PROMPT_TEMPLATE = `You are a meticulous language-exercise QA solver. You are shown EXACTLY what a learner sees for one exercise — never a reference answer. Your job is to craft three probe answers so we can check whether the automated evaluator behaves correctly:

1. correct — your single best, fully-correct answer to the task.
2. wrong — a plausible answer a real learner at this level might give that is genuinely INCORRECT for the targeted skill (a real error, not gibberish).
3. alt — a DIFFERENT but equally-correct answer (a distinct construction or true synonym), if one legitimately exists; otherwise null. Do not invent a forced variant.

Also report:
- correctConfidence — 0..1, how sure you are that "correct" is unambiguously right given ONLY what the learner sees. Lower it when the task is under-specified or could have several defensible answers.
- ambiguous / ambiguityNote — reasoning as a learner at the stated CEFR level: would they know what is being asked? Set ambiguous=true with a one-line reason only if the TASK or its instructions are genuinely unclear. This is separate from your confidence.

Answer in the exercise's target language. Call the ${QA_CRAFTER_TOOL_NAME} tool.`;

export function buildQaCrafterUserPrompt(params: {
  learnerView: string;
  language: string;
  cefrLevel: string;
  exerciseType: string;
}): string {
  return `Language: ${params.language} · Level: ${params.cefrLevel} · Type: ${params.exerciseType}

Exactly what the learner sees:
"""
${params.learnerView}
"""

Craft the three probe answers.`;
}

const QA_CRAFTER_TOOL: Anthropic.Tool = {
  name: QA_CRAFTER_TOOL_NAME,
  description: "Submit the three probe answers plus confidence and ambiguity assessment.",
  input_schema: {
    type: "object",
    properties: {
      correct: { type: "string" },
      correctConfidence: { type: "number", minimum: 0, maximum: 1 },
      wrong: { type: "string" },
      alt: { type: ["string", "null"] },
      ambiguous: { type: "boolean" },
      ambiguityNote: { type: "string" },
    },
    required: ["correct", "correctConfidence", "wrong", "ambiguous", "ambiguityNote"],
  },
};

export type QaProbe = {
  correct: string;
  correctConfidence: number;
  wrong: string;
  alt: string | null;
  ambiguous: boolean;
  ambiguityNote: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure validator for the crafter tool output. Throws on any illegality. */
export function parseProbe(input: unknown): QaProbe {
  if (!isObject(input)) throw new Error("probe must be an object");
  const { correct, correctConfidence, wrong, alt, ambiguous, ambiguityNote } = input;
  if (typeof correct !== "string" || correct === "") throw new Error("probe.correct must be a non-empty string");
  if (typeof wrong !== "string" || wrong === "") throw new Error("probe.wrong must be a non-empty string");
  if (typeof correctConfidence !== "number" || correctConfidence < 0 || correctConfidence > 1) {
    throw new Error("probe.correctConfidence must be a number in [0,1]");
  }
  if (alt !== undefined && alt !== null && typeof alt !== "string") {
    throw new Error("probe.alt must be a string or null");
  }
  return {
    correct,
    correctConfidence,
    wrong,
    alt: typeof alt === "string" && alt !== "" ? alt : null,
    ambiguous: ambiguous === true,
    ambiguityNote: typeof ambiguityNote === "string" ? ambiguityNote : "",
  };
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

/** Call Claude with the forced tool; return the parsed probe + token usage. */
export async function craftProbeAnswers(
  client: Anthropic,
  params: {
    learnerView: string;
    language: string;
    cefrLevel: string;
    exerciseType: string;
    model?: string;
  },
  signal?: AbortSignal,
): Promise<{ probe: QaProbe; usage: ClaudeUsageBreakdown }> {
  const response = await client.messages.create(
    {
      model: params.model ?? QA_CRAFTER_MODEL,
      max_tokens: QA_CRAFTER_MAX_TOKENS,
      system: [
        { type: "text" as const, text: QA_SAMPLE_SYSTEM_PROMPT_TEMPLATE, cache_control: { type: "ephemeral" as const } },
      ],
      messages: [{ role: "user" as const, content: buildQaCrafterUserPrompt(params) }],
      tools: [QA_CRAFTER_TOOL],
      tool_choice: { type: "tool" as const, name: QA_CRAFTER_TOOL_NAME },
    },
    { signal },
  );
  const usage = response.usage ? readUsage(response) : ZERO_USAGE;
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`qa-craft: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { probe: parseProbe(toolUse.input), usage };
}
