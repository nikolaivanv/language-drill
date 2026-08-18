/**
 * Construction-coverage audit (2026-08-18 design). In-repo prompts + forced
 * tools + pure parsers, mirroring `collapse-triage.ts` and `gloss-spoilage.ts`.
 * NOT a runtime Lambda path and NOT registered in Langfuse — a dev-time aid run
 * by a human via the `audit:constructions` CLI. Do NOT add it to the PROMPTS
 * manifest in `bootstrap-prompts.ts`. Bump the version constant on prompt edits.
 *
 * Finds the defect neither the generator nor the validator can see: a point
 * whose description claims N constructions but whose approved pool realizes
 * one. `audit:collapse` cannot find it either — two of its three signals read
 * declared mechanisms that a spec-less point lacks by definition, and the other
 * two are lexical, so 45 rows of one construction over 45 different nouns look
 * diverse.
 *
 * This module holds NO db import (`ai` must not import `db` — CI TS2307). The
 * grammar point and every DB-derived value are passed in by the CLI.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { GrammarPoint } from '@language-drill/shared';

export const CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-18';

/** A mustRepresent construction at or below this share of classified rows is a
 *  finding. At the default sample of 24 this means 0 or 1 row — the cliff is
 *  sharp by design: the defect being hunted is near-total absence, not mild
 *  skew (mild skew on a DECLARED mechanism is audit:collapse's variant-skew). */
export const FINDING_MAX_SHARE = 0.05;

/** Above this share of `none` + `unclear`, the honest reading is that the
 *  enumeration was wrong, not that the pool is collapsed. Such a cell reports
 *  as `enumeration-suspect` and produces NO finding — without this gate a bad
 *  stage-1 call manufactures a confident finding from every row it failed to
 *  understand. */
export const JUDGE_HEALTH_MAX_UNRESOLVED_SHARE = 0.33;

export type ClaimedConstruction = {
  /** kebab-case; reused as the proposed variant id in the proposal stage. */
  id: string;
  label: string;
  mustRepresent: boolean;
  rationale: string;
};

export type PointEnumeration = {
  grammarPointKey: string;
  constructions: ClaimedConstruction[];
  mechanism: 'construction-variants' | 'coverage-spec' | 'none';
};

/** One approved row as the CLI loads it. `content` is the raw `content_json`
 *  blob — deliberately untyped, since the audit reads legacy rows whose shape
 *  predates the current discriminated union. */
export type AuditRow = {
  id: string;
  content: Record<string, unknown>;
};

/** One classifier result. `constructionId: null` covers both `none` (the row
 *  realizes something not on the list) and `unclear`. */
export type RowClassification = {
  constructionId: string | null;
};

export type ConstructionCount = {
  id: string;
  label: string;
  mustRepresent: boolean;
  count: number;
  /** Of CLASSIFIED rows, not of sampled rows. */
  share: number;
};

export type CellAnalysis = {
  status: 'ok' | 'finding' | 'enumeration-suspect';
  /** Rows that resolved to a construction id. */
  classified: number;
  /** Rows that resolved to `none` or `unclear`. */
  unresolved: number;
  /** classified + unresolved — the report's denominator. */
  sampled: number;
  counts: ConstructionCount[];
  /** mustRepresent constructions at or below FINDING_MAX_SHARE, minus
   *  dismissals. Always empty unless `status === 'finding'`. */
  missing: ConstructionCount[];
};

/** Tiny inline concurrency limiter. A local copy rather than an import: the
 *  equivalent helper lives in `packages/db/scripts/p-limit.ts`, and `ai` must
 *  not depend on `db`. */
export type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}

/** FNV-1a. Small, dependency-free, and stable across Node versions — the
 *  sample must reproduce exactly from a `--seed`. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic, spread sample of a cell's rows.
 *
 * Ordering by the row's own `created_at` (or by input order, which is the
 * same thing) would be wrong: consecutive rows come from the same generation
 * batch and share a prompt version, so a head-of-list sample measures one
 * batch's habits rather than the cell's. Hashing `(seed, id)` spreads the
 * sample across batches while staying reproducible.
 */
