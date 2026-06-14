/**
 * LLM-assisted coverage-spec authoring (Pool Coverage Controller, Phase 2).
 * In-repo prompt + forced tool + pure parser. NOT a runtime Lambda path and NOT
 * registered in Langfuse — it's a dev-time authoring aid run by a human via the
 * `propose:coverage-spec` CLI. The model PROPOSES; a human reviews the emitted
 * snippet and commits it into the curriculum. Bump the version on prompt edits.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageSpec,
  type GrammarPoint,
} from "@language-drill/shared";

export const COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION = "coverage-spec@2026-06-14";
export const PROPOSE_COVERAGE_SPEC_TOOL_NAME = "propose_coverage_spec";
const PROPOSAL_MODEL = "claude-sonnet-4-6";
const PROPOSAL_MAX_TOKENS = 1024;
const PROPOSAL_TEMPERATURE = 0.2;

/** Which axes are legal to propose for a grammar point of each `kind`. */
function legalAxesFor(kind: GrammarPoint["kind"]): CoverageAxis[] {
  return kind === "vocab" ? ["wordClass"] : ["person", "polarity", "sentenceType"];
}

export const COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE = `You design coverage specs for a language-exercise generator.

A coverage spec names the 1-2 categorical dimensions a DIVERSE set of approved exercises for one grammar point should vary along, with an absolute minimum count ("floor") per value. The generator pre-builds a pool of exercises per grammar point; without a spec the pool collapses onto the most natural value (e.g. third-person singular, affirmative). Your job is to pick the axes and floors that keep the pool varied WITHOUT forcing unnatural exercises.

Rules:
- Choose AT MOST 2 axes — the most pedagogically important dimensions for this point. Fewer is better.
- Floors are absolute integer counts, coarse (think 5-15), not a fine distribution.
- OMIT values that do not exist for this point (the "NA" case) — e.g. a language without a 2nd-person-plural, or an imperative that has no 1st-person form.
- Give a LOW floor to values that exist but are rare/marginal (the "rare" case) — e.g. literary-only tenses, marginal persons.
- Do NOT force uniformity. Legitimate concentration is real: a negation point is mostly negative; a "there is/there isn't" point is ~50/50 with nothing else to vary. Reflect the natural distribution in the floors (skew them), don't flatten it.
- Only propose axes from the allowed set you are given.

Call the ${PROPOSE_COVERAGE_SPEC_TOOL_NAME} tool with your proposal. For each axis include a short rationale and list any naValues / rareValues you considered.`;

export function buildCoverageSpecProposalUserPrompt(
  gp: GrammarPoint,
  poolStats: string | null,
): string {
  const axes = legalAxesFor(gp.kind);
  const axisLines = axes
    .map((a) => `- ${a}: one of [${COVERAGE_AXIS_VALUES[a].join(", ")}]`)
    .join("\n");
  const stats = poolStats ? `\n\nCurrent approved-pool distribution (grounding):\n${poolStats}` : "";
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel}, kind=${gp.kind})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(" | ")}

Allowed axes for this point:
${axisLines}${stats}

Propose a coverage spec.`;
}

export const PROPOSE_COVERAGE_SPEC_TOOL: Anthropic.Tool = {
  name: PROPOSE_COVERAGE_SPEC_TOOL_NAME,
  description: "Submit the proposed coverage spec for one grammar point.",
  input_schema: {
    type: "object" as const,
    properties: {
      axes: {
        type: "array",
        description: "1-2 axes. Each names a coverage axis and per-value integer floors.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Coverage axis name." },
            floors: {
              type: "object",
              description: "Map of axis value → absolute integer floor (>= 1).",
            },
            rationale: { type: "string" },
            naValues: { type: "array", items: { type: "string" } },
            rareValues: { type: "array", items: { type: "string" } },
          },
          required: ["name", "floors"],
        },
      },
    },
    required: ["axes"],
  },
};

export type CoverageSpecProposal = {
  spec: CoverageSpec;
  rationales: Partial<Record<CoverageAxis, string>>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure validator for the tool output. Throws on any illegality. */
export function parseCoverageSpecProposal(input: unknown): CoverageSpecProposal {
  if (!isObject(input) || !Array.isArray(input.axes)) {
    throw new Error("proposal must be an object with an `axes` array");
  }
  if (input.axes.length < 1 || input.axes.length > 2) {
    throw new Error("proposal must have at most 2 axes (and at least 1)");
  }
  const axes: CoverageSpec["axes"][number][] = [];
  const rationales: Partial<Record<CoverageAxis, string>> = {};
  const seen = new Set<string>();
  for (const raw of input.axes) {
    if (!isObject(raw) || typeof raw.name !== "string") {
      throw new Error("each axis must be an object with a string `name`");
    }
    const name = raw.name;
    if (!(name in COVERAGE_AXIS_VALUES)) throw new Error(`unknown axis '${name}'`);
    if (seen.has(name)) throw new Error(`duplicate axis '${name}'`);
    seen.add(name);
    const legal = COVERAGE_AXIS_VALUES[name as CoverageAxis];
    if (!isObject(raw.floors) || Object.keys(raw.floors).length === 0) {
      throw new Error(`axis '${name}' must have a non-empty floors object`);
    }
    const floors: Record<string, number> = {};
    for (const [value, floor] of Object.entries(raw.floors)) {
      if (!legal.includes(value)) throw new Error(`axis '${name}' has illegal value '${value}'`);
      if (typeof floor !== "number" || !Number.isInteger(floor) || floor <= 0) {
        throw new Error(`axis '${name}' floor for '${value}' must be a positive integer`);
      }
      floors[value] = floor;
    }
    axes.push({ name: name as CoverageAxis, floors });
    if (typeof raw.rationale === "string") rationales[name as CoverageAxis] = raw.rationale;
  }
  return { spec: { axes }, rationales };
}

/** Render a paste-ready `coverageSpec: { … }` TS snippet for the curriculum. */
export function renderCoverageSpecSnippet(proposal: CoverageSpecProposal): string {
  const axes = proposal.spec.axes
    .map((a) => {
      const floors = Object.entries(a.floors)
        .map(([v, f]) => `"${v}": ${f}`)
        .join(", ");
      const rationale = proposal.rationales[a.name];
      const comment = rationale ? `      // ${rationale}\n` : "";
      return `${comment}      { name: "${a.name}", floors: { ${floors} } },`;
    })
    .join("\n");
  return `  coverageSpec: {\n    axes: [\n${axes}\n    ],\n  },`;
}

/** Call Claude with the forced tool and return the validated proposal. */
export async function proposeCoverageSpec(
  client: Anthropic,
  gp: GrammarPoint,
  poolStats: string | null,
  signal?: AbortSignal,
): Promise<CoverageSpecProposal> {
  const response = await client.messages.create(
    {
      model: PROPOSAL_MODEL,
      max_tokens: PROPOSAL_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: buildCoverageSpecProposalUserPrompt(gp, poolStats) }],
      tools: [PROPOSE_COVERAGE_SPEC_TOOL],
      tool_choice: { type: "tool" as const, name: PROPOSE_COVERAGE_SPEC_TOOL_NAME },
      temperature: PROPOSAL_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`proposal: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return parseCoverageSpecProposal(toolUse.input);
}
