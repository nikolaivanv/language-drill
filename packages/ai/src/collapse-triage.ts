/**
 * Pool-collapse triage (2026-08-11 design). In-repo prompt + forced tool + pure
 * parser, mirroring `coverage-spec-proposal.ts`. NOT a runtime Lambda path and
 * NOT registered in Langfuse — a dev-time aid run by a human via the
 * `audit:collapse` CLI. Do NOT add it to the PROMPTS manifest in
 * `bootstrap-prompts.ts`. Bump the version constant on prompt edits.
 *
 * The model's job is JUDGEMENT, not authoring: it says whether a measured
 * concentration is a real defect and WHICH MECHANISM fixes it. It never writes a
 * spec — `propose:coverage-spec` already covers that half.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { COVERAGE_AXIS_VALUES, ExerciseType } from '@language-drill/shared';
import type { CoverageAxis, GrammarPoint } from '@language-drill/shared';

import type { StemMonotony, SurfaceDistribution } from './collapse-metrics.js';

export const COLLAPSE_TRIAGE_PROMPT_VERSION = 'collapse-triage@2026-08-11';
export const COLLAPSE_TRIAGE_TOOL_NAME = 'report_collapse_verdict';
export const COLLAPSE_TRIAGE_MODEL = 'claude-sonnet-4-6';
export const COLLAPSE_TRIAGE_MAX_TOKENS = 1024;
export const COLLAPSE_TRIAGE_TEMPERATURE = 0.2;

const VERDICTS = ['collapsed', 'legitimate-concentration', 'metric-artifact'] as const;
const MECHANISMS = ['coverage-spec', 'construction-variants', 'seed-pool'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

export type CollapseVerdictName = (typeof VERDICTS)[number];
export type CollapseMechanism = (typeof MECHANISMS)[number];
export type CollapseConfidence = (typeof CONFIDENCES)[number];

export type TriageVerdict = {
  verdict: CollapseVerdictName;
  mechanism?: CollapseMechanism;
  axis?: CoverageAxis;
  missingConstructions?: string[];
  rationale: string;
  confidence: CollapseConfidence;
};

export type TriageInput = {
  grammarPoint: GrammarPoint;
  exerciseType: ExerciseType;
  approved: number;
  target: number;
  signal: 'answer-surface' | 'stem-monotony';
  surface: SurfaceDistribution | null;
  monotony: StemMonotony | null;
};

export const COLLAPSE_TRIAGE_SYSTEM_PROMPT = `You audit a pre-generated language-exercise pool for DISTRIBUTIONAL defects.

A generator builds a pool of exercises per grammar point, one draft at a time. Neither the generator nor the per-draft validator can see the pool's overall distribution, so a pool can silently collapse onto one exemplar while every individual exercise looks fine. You are shown one cell's measured distribution and the grammar point it belongs to. Decide whether the concentration is a DEFECT or CORRECT.

Return one of three verdicts:

- "collapsed" — the point's own text claims content the pool does not drill. Only this verdict requires a mechanism.
- "legitimate-concentration" — the concentration is correct for this point. THIS IS THE DEFAULT WHEN YOU ARE UNSURE.
- "metric-artifact" — the measurement is misleading (e.g. the metric reads a field that does not carry the point's variation), so there is nothing to conclude.

A concentration is a DEFECT only when all three hold:
1. CLAIMED — the missing member appears in the point's own description, examples, or common errors. If it is not the point's content, do not demand it.
2. COLLAPSE-PRONE — free generation defaults to the unmarked member (3rd-person singular, affirmative, singular, declarative), so the missing member needs an explicit directive to appear.
3. FORM-RELEVANT — the missing member produces a different target surface form. A pure meaning contrast does not need a distributional floor.

Legitimate concentration is COMMON. Two worked examples you must not misjudge:
- es-a2-personal-a: the personal "a" IS the point, so a cloze on it has exactly one correct answer. 100% concentration is the target state.
- es-b1-ser-location-events: a ser/estar contrast where "ser" is the answer and "estar" is the DISTRACTOR, not an alternative answer. 94% "ser" is correct.

When the verdict is "collapsed", name the mechanism that fixes it:

- "coverage-spec" — the missing variation is a CATEGORICAL grammatical axis from this closed set: person, number, case, wordClass, polarity, sentenceType, comparison. Give the axis. Choose this ONLY if one of those axis names genuinely separates what is present from what is missing.
- "construction-variants" — the point enumerates several distinct CONSTRUCTIONS and the pool drills only one. No coverage axis can express this (a hearsay "dicen que" and an adversity "me robaron la cartera" are both third-person plural, so no person floor separates them). List the missing constructions in a few words each. Most multi-construction and connector points land here.
- "seed-pool" — the collapse is LEXICAL, not grammatical: the same lemma or content word recurs while the grammar varies correctly. The fix is a curated seed word list, not a distributional floor.

Two hard constraints:
- NEVER recommend a coverage-spec axis that the point's declared constructionVariants already hard-code. Both mechanisms emit an independent MUST clause into the same per-draft prompt and nothing reconciles them; a contradictory pair makes the model drop one, corrupting whichever it drops. If the declared variants already pin polarity or sentence type, that axis is taken.
- NEVER recommend a mechanism the point has already declared and which simply has not been realized in the pool. That is a separate, already-detected finding.

Call the ${COLLAPSE_TRIAGE_TOOL_NAME} tool. Keep the rationale to one sentence.`;

function describeDeclaredConfig(gp: GrammarPoint): string {
  const parts: string[] = [];
  if (gp.coverageSpec) {
    parts.push(
      `coverageSpec axes: ${gp.coverageSpec.axes
        .map((a) => `${a.name} {${Object.entries(a.floors).map(([v, f]) => `${v}: ${f}`).join(', ')}}`)
        .join('; ')}`,
    );
  }
  if (gp.constructionVariants?.length) {
    parts.push(
      `constructionVariants: ${gp.constructionVariants.map((v) => v.id).join(', ')}`,
    );
  }
  if (gp.conjugationSeedWords?.length) {
    parts.push(`conjugationSeedWords: ${gp.conjugationSeedWords.length} curated entries`);
  }
  if (gp.elicitationSeedValues?.length) {
    parts.push(`elicitationSeedValues: ${gp.elicitationSeedValues.length} curated entries`);
  }
  return parts.length > 0 ? parts.join('\n') : 'none declared';
}

export function buildTriageUserPrompt(input: TriageInput): string {
  const { grammarPoint: gp } = input;
  const observed =
    input.signal === 'answer-surface' && input.surface
      ? [
          `Metric: top answer-surface share = ${Math.round(input.surface.share * 100)}% (${input.surface.topCount}/${input.surface.total} rows share the surface "${input.surface.topSurface}")`,
          'Observed distribution (top surfaces):',
          ...input.surface.distribution.map((d) => `  ${d.surface}: ${d.count}`),
        ].join('\n')
      : input.monotony
        ? [
            `Metric: top content-lemma share across exercise stems = ${Math.round(input.monotony.share * 100)}% (${input.monotony.count}/${input.monotony.total} stems contain "${input.monotony.topLemma}")`,
            'This measures SCENE repetition, not grammatical collapse.',
          ].join('\n')
        : 'Metric: (none)';

  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}
Negative examples: ${gp.examplesNegative.join(' | ')}
Common errors: ${gp.commonErrors.join(' | ')}

Exercise type: ${input.exerciseType}
Approved rows: ${input.approved} (cell target ${input.target})

Already declared on this point:
${describeDeclaredConfig(gp)}

${observed}

Is this concentration a defect?`;
}

export const COLLAPSE_TRIAGE_TOOL: Anthropic.Tool = {
  name: COLLAPSE_TRIAGE_TOOL_NAME,
  description: 'Report the triage verdict for one measured cell concentration.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      mechanism: {
        type: 'string',
        enum: [...MECHANISMS],
        description: 'Required when verdict is "collapsed"; omit otherwise.',
      },
      axis: {
        type: 'string',
        enum: Object.keys(COVERAGE_AXIS_VALUES),
        description: 'Required when mechanism is "coverage-spec"; forbidden otherwise.',
      },
      missingConstructions: {
        type: 'array',
        items: { type: 'string' },
        description: 'A few words each; used when mechanism is "construction-variants".',
      },
      rationale: { type: 'string', description: 'One sentence.' },
      confidence: { type: 'string', enum: [...CONFIDENCES] },
    },
    required: ['verdict', 'rationale', 'confidence'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure validator for the tool output. Throws on any illegality — the CLI catches
 * per cell and records the failure rather than aborting the run.
 *
 * The cross-field rules are the ones that matter: a "collapsed" verdict with no
 * mechanism is not actionable, and an `axis` on a non-coverage-spec mechanism
 * means the model conflated the two fixes.
 */