export function sampleRowsForCell<T extends { id: string }>(
  rows: readonly T[],
  seed: string,
  cap: number,
): T[] {
  if (rows.length <= cap) return [...rows];
  return [...rows]
    .map((row) => ({ row, h: hash32(`${seed}:${row.id}`) }))
    .sort((a, b) => (a.h === b.h ? a.row.id.localeCompare(b.row.id) : a.h - b.h))
    .slice(0, cap)
    .map((entry) => entry.row);
}

export type AnalyzeCellInput = {
  constructions: readonly ClaimedConstruction[];
  classifications: readonly RowClassification[];
  dismissedConstructionIds: ReadonlySet<string>;
};

/** Pure verdict. No LLM, no I/O. */
export function analyzeCell(input: AnalyzeCellInput): CellAnalysis {
  const { constructions, classifications, dismissedConstructionIds } = input;

  const sampled = classifications.length;
  const tally = new Map<string, number>();
  let unresolved = 0;
  for (const c of classifications) {
    if (c.constructionId === null) {
      unresolved++;
      continue;
    }
    tally.set(c.constructionId, (tally.get(c.constructionId) ?? 0) + 1);
  }
  const classified = sampled - unresolved;

  const counts: ConstructionCount[] = constructions.map((c) => {
    const count = tally.get(c.id) ?? 0;
    return {
      id: c.id,
      label: c.label,
      mustRepresent: c.mustRepresent,
      count,
      // Guard the divide: a fully unresolved cell is caught by the health gate
      // below, but must not produce NaN shares in the report on the way there.
      share: classified === 0 ? 0 : count / classified,
    };
  });

  if (sampled === 0 || unresolved / sampled > JUDGE_HEALTH_MAX_UNRESOLVED_SHARE) {
    return { status: 'enumeration-suspect', classified, unresolved, sampled, counts, missing: [] };
  }

  const missing = counts.filter(
    (c) =>
      c.mustRepresent &&
      c.share <= FINDING_MAX_SHARE &&
      !dismissedConstructionIds.has(c.id),
  );

  return {
    status: missing.length > 0 ? 'finding' : 'ok',
    classified,
    unresolved,
    sampled,
    counts,
    missing,
  };
}

export const CONSTRUCTION_COVERAGE_MODEL = 'claude-sonnet-4-6';
export const CONSTRUCTION_COVERAGE_MAX_TOKENS = 2048;
export const CONSTRUCTION_COVERAGE_TEMPERATURE = 0.2;

export const ENUMERATION_TOOL_NAME = 'report_claimed_constructions';

const MECHANISMS = ['construction-variants', 'coverage-spec', 'none'] as const;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT = `You read one grammar point's authored description and enumerate the distinct constructions it claims to teach.

You are NOT shown the exercise pool. Enumerate what the point CLAIMS, not what you imagine was built — a later step counts how many exercises realize each of your constructions.

For each construction, decide \`mustRepresent\`. It is TRUE only when ALL THREE hold:

1. **Distinct form** — realizing it makes the learner produce a materially different structure, not merely a different word. A list of lexical variants of one pattern (hinein/herein/hinaus/heraus) is ONE construction, not four.
2. **Actually claimed** — the description or a positive example asserts it, rather than mentioning it in passing.
3. **Cell-realizable** — a single fill-in-the-blank or translate-this-sentence item can exercise it. Discourse-level phenomena spanning several sentences fail this test.

If any test fails, include the item with \`mustRepresent: false\` and say why in the rationale. Being listed is not the same as being load-bearing.

Then pick the \`mechanism\` that would fix an under-represented item:
- \`construction-variants\` — the items are distinct SUB-CONSTRUCTIONS (different structures the learner builds). Example: a reporting verb in the past forcing a tense backshift, versus a reported command taking the subjunctive.
- \`coverage-spec\` — the items are VALUES of one categorical axis (person, number, polarity, gender, case, a set of plural classes). One construction, varying along a dimension.
- \`none\` — the point teaches a single construction with no meaningful internal variation.

A point with fewer than two \`mustRepresent\` constructions is the common, healthy case. Do not manufacture a contrast to be helpful: a spurious construction sends a whole cell into an expensive classification pass and produces a false finding.

Call the ${ENUMERATION_TOOL_NAME} tool.`;

