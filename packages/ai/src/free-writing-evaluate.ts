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
import type { AttributionKey } from "./prompts.js";
import { extractToolUse, shapeToolRequest, type Effort } from "./model-request.js";

export const FREE_WRITING_EVAL_TOOL_NAME = "submit_free_writing_evaluation";

// A far larger budget than evaluate.ts: the FW output (4 criteria + every
// located error + a rewritten paragraph) is big. Measured 2026-10-06 on a
// 186-word B2 essay: 3,321 output tokens in 51.5s (~64 tok/s) — so 4096 left
// too little headroom (a messier essay would truncate the tool call), and the
// call is too slow for API Gateway's 30s cap. It is served from the eval-submit
// Function URL instead, whose Lambda timeout (EVAL_SUBMIT_TIMEOUT_SECONDS in
// infra) must stay >= REQUEST_TIMEOUT × (1 + MAX_RETRIES) plus DB work.
// 8192 tokens at ~64 tok/s ≈ 128s, hence the 135s request timeout.
const MODEL = "claude-sonnet-4-6" as const;
const MAX_TOKENS = 8192;
export const FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS = 135_000;
export const FREE_WRITING_EVAL_MAX_RETRIES = 1;

const CRITERION_IDS: readonly FreeWritingCriterionId[] = ["task", "coherence", "lexis", "grammar"];
const SEVERITIES: readonly FreeWritingSeverity[] = ["high", "med", "low"];

/**
 * Build the `submit_free_writing_evaluation` tool. When `attributionKeys` is
 * non-empty, each located error gains an OPTIONAL `grammarPointKey` constrained
 * to a closed `enum` of the level's in-scope curriculum keys — so the evaluator
 * can attribute an error to a point but can never invent a key. Mirrors
 * `buildEvaluationTool` in evaluate.ts.
 */
export function buildFreeWritingEvalTool(
  attributionKeys?: readonly AttributionKey[],
): Anthropic.Tool {
  const errorProps: Record<string, unknown> = {
    n: { type: "number", description: "1-based index." },
    severity: { type: "string", enum: ["high", "med", "low"] },
    type: { type: "string", description: "Short category label in the target language." },
    original: { type: "string", description: "Exact substring of the learner's text." },
    correction: { type: "string" },
    where: { type: "string" },
    note: { type: "string" },
  };

  if (attributionKeys && attributionKeys.length > 0) {
    errorProps.grammarPointKey = {
      type: "string",
      enum: attributionKeys.map((k) => k.key),
      description:
        "OPTIONAL. The curriculum key of the grammar point THIS error violates. " +
        "Must be one of the keys listed in the user message's 'Grammar points in scope' block. " +
        "Omit entirely if the error does not violate any listed point (e.g. a lexical or spelling slip).",
    };
  }

  return {
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
            properties: errorProps,
            // grammarPointKey is intentionally NOT required (attribution is best-effort).
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
}

/** Back-compat default tool (no attribution field). */
export const FREE_WRITING_EVAL_TOOL: Anthropic.Tool = buildFreeWritingEvalTool();

export type EvaluateFreeWritingInput = {
  content: FreeWritingContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  /**
   * The closed set of curriculum grammar-point keys (key + name) in scope for
   * this level. Resolved by the caller from `grammarPointsAtOrBelow`. When
   * present, the evaluator may attribute each error to one of these keys
   * (constrained by the tool-schema enum + the user-prompt list); when absent,
   * attribution is skipped (keys → null). Unlike the focused evaluator, the FW
   * set is the whole level's curriculum since free writing isn't tied to one point.
   */
  attributionKeys?: readonly AttributionKey[];
  /** Eval-runner escape hatch — verbatim system prompt, stamped override cohort. */
  systemPromptOverride?: string;
  /** Eval-runner escape hatch — run on a different model than production. */
  modelOverride?: string;
  /** Eval-runner escape hatch — sent as `output_config.effort`. */
  effortOverride?: Effort;
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

/**
 * Tool-use sometimes delivers a nested value as a JSON-ENCODED STRING instead
 * of the array/object the schema declares — the model dodges nested-quote
 * escaping by stringifying the whole value. Observed for the generator's
 * `requiredElements` (#721) and, on 2026-10-06, for this evaluator's
 * `improved` (`"[{\"text\": …}]"`), which the object-only parse silently
 * reduced to an empty rewrite. Decode one layer; anything that does not parse
 * is returned unchanged so the caller's own type check still applies.
 */
function decodeJsonString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return v;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return v;
  }
}