export function parseTriageVerdict(input: unknown): TriageVerdict {
  if (!isObject(input)) throw new Error('verdict must be an object');

  const verdict = input.verdict;
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    throw new Error(`unknown verdict '${String(verdict)}'`);
  }
  const rationale = input.rationale;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new Error('rationale must be a non-empty string');
  }
  const confidence = input.confidence;
  if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
    throw new Error(`unknown confidence '${String(confidence)}'`);
  }

  const result: TriageVerdict = {
    verdict: verdict as CollapseVerdictName,
    rationale: rationale.trim(),
    confidence: confidence as CollapseConfidence,
  };

  const mechanism = input.mechanism;
  if (mechanism !== undefined) {
    if (typeof mechanism !== 'string' || !(MECHANISMS as readonly string[]).includes(mechanism)) {
      throw new Error(`unknown mechanism '${String(mechanism)}'`);
    }
    result.mechanism = mechanism as CollapseMechanism;
  }
  if (result.verdict === 'collapsed' && result.mechanism === undefined) {
    throw new Error("verdict 'collapsed' requires a mechanism");
  }

  const axis = input.axis;
  if (axis !== undefined) {
    if (result.mechanism !== 'coverage-spec') {
      throw new Error("axis is only legal when mechanism is 'coverage-spec'");
    }
    if (typeof axis !== 'string' || !(axis in COVERAGE_AXIS_VALUES)) {
      throw new Error(`unknown axis '${String(axis)}'`);
    }
    result.axis = axis as CoverageAxis;
  }
  if (result.mechanism === 'coverage-spec' && result.axis === undefined) {
    throw new Error("mechanism 'coverage-spec' requires an axis");
  }

  const missing = input.missingConstructions;
  if (missing !== undefined) {
    if (!Array.isArray(missing) || missing.some((m) => typeof m !== 'string')) {
      throw new Error('missingConstructions must be an array of strings');
    }
    result.missingConstructions = missing as string[];
  }

  return result;
}

/**
 * Call Claude with the forced tool and return the validated verdict plus token
 * usage (the CLI's cost guard needs it). The system prompt is cache-marked: a
 * run triages many cells against an identical system block, so prompt caching
 * makes all but the first call cheap.
 */
export async function triageCell(
  client: Anthropic,
  input: TriageInput,
  signal?: AbortSignal,
): Promise<{ verdict: TriageVerdict; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: COLLAPSE_TRIAGE_MODEL,
      max_tokens: COLLAPSE_TRIAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: COLLAPSE_TRIAGE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildTriageUserPrompt(input) }],
      tools: [COLLAPSE_TRIAGE_TOOL],
      tool_choice: { type: 'tool' as const, name: COLLAPSE_TRIAGE_TOOL_NAME },
      temperature: COLLAPSE_TRIAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`triage: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { verdict: parseTriageVerdict(toolUse.input), usage: response.usage };
}