export function buildEnumerationUserPrompt(gp: GrammarPoint): string {
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}
Negative examples: ${gp.examplesNegative.join(' | ')}
Common errors: ${gp.commonErrors.join(' | ')}

Which distinct constructions does this point claim?`;
}

export const ENUMERATION_TOOL: Anthropic.Tool = {
  name: ENUMERATION_TOOL_NAME,
  description: "Report the distinct constructions one grammar point's description claims.",
  input_schema: {
    type: 'object' as const,
    properties: {
      mechanism: { type: 'string', enum: [...MECHANISMS] },
      constructions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'kebab-case, stable.' },
            label: { type: 'string', description: 'Short human-readable name.' },
            mustRepresent: { type: 'boolean' },
            rationale: { type: 'string', description: 'One sentence.' },
          },
          required: ['id', 'label', 'mustRepresent', 'rationale'],
        },
      },
    },
    required: ['mechanism', 'constructions'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireNonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return v.trim();
}

/** Pure validator for the enumeration tool output. Throws on any illegality —
 *  the CLI catches per point and records the failure rather than aborting. */
export function parsePointEnumeration(input: unknown, grammarPointKey: string): PointEnumeration {
  if (!isObject(input)) throw new Error('enumeration must be an object');

  const mechanism = input.mechanism;
  if (typeof mechanism !== 'string' || !(MECHANISMS as readonly string[]).includes(mechanism)) {
    throw new Error(`unknown mechanism '${String(mechanism)}'`);
  }

  const raw = input.constructions;
  if (!Array.isArray(raw)) throw new Error('constructions must be an array');

  const seen = new Set<string>();
  const constructions: ClaimedConstruction[] = raw.map((entry) => {
    if (!isObject(entry)) throw new Error('each construction must be an object');
    const id = requireNonEmptyString(entry.id, 'id');
    if (!KEBAB_CASE.test(id)) throw new Error(`id '${id}' must be kebab-case`);
    if (seen.has(id)) throw new Error(`duplicate construction id '${id}'`);
    seen.add(id);
    if (typeof entry.mustRepresent !== 'boolean') {
      throw new Error('mustRepresent must be a boolean');
    }
    return {
      id,
      label: requireNonEmptyString(entry.label, 'label'),
      mustRepresent: entry.mustRepresent,
      rationale: requireNonEmptyString(entry.rationale, 'rationale'),
    };
  });

  return {
    grammarPointKey,
    constructions,
    mechanism: mechanism as PointEnumeration['mechanism'],
  };
}

/** Call Claude with the forced enumeration tool. The system prompt is
 *  cache-marked: a run enumerates ~312 points against an identical system
 *  block, so all but the first call are cheap. */
export async function enumeratePointConstructions(
  client: Anthropic,
  gp: GrammarPoint,
  signal?: AbortSignal,
  model: string = CONSTRUCTION_COVERAGE_MODEL,
): Promise<{ enumeration: PointEnumeration; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildEnumerationUserPrompt(gp) }],
      tools: [ENUMERATION_TOOL],
      tool_choice: { type: 'tool' as const, name: ENUMERATION_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(
      `enumeratePointConstructions: no tool_use block (stop_reason ${response.stop_reason})`,
    );
  }
  return { enumeration: parsePointEnumeration(toolUse.input, gp.key), usage: response.usage };
}
