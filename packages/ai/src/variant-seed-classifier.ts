/**
 * Variant-seed classifier (2026-08-11 design). In-repo prompt + forced tool +
 * pure parser, mirroring `collapse-triage.ts`. NOT a runtime path and NOT
 * registered in Langfuse — a dev-time aid for the one-off
 * `backfill:variant-seeds` CLI. Do NOT add it to the PROMPTS manifest in
 * `bootstrap-prompts.ts`.
 *
 * Classifies EXISTING approved exercises into the sub-construction
 * (`constructionVariants` entry) each one actually realizes, so the legacy pool
 * can be labelled. Several points' variants are distinguished by syntax rather
 * than lexeme — `es-b1-que-vs-cual` has three variants that all answer `qué` —
 * which is why this cannot be a regex.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { GrammarPoint } from '@language-drill/shared';

export const VARIANT_SEED_CLASSIFIER_PROMPT_VERSION = 'variant-seed-classifier@2026-08-11';
export const VARIANT_SEED_CLASSIFIER_TOOL_NAME = 'classify_variant_seeds';
export const VARIANT_SEED_CLASSIFIER_MODEL = 'claude-sonnet-4-6';
export const VARIANT_SEED_CLASSIFIER_MAX_TOKENS = 4096;
/** Deterministic: this is a labelling task, not a creative one. */
export const VARIANT_SEED_CLASSIFIER_TEMPERATURE = 0;

const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ClassifierConfidence = (typeof CONFIDENCES)[number];

/** One row presented to the classifier. Learner-visible content only. */
export type ClassifierRow = {
  rowId: string;
  /** cloze: the stem with its blank. translation: the L1 source text. */
  prompt: string;
  /** cloze: `correctAnswer`. translation: `referenceTranslation`. */
  answer: string;
};

export type ClassifierAssignment = {
  rowId: string;
  /** A declared variant id, or null when no declared variant fits. */
  variantId: string | null;
  confidence: ClassifierConfidence;
};

export function buildClassifierSystemPrompt(gp: GrammarPoint): string {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) {
    throw new Error(`point '${gp.key}' declares no constructionVariants`);
  }
  const list = variants.map((v) => `- ${v.id}: ${v.directive}`).join('\n');

  return `You label existing language-exercise items with the sub-construction each one uses.

The grammar point below has several distinct sub-constructions. Every exercise was written before those sub-constructions were declared, so none of them is labelled. Your job is to read each exercise and say which sub-construction it actually realizes.

Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}

Sub-constructions:
${list}

Rules:
- Judge what the exercise ACTUALLY does, not what it could be rewritten to do.
- Several sub-constructions may share a surface answer. Decide from the whole sentence — the syntax and the meaning — not from the answer word alone.
- If no declared sub-construction genuinely fits, return null for that row. **null is a correct, expected answer and is strongly preferred over a guess.** An unlabelled row is harmless; a wrongly-labelled one corrupts the pool's measured coverage.
- Use "high" confidence only when the sentence makes the choice unambiguous. Use "low" when you are unsure — low-confidence labels are discarded.
- Return exactly one assignment for every row id you were given, and invent no other row ids.

Call the ${VARIANT_SEED_CLASSIFIER_TOOL_NAME} tool.`;
}

export function buildClassifierUserPrompt(rows: readonly ClassifierRow[]): string {
  const body = rows
    .map((r) => `[${r.rowId}]\n  exercise: ${r.prompt}\n  answer: ${r.answer}`)
    .join('\n\n');
  return `Classify each of these ${rows.length} exercises:\n\n${body}`;
}

