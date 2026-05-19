/**
 * packages/ai — Theory topic generator core.
 *
 * The static surface of the theory generator: model constants, the public
 * types `TheoryGenerationSpec`, `TheoryDraft`, `TheoryGenerateResult`, the
 * deterministic ID helpers `theoryDraftId` + `deriveTheoryTopicId`, the
 * Anthropic tool schema (`THEORY_GENERATION_TOOL`), and the async entry point
 * `generateTheoryTopic` which performs one Claude call per theory cell.
 *
 * Model pinning: `THEORY_GENERATION_MODEL` is aliased to `GENERATION_MODEL`
 * from `./generate` so the exercise and theory generators stay on the same
 * Sonnet revision. A cross-file equality assertion (Task 7) fails CI if one
 * generator is bumped without the other.
 *
 * Temperature 0.4 (vs. the exercise generator's 0.7) — theory pages prioritize
 * factual accuracy and editorial consistency over surface diversity; a single
 * page is produced per `(language, grammarPoint, batchSeed)` cell, so there
 * is no in-batch dedup pressure to motivate higher sampling.
 *
 * The Phase 3 validator path is intentionally not wired here: Phase 2 inserts
 * drafts as `auto-approved` and the Phase 3 patch will add a separate
 * `validateTheoryTopic` step ahead of insertion.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  type CurriculumCefrLevel,
  type GrammarPoint,
  Language,
  type TheoryTopicJson,
  deterministicUuid,
  parseTheoryTopicJson,
} from "@language-drill/shared";

import type { ClaudeUsageBreakdown } from "./cost-model.js";
import { GENERATION_MODEL } from "./generate.js";
import {
  buildTheorySystemPrompt,
  buildTheoryUserPrompt,
  type TheoryPromptInputs,
} from "./theory-prompts.js";

// ---------------------------------------------------------------------------
// Model + sampling constants
// ---------------------------------------------------------------------------

export const THEORY_TOOL_NAME = "submit_theory_topic" as const;

/**
 * Aliased to the exercise generator's `GENERATION_MODEL`. Bumping one without
 * the other fails the cross-file equality assertion added in Task 7.
 */
export const THEORY_GENERATION_MODEL = GENERATION_MODEL;

/**
 * Lower than the exercise generator's 0.7 — theory prioritizes accuracy and a
 * consistent editorial voice over surface diversity (one page per cell).
 */
export const THEORY_GENERATION_TEMPERATURE = 0.4 as const;

export const THEORY_GENERATION_MAX_TOKENS = 8192 as const;

// ---------------------------------------------------------------------------
// Tool schema — mirrors `TheoryTopicJson` from @language-drill/shared field
// for field. The taxonomy is recursive in two places (`blockCallout.children`
// recurses into block, `inlineStrong/em/hilite/mono.children` recurse into
// inline), so we lean on JSON Schema 2020-12 `$defs` + `$ref`. The SDK's
// `Tool.InputSchema` type accepts arbitrary extra keys (`[k: string]:
// unknown`), so `$defs` passes typecheck directly.
//
// The four inline-wrapper variants (`strong`, `em`, `hilite`, `mono`) share
// an identical shape modulo their `kind` const — the spec text requires each
// to be fully written out (no shared `$def` factoring) so Claude sees an
// unambiguous match arm per variant. Width-mismatch on conjugation tables
// (rows must match head length) is enforced by `parseTheoryTopicJson` at
// runtime, not at the schema layer.
// ---------------------------------------------------------------------------

