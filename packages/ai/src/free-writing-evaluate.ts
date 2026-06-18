/**
 * packages/ai — Free Writing evaluator. Calls Claude with tool use to produce a
 * rich FreeWritingEvaluation (4 IELTS-style criteria + located errors + an
 * improved version). Mirrors evaluate.ts but with a free-writing-specific
 * schema and a forgiving parser (malformed errors are dropped, not fatal).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  FreeWritingContent,
  FreeWritingEvaluation,
  FreeWritingCriterion,
  FreeWritingCriterionId,
  FreeWritingError,
  FreeWritingSeverity,
  CefrLevel,
  Language,
} from "@language-drill/shared";
import { setResolvedPromptClient, setResolvedPromptVersion } from "./observability.js";
import {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from "./free-writing-prompts.js";
import { getPromptOrFallback, sha8 } from "./prompts-registry.js";
import { ContentRejectedError } from "./content-rejected-error.js";

export const FREE_WRITING_EVAL_TOOL_NAME = "submit_free_writing_evaluation";

// Same interactive fail-fast posture as evaluate.ts, but a larger token budget:
// the FW output (4 criteria + errors + a rewritten paragraph) is much bigger
// than a cloze evaluation.
const MODEL = "claude-sonnet-4-6" as const;
const MAX_TOKENS = 4096;
export const FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS = 45_000;
export const FREE_WRITING_EVAL_MAX_RETRIES = 1;

const CRITERION_IDS: readonly FreeWritingCriterionId[] = ["task", "coherence", "lexis", "grammar"];
const SEVERITIES: readonly FreeWritingSeverity[] = ["high", "med", "low"];

export const FREE_WRITING_EVAL_TOOL: Anthropic.Tool = {
  name: FREE_WRITING_EVAL_TOOL_NAME,
  description:
    "Submit the structured free-writing evaluation: four IELTS-style criteria, located errors, highlights, and an improved version.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallScore: { type: "number", description: "Holistic grade 0.0–1.0." },
      overallCefr: { type: "string", description: "Overall writing CEFR level, e.g. B2." },
      headline: { type: "string", description: "One vivid sentence (English)." },
      summary: { type: "string", description: "2–3 sentence summary (English)." },
      criteria: {
        type: "array",
        description: "Exactly four criteria, in order: task, coherence, lexis, grammar.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ["task", "coherence", "lexis", "grammar"] },
            label: { type: "string" },
            score: { type: "number", description: "0.0–1.0." },
            cefr: { type: "string", description: "Per-criterion CEFR estimate, e.g. B1+." },
            note: { type: "string" },
          },
          required: ["id", "label", "score", "cefr", "note"],
        },
      },
      errors: {
        type: "array",
        description: "Located errors. `original` MUST be an exact substring of the learner's text.",
        items: {
          type: "object",
          properties: {
            n: { type: "number", description: "1-based index." },
            severity: { type: "string", enum: ["high", "med", "low"] },
            type: { type: "string", description: "Short category label in the target language." },
            original: { type: "string", description: "Exact substring of the learner's text." },
            correction: { type: "string" },
            where: { type: "string" },
            note: { type: "string" },
          },
          required: ["n", "severity", "type", "original", "correction", "note"],
        },
      },
      goodSpans: {
        type: "array",
        description: "Exact substrings of the learner's text done well.",
        items: { type: "string" },
      },
      improved: {
        type: "object",
        properties: {
          text: { type: "string", description: "Freshly written improved paragraph(s)." },
          upgrades: {
            type: "array",
            description: "Exact substrings within `text` to highlight as upgrades.",
            items: { type: "string" },
          },
        },
        required: ["text"],
      },
      wordCount: { type: "number" },
      improvedWordCount: { type: "number" },
    },
    required: [
      "overallScore",
      "overallCefr",
      "headline",
      "summary",
      "criteria",
      "errors",
      "goodSpans",
      "improved",
      "wordCount",
      "improvedWordCount",
    ],
  },
};

export type EvaluateFreeWritingInput = {
  content: FreeWritingContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  /** Eval-runner escape hatch — verbatim system prompt, stamped override cohort. */
  systemPromptOverride?: string;
};

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function parseFreeWritingEvaluation(input: unknown): FreeWritingEvaluation {
  if (typeof input !== "object" || input === null) {
    throw new Error("Free writing evaluation must be an object");
  }
  const raw = input as Record<string, unknown>;

  if (!Array.isArray(raw.criteria) || raw.criteria.length !== 4) {
    throw new Error(`Expected exactly 4 criteria, got ${JSON.stringify(raw.criteria)}`);
  }

  const criteria: FreeWritingCriterion[] = (raw.criteria as unknown[]).map((c, i) => {
    const o = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    const id = CRITERION_IDS.includes(o.id as FreeWritingCriterionId)
      ? (o.id as FreeWritingCriterionId)
      : CRITERION_IDS[i];
    return {
      id,
      label: str(o.label, id),
      score: clamp01(o.score),
      cefr: str(o.cefr, "—"),
      note: str(o.note),
    };
  });

  const errorsRaw = Array.isArray(raw.errors) ? (raw.errors as unknown[]) : [];
  const errors: FreeWritingError[] = [];
  errorsRaw.forEach((e, i) => {
    if (typeof e !== "object" || e === null) return;
    const o = e as Record<string, unknown>;
    if (!SEVERITIES.includes(o.severity as FreeWritingSeverity)) return;
    if (typeof o.original !== "string" || typeof o.correction !== "string") return;
    errors.push({
      n: typeof o.n === "number" ? o.n : i + 1,
      severity: o.severity as FreeWritingSeverity,
      type: str(o.type, "—"),
      original: o.original,
      correction: o.correction,
      where: typeof o.where === "string" ? o.where : undefined,
      note: str(o.note),
    });
  });

  const goodSpans = Array.isArray(raw.goodSpans)
    ? (raw.goodSpans as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const improvedRaw =
    typeof raw.improved === "object" && raw.improved !== null
      ? (raw.improved as Record<string, unknown>)
      : {};
  const improved = {
    text: str(improvedRaw.text),
    upgrades: Array.isArray(improvedRaw.upgrades)
      ? (improvedRaw.upgrades as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined,
  };

  return {
    overallScore: clamp01(raw.overallScore),
    overallCefr: str(raw.overallCefr, "—"),
    headline: str(raw.headline),
    summary: str(raw.summary),
    criteria,
    errors,
    goodSpans,
    improved,
    wordCount: typeof raw.wordCount === "number" ? raw.wordCount : 0,
    improvedWordCount: typeof raw.improvedWordCount === "number" ? raw.improvedWordCount : 0,
  };
}

export async function evaluateFreeWriting(
  client: Anthropic,
  input: EvaluateFreeWritingInput,
): Promise<FreeWritingEvaluation> {
  const { content, userAnswer, language, difficulty, systemPromptOverride } = input;

  const userPrompt = buildFreeWritingUserPrompt(content, userAnswer, language, difficulty);

  let systemPromptText: string;
  if (systemPromptOverride !== undefined) {
    systemPromptText = systemPromptOverride;
    setResolvedPromptVersion(`override:${sha8(systemPromptOverride)}`, false);
    setResolvedPromptClient(null);
  } else {
    const resolved = await getPromptOrFallback(
      "free-writing-eval-system-prompt",
      FREE_WRITING_EVAL_SYSTEM_PROMPT,
      FREE_WRITING_EVAL_PROMPT_VERSION,
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
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: [FREE_WRITING_EVAL_TOOL],
    tool_choice: { type: "tool" as const, name: FREE_WRITING_EVAL_TOOL_NAME },
    temperature: 0,
  });

  // A safety refusal arrives as a 200 with stop_reason "refusal" and no tool
  // block. Surface it as a distinct, expected outcome (the route maps it to a
  // user-facing rejection) rather than a generic "no tool block" infra error.
  if (response.stop_reason === "refusal") {
    throw new ContentRejectedError(
      "Claude refused to evaluate this free-writing submission.",
      response.stop_reason,
    );
  }

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUseBlock) {
    throw new Error(
      `Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`,
    );
  }
  if (toolUseBlock.name !== FREE_WRITING_EVAL_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${FREE_WRITING_EVAL_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  return parseFreeWritingEvaluation(toolUseBlock.input);
}