export const VARIANT_SEED_CLASSIFIER_TOOL: Anthropic.Tool = {
  name: VARIANT_SEED_CLASSIFIER_TOOL_NAME,
  description: 'Assign each exercise row to one declared sub-construction, or null.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assignments: {
        type: 'array',
        description: 'Exactly one entry per row id given, same ids, no others.',
        items: {
          type: 'object',
          properties: {
            rowId: { type: 'string' },
            variantId: {
              type: ['string', 'null'],
              description: 'A declared sub-construction id, or null if none fits.',
            },
            confidence: { type: 'string', enum: [...CONFIDENCES] },
          },
          required: ['rowId', 'variantId', 'confidence'],
        },
      },
    },
    required: ['assignments'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure validator. Throws on any illegality — the CLI catches per batch and
 * leaves that batch's rows unclassified, which is the safe outcome.
 *
 * The completeness checks matter as much as the legality ones: a silently
 * dropped row would look identical to "the model chose not to label it", and
 * we want the difference to be visible.
 */
export function parseClassifierResult(
  input: unknown,
  gp: GrammarPoint,
  rows: readonly ClassifierRow[],
): ClassifierAssignment[] {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) {
    throw new Error(`point '${gp.key}' declares no constructionVariants`);
  }
  const declared = new Set(variants.map((v) => v.id));
  const expected = new Set(rows.map((r) => r.rowId));

  if (!isObject(input) || !Array.isArray(input.assignments)) {
    throw new Error('result must be an object with an `assignments` array');
  }

  const seen = new Set<string>();
  const out: ClassifierAssignment[] = [];

  for (const raw of input.assignments) {
    if (!isObject(raw) || typeof raw.rowId !== 'string') {
      throw new Error('each assignment needs a string `rowId`');
    }
    const rowId = raw.rowId;
    if (!expected.has(rowId)) throw new Error(`unknown rowId '${rowId}' — not in this batch`);
    if (seen.has(rowId)) throw new Error(`duplicate rowId '${rowId}'`);
    seen.add(rowId);

    const variantId = raw.variantId;
    if (variantId !== null && typeof variantId !== 'string') {
      throw new Error(`rowId '${rowId}': variantId must be a string or null`);
    }
    if (typeof variantId === 'string' && !declared.has(variantId)) {
      throw new Error(`rowId '${rowId}': variantId '${variantId}' is not declared on '${gp.key}'`);
    }

    const confidence = raw.confidence;
    if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
      throw new Error(`rowId '${rowId}': unknown confidence '${String(confidence)}'`);
    }

    out.push({ rowId, variantId, confidence: confidence as ClassifierConfidence });
  }

  if (seen.size !== expected.size) {
    const missing = [...expected].filter((id) => !seen.has(id));
    throw new Error(`missing assignments for: ${missing.join(', ')}`);
  }

  return out;
}

/**
 * A call that reached Anthropic and *then* failed — no tool_use block, or a
 * result the parser rejected. The tokens were billed either way, so the usage
 * travels with the error: a caller that only accumulates usage on success
 * under-reports its spend by an unbounded amount when validation failures are
 * common. (`ClassifierResultError` is deliberately narrower than "any throw
 * from classifyVariantSeeds" — a transport error never reached the model and
 * carries nothing to bill.)
 */
export class ClassifierResultError extends Error {
  readonly usage: Anthropic.Usage;

  constructor(message: string, usage: Anthropic.Usage, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClassifierResultError';
    this.usage = usage;
  }
}

/**
 * Call Claude with the forced tool and return validated assignments plus token
 * usage (the CLI's cost guard needs it). The system block carries the point's
 * variant list and is identical for every batch within a cell, so it is
 * cache-marked — a large cell is many calls against one cached prefix.
 *
 * Post-response failures throw `ClassifierResultError`, which carries the
 * billed usage.
 */
export async function classifyVariantSeeds(
  client: Anthropic,
  gp: GrammarPoint,
  rows: readonly ClassifierRow[],
  signal?: AbortSignal,
): Promise<{ assignments: ClassifierAssignment[]; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: VARIANT_SEED_CLASSIFIER_MODEL,
      max_tokens: VARIANT_SEED_CLASSIFIER_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: buildClassifierSystemPrompt(gp),
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildClassifierUserPrompt(rows) }],
      tools: [VARIANT_SEED_CLASSIFIER_TOOL],
      tool_choice: { type: 'tool' as const, name: VARIANT_SEED_CLASSIFIER_TOOL_NAME },
      temperature: VARIANT_SEED_CLASSIFIER_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new ClassifierResultError(
      `classifier: no tool_use block (stop_reason ${response.stop_reason})`,
      response.usage,
    );
  }
  try {
    return { assignments: parseClassifierResult(toolUse.input, gp, rows), usage: response.usage };
  } catch (err) {
    throw new ClassifierResultError(
      err instanceof Error ? err.message : String(err),
      response.usage,
      { cause: err },
    );
  }
}