export const THEORY_GENERATION_TOOL: Anthropic.Tool = {
  name: THEORY_TOOL_NAME,
  description:
    "Submit a complete grammar theory topic for the configured grammar point. Use the exact section structure named in the system prompt.",
  input_schema: {
    type: "object" as const,
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      subtitle: { type: "string" },
      cefr: { type: "string" },
      sections: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/$defs/section" },
      },
    },
    required: ["id", "title", "subtitle", "cefr", "sections"],
    $defs: {
      section: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/block" },
          },
        },
        required: ["id", "title", "body"],
      },
      block: {
        oneOf: [
          { $ref: "#/$defs/blockParagraph" },
          { $ref: "#/$defs/blockCallout" },
          { $ref: "#/$defs/blockExample" },
          { $ref: "#/$defs/blockList" },
          { $ref: "#/$defs/blockConjugationTable" },
        ],
      },
      blockParagraph: {
        type: "object",
        properties: {
          kind: { const: "paragraph" as const },
          text: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "text"],
      },
      blockCallout: {
        type: "object",
        properties: {
          kind: { const: "callout" as const },
          variant: { enum: ["default", "warn"] as const },
          children: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/block" },
          },
        },
        required: ["kind", "children"],
      },
      blockExample: {
        type: "object",
        properties: {
          kind: { const: "example" as const },
          target: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
          en: { type: "string", minLength: 1 },
          note: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "target", "en"],
      },
      blockList: {
        type: "object",
        properties: {
          kind: { const: "list" as const },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/block" },
            },
          },
        },
        required: ["kind", "items"],
      },
      blockConjugationTable: {
        type: "object",
        properties: {
          kind: { const: "conjugation-table" as const },
          head: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          rows: {
            type: "array",
            minItems: 1,
            items: { type: "array", items: { type: "string" } },
          },
        },
        required: ["kind", "head", "rows"],
      },
      inline: {
        oneOf: [
          { $ref: "#/$defs/inlineText" },
          { $ref: "#/$defs/inlineStrong" },
          { $ref: "#/$defs/inlineEm" },
          { $ref: "#/$defs/inlineHilite" },
          { $ref: "#/$defs/inlineMono" },
        ],
      },
      inlineText: {
        type: "object",
        properties: {
          kind: { const: "text" as const },
          text: { type: "string", minLength: 1 },
        },
        required: ["kind", "text"],
      },
      inlineStrong: {
        type: "object",
        properties: {
          kind: { const: "strong" as const },
          children: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "children"],
      },
      inlineEm: {
        type: "object",
        properties: {
          kind: { const: "em" as const },
          children: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "children"],
      },
      inlineHilite: {
        type: "object",
        properties: {
          kind: { const: "hilite" as const },
          children: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "children"],
      },
      inlineMono: {
        type: "object",
        properties: {
          kind: { const: "mono" as const },
          children: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/$defs/inline" },
          },
        },
        required: ["kind", "children"],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TheoryGenerationSpec = {
  /** EN is rejected at the generator's top-level guard (resolved decision #5). */
  language: Exclude<Language, Language.EN>;
  cefrLevel: CurriculumCefrLevel;
  grammarPoint: GrammarPoint;
  /** Bump to re-roll a cell's single page; folds into `theoryDraftId`. */
  batchSeed: string;
};