/**
 * Normalizes `improved` to an object. Beyond a JSON-encoded string, the model
 * has wrapped it in a one-element array; a plain (non-JSON) string is taken as
 * the rewritten text itself rather than discarded.
 */
function improvedObject(v: unknown): Record<string, unknown> {
  let decoded = decodeJsonString(v);
  if (Array.isArray(decoded)) {
    decoded = decoded.find((el) => typeof el === "object" && el !== null) ?? decoded[0];
  }
  if (typeof decoded === "string") return { text: decoded };
  return typeof decoded === "object" && decoded !== null
    ? (decoded as Record<string, unknown>)
    : {};
}

export function parseFreeWritingEvaluation(
  input: unknown,
  validKeys?: ReadonlySet<string>,
): FreeWritingEvaluation {
  if (typeof input !== "object" || input === null) {
    throw new Error("Free writing evaluation must be an object");
  }
  const raw = input as Record<string, unknown>;
  const criteriaRaw = decodeJsonString(raw.criteria);

  if (!Array.isArray(criteriaRaw) || criteriaRaw.length !== 4) {
    throw new Error(`Expected exactly 4 criteria, got ${JSON.stringify(raw.criteria)}`);
  }

  const criteria: FreeWritingCriterion[] = (criteriaRaw as unknown[]).map((c, i) => {
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

  const errorsDecoded = decodeJsonString(raw.errors);
  const errorsRaw = Array.isArray(errorsDecoded) ? (errorsDecoded as unknown[]) : [];
  const errors: FreeWritingError[] = [];
  errorsRaw.forEach((e, i) => {
    if (typeof e !== "object" || e === null) return;
    const o = e as Record<string, unknown>;
    if (!SEVERITIES.includes(o.severity as FreeWritingSeverity)) return;
    if (typeof o.original !== "string" || typeof o.correction !== "string") return;
    // Per-error attribution: keep the key only if it is in the level's in-scope
    // set; otherwise null. Null when absent or when no set was supplied.
    const grammarPointKey =
      validKeys && typeof o.grammarPointKey === "string" && validKeys.has(o.grammarPointKey)
        ? o.grammarPointKey
        : null;
    errors.push({
      n: typeof o.n === "number" ? o.n : i + 1,
      severity: o.severity as FreeWritingSeverity,
      type: str(o.type, "—"),
      original: o.original,
      correction: o.correction,
      where: typeof o.where === "string" ? o.where : undefined,
      note: str(o.note),
      grammarPointKey,
    });
  });

  const goodSpansRaw = decodeJsonString(raw.goodSpans);
  const goodSpans = Array.isArray(goodSpansRaw)
    ? (goodSpansRaw as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const improvedRaw = improvedObject(raw.improved);
  const upgradesRaw = decodeJsonString(improvedRaw.upgrades);
  const improved = {
    text: str(improvedRaw.text),
    upgrades: Array.isArray(upgradesRaw)
      ? (upgradesRaw as unknown[]).filter((s): s is string => typeof s === "string")
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
  const { content, userAnswer, language, difficulty, attributionKeys, systemPromptOverride } = input;

  const userPrompt = buildFreeWritingUserPrompt(
    content,
    userAnswer,
    language,
    difficulty,
    attributionKeys,
  );

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

  const effectiveModel = input.modelOverride ?? MODEL;
  const shaped = shapeToolRequest(effectiveModel, {
    tool: buildFreeWritingEvalTool(attributionKeys),
    thinking: "off",
    temperature: 0,
    effort: input.effortOverride,
  });

  const response = await client.messages.create({
    model: effectiveModel,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: systemPromptText,
        cache_control: { type: "ephemeral" as const },
      },
      ...(shaped.systemSuffix
        ? [{ type: "text" as const, text: shaped.systemSuffix }]
        : []),
    ],
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: shaped.tools,
    tool_choice: shaped.tool_choice,
    ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
    ...(shaped.temperature !== undefined
      ? { temperature: shaped.temperature }
      : {}),
    ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
  } as Anthropic.MessageCreateParamsNonStreaming);

  const toolInput = extractToolUse(response, FREE_WRITING_EVAL_TOOL_NAME, {
    refusalMessage: "Claude refused to evaluate this free-writing submission.",
  });

  const validKeys =
    attributionKeys && attributionKeys.length > 0
      ? new Set(attributionKeys.map((k) => k.key))
      : undefined;
  return parseFreeWritingEvaluation(toolInput, validKeys);
}
