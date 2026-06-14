/**
 * packages/ai — Dictation grading orchestration.
 *
 * gradeDictationAnswer = deterministic diff (dictation-diff.ts) + one Claude
 * "forgiveness" classification call + adjusted-accuracy recompute → DictationResult.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  CefrLevel,
  DictationContent,
  DictationCriterion,
  DictationDifference,
  DictationDiffSegment,
  DictationResult,
  EvaluationError,
  Language,
} from "@language-drill/shared";
import { diffDictation, type DiffSegment } from "./dictation-diff.js";
import {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from "./dictation-prompts.js";
import { getPromptOrFallback } from "./prompts-registry.js";

const MODEL = "claude-haiku-4-5-20251001" as const;
const MAX_TOKENS = 1024;

export const DICTATION_TOOL_NAME = "submit_dictation_classification";

export const DICTATION_TOOL: Anthropic.Tool = {
  name: DICTATION_TOOL_NAME,
  description: "Submit the classification of each dictation difference plus the verdict.",
  input_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      listeningCefr: { type: "string", description: "CEFR level A1–C2." },
      differences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            kind: { type: "string", enum: ["accepted", "error"] },
            category: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "high"],
              description: "Required for kind=error; omit for kind=accepted.",
            },
            note: { type: "string" },
          },
          required: ["id", "kind", "category", "note"],
        },
      },
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            score: { type: "number" },
            cefr: { type: "string" },
            note: { type: "string" },
          },
          required: ["id", "label", "score", "cefr", "note"],
        },
      },
    },
    required: ["headline", "summary", "listeningCefr", "differences", "criteria"],
  },
};

type RawClassification = {
  headline: string;
  summary: string;
  listeningCefr: string;
  differences: Array<{ id: number; kind: "accepted" | "error"; category: string; severity: "low" | "high" | null; note: string }>;
  criteria: DictationCriterion[];
};

export function parseDictationClassification(input: unknown): RawClassification {
  if (typeof input !== "object" || input === null) {
    throw new Error("Dictation classification must be an object");
  }
  const raw = input as Record<string, unknown>;
  for (const f of ["headline", "summary", "listeningCefr"] as const) {
    if (typeof raw[f] !== "string" || (raw[f] as string).length === 0) {
      throw new Error(`Invalid dictation ${f}`);
    }
  }
  if (!Array.isArray(raw.differences)) throw new Error("differences must be an array");
  if (!Array.isArray(raw.criteria)) throw new Error("criteria must be an array");
  return raw as RawClassification;
}

export type GradeDictationInput = {
  exercise: DictationContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  systemPromptOverride?: string;
};

function cefrFor(score: number): string {
  if (score >= 0.97) return "C1";
  if (score >= 0.9) return "B2";
  if (score >= 0.75) return "B1";
  if (score >= 0.5) return "A2";
  return "A1";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rebuild the learner's transcription with each accepted difference's typed
 * token replaced by the reference token. Token-level (uses the diff segments),
 * sufficient for the adjusted-accuracy estimate. Returns null when there are no
 * accepted differences (caller falls back to raw).
 */
function applyAccepted(segments: ReadonlyArray<DiffSegment>, acceptedIds: Set<number>): string | null {
  if (acceptedIds.size === 0) return null;
  const parts: string[] = [];
  for (const s of segments) {
    if (s.kind === "match") {
      parts.push(s.text);
    } else if (acceptedIds.has(s.id)) {
      if (s.expected) parts.push(s.expected); // accepted ⇒ count as the reference token
    } else {
      if (s.got) parts.push(s.got);
    }
  }
  return parts.join(" ");
}

export async function gradeDictationAnswer(
  client: Anthropic,
  input: GradeDictationInput,
): Promise<DictationResult> {
  const { exercise, userAnswer, language, systemPromptOverride } = input;
  const diff = diffDictation(exercise.referenceText, userAnswer);

  const systemPromptText =
    systemPromptOverride ??
    (await getPromptOrFallback(
      "dictation-eval-system-prompt",
      DICTATION_EVAL_SYSTEM_PROMPT,
      DICTATION_EVAL_PROMPT_VERSION,
    )).text;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: systemPromptText, cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user" as const,
        content: buildDictationUserPrompt({
          referenceText: exercise.referenceText,
          userAnswer,
          language,
          differences: diff.differences,
        }),
      },
    ],
    tools: [DICTATION_TOOL],
    tool_choice: { type: "tool" as const, name: DICTATION_TOOL_NAME },
    temperature: 0,
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block || block.name !== DICTATION_TOOL_NAME) {
    throw new Error(`Dictation classification tool not returned. stop_reason=${response.stop_reason}`);
  }
  const cls = parseDictationClassification(block.input);

  const byId = new Map(cls.differences.map((d) => [d.id, d]));
  const differences: DictationDifference[] = diff.differences.map((d) => {
    const c = byId.get(d.id);
    const kind = c?.kind ?? "error";
    return {
      id: d.id,
      kind,
      category: c?.category ?? "difference",
      severity: kind === "error" ? (c?.severity === "high" ? "high" : "low") : null,
      got: d.got,
      expected: d.expected,
      note: c?.note ?? "",
    };
  });
  const acceptedIds = new Set(differences.filter((d) => d.kind === "accepted").map((d) => d.id));

  const adjustedTyped = applyAccepted(diff.segments, acceptedIds);
  const adjustedCharAccuracy =
    adjustedTyped === null
      ? diff.rawCharAccuracy
      : diffDictation(exercise.referenceText, adjustedTyped).rawCharAccuracy;

  const segments: DictationDiffSegment[] = diff.segments.map((s) => {
    if (s.kind === "match") return { kind: "match", text: s.text };
    const cls2 = differences.find((d) => d.id === s.id)!;
    if (cls2.kind === "accepted") {
      return { kind: "accepted", id: s.id, got: s.got, expected: s.expected };
    }
    return { kind: "error", id: s.id, got: s.got, expected: s.expected, severity: cls2.severity === "high" ? "high" : "low" };
  });

  const errors: EvaluationError[] = differences
    .filter((d) => d.kind === "error")
    .map((d) => ({
      type: "spelling",
      severity: d.severity === "high" ? "major" : "minor",
      text: d.got,
      correction: d.expected,
      explanation: d.note,
    }));

  const criteria: DictationCriterion[] = [
    { id: "char", label: "Character accuracy", score: round2(adjustedCharAccuracy), cefr: cefrFor(adjustedCharAccuracy), note: "Character match after accepted equivalences." },
    { id: "word", label: "Word accuracy", score: round2(diff.wordAccuracy), cefr: cefrFor(diff.wordAccuracy), note: "Reference words transcribed correctly." },
    ...cls.criteria.filter((c) => c.id === "phon" || c.id === "bound"),
  ];

  return {
    kind: "dictation",
    score: adjustedCharAccuracy,
    grammarAccuracy: adjustedCharAccuracy,
    vocabularyRange: cls.listeningCefr,
    taskAchievement: diff.wordAccuracy,
    feedback: cls.summary,
    errors,
    estimatedCefrEvidence: cls.listeningCefr,
    rawCharAccuracy: diff.rawCharAccuracy,
    adjustedCharAccuracy,
    wordAccuracy: diff.wordAccuracy,
    listeningCefr: cls.listeningCefr,
    headline: cls.headline,
    summary: cls.summary,
    diff: segments,
    differences,
    criteria,
  };
}