export type TheoryDraft = {
  /** Deterministic UUID — see `theoryDraftId`. */
  id: string;
  /** Derived from `grammarPoint.key` via `deriveTheoryTopicId` (Req 3.2–3.3). */
  topicId: string;
  contentJson: TheoryTopicJson;
  metadata: {
    grammarPointKey: string;
    /** Always `=== THEORY_GENERATION_MODEL` for drafts produced in this phase. */
    modelId: string;
    /** Total billable input across all three tiers (non-cached + cache-write + cache-read). */
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
};

export type TheoryGenerateResult = {
  draft: TheoryDraft;
  tokenUsage: ClaudeUsageBreakdown;
};

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------

/**
 * Stable UUID for a theory draft. No ordinal — theory is one page per
 * `(language, grammarPoint, batchSeed)` cell (Req 3.1). Bump `batchSeed` to
 * re-roll the cell.
 */
export function theoryDraftId(spec: TheoryGenerationSpec): string {
  return deterministicUuid(
    [spec.language, spec.grammarPoint.key, spec.batchSeed].join("|"),
  );
}

const GRAMMAR_POINT_KEY_PATTERN = /^(es|de|tr)-(a1|a2|b1|b2)-[a-z0-9-]+$/;

/**
 * Derives the theory topic id from a curriculum grammar-point key by stripping
 * the leading 2-letter language prefix. Mirrors Req 3.2–3.3: `es-b1-present-
 * subjunctive` → `b1-present-subjunctive`. Throws if the key shape is invalid.
 */
export function deriveTheoryTopicId(grammarPointKey: string): string {
  if (!GRAMMAR_POINT_KEY_PATTERN.test(grammarPointKey)) {
    throw new Error(
      `Invalid grammar point key for topic-id derivation: ${grammarPointKey}`,
    );
  }
  return grammarPointKey.replace(/^[a-z]{2}-/, "");
}

// ---------------------------------------------------------------------------
// Token-usage extraction — file-private duplicate of generate.ts's `readUsage`.
// Per design.md Component 1, copying ~10 lines is preferred over widening
// generate.ts's surface to export this helper.
// ---------------------------------------------------------------------------

/** Reads `response.usage` and falls back to 0 for any unset cache field. */
function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// generateTheoryTopic — one Claude call per (language, grammarPoint, batchSeed)
// cell. Mirrors the per-iter shape of generate.ts's `generateBatch` loop body
// but without the count-loop, recent-stem dedup, or topic-domain plumbing —
// theory is one page per cell (Req 3.1).
// ---------------------------------------------------------------------------

export async function generateTheoryTopic(
  client: Anthropic,
  spec: TheoryGenerationSpec,
): Promise<TheoryGenerateResult> {
  // Top guards. The cast through `Language` mirrors generate.ts:520 — TS
  // would otherwise reject the EN comparison as tautologically false because
  // `spec.language` is typed `Exclude<Language, Language.EN>`, but we still
  // want the runtime check for SDK callers that bypass the type system.
  if ((spec.language as Language) === Language.EN) {
    throw new Error(
      "language EN is not a learning language for theory generation (resolved decision #5)",
    );
  }
  if (spec.grammarPoint.kind !== "grammar") {
    throw new Error(
      `Theory generator: grammarPoint kind '${spec.grammarPoint.kind}' is not supported in round 1 (resolved decision #6); got '${spec.grammarPoint.kind}' on '${spec.grammarPoint.key}'`,
    );
  }

  const promptInputs: TheoryPromptInputs = {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    grammarPoint: spec.grammarPoint,
  };

  const systemText = await buildTheorySystemPrompt(promptInputs);
  const userText = buildTheoryUserPrompt(promptInputs);

  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: THEORY_GENERATION_MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: systemText,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: userText }],
    tools: [THEORY_GENERATION_TOOL],
    tool_choice: { type: "tool" as const, name: THEORY_TOOL_NAME },
    temperature: THEORY_GENERATION_TEMPERATURE,
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUseBlock) {
    throw new Error(
      `Theory draft malformed: no tool_use block returned (stop_reason=${response.stop_reason})`,
    );
  }
  if (toolUseBlock.name !== THEORY_TOOL_NAME) {
    throw new Error(
      `Theory draft malformed: expected tool '${THEORY_TOOL_NAME}', got '${toolUseBlock.name}'`,
    );
  }

  let contentJson: TheoryTopicJson;
  try {
    contentJson = parseTheoryTopicJson(toolUseBlock.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Theory draft malformed: ${message}`);
  }

  const usage = readUsage(response);

  return {
    draft: {
      id: theoryDraftId(spec),
      topicId: deriveTheoryTopicId(spec.grammarPoint.key),
      contentJson,
      metadata: {
        grammarPointKey: spec.grammarPoint.key,
        modelId: GENERATION_MODEL,
        inputTokens:
          usage.inputTokens +
          usage.cacheCreationInputTokens +
          usage.cacheReadInputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
      },
    },
    tokenUsage: usage,
  };
}
