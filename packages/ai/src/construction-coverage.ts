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
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';

export const CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-19';

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

Never use a double-quote character inside \`label\` or \`rationale\`. Use single quotes if you need to quote a gloss ('in case'), because an unescaped inner double quote can corrupt the tool payload.

Every \`id\` must be ASCII kebab-case — lowercase a-z, digits and hyphens only. Transliterate accented characters rather than emitting them (\`tú\` becomes \`tu\`). When two items would collide once transliterated, disambiguate them by MEANING rather than by the accent (\`tu-possessive\` and \`tu-subject-pronoun\`, never \`tu\` and \`tu-tu\`).

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

  // Anthropic's tool-use occasionally serializes a nested array as a JSON
  // string literal instead of a native array. `parseTheoryTopicJson` in
  // @language-drill/shared already defends against exactly this (documented
  // there at ~75% of theory-generation runs); this parser did not, and it cost
  // 3 of 114 points on the 2026-08-19 ES sweep — all three returned
  // `stop_reason: 'tool_use'` with output well under the token cap, so it is
  // the serialization, not truncation. Decode before the array check; anything
  // that does not decode to an array falls through to it unchanged.
  let raw = input.constructions;
  if (typeof raw === 'string') {
    try {
      const decoded: unknown = JSON.parse(raw);
      if (Array.isArray(decoded)) raw = decoded;
    } catch {
      // leave as-is; the array check below produces the actionable error
    }
  }
  if (!Array.isArray(raw)) throw new Error('constructions must be an array');

  const seen = new Set<string>();
  const constructions: ClaimedConstruction[] = raw.map((entry) => {
    if (!isObject(entry)) throw new Error('each construction must be an object');
    const rawId = requireNonEmptyString(entry.id, 'id');
    // Lower-case BEFORE validating. An id is an identifier — case carries no
    // meaning — and rejecting one costs the entire point's enumeration, not
    // just the construction. Both TR faults in the 2026-08-21 sweep were a
    // capital I the model had copied from Turkish suffix notation
    // ('ordinal-suffix-incI' from -(I)ncI, 'past-necessitative-maliydI' from
    // -mAlIydI), which would have kept failing on every re-run. Case-folding
    // before the duplicate check also means ids differing only in case still
    // collide, rather than both surviving as distinct constructions.
    const id = rawId.toLowerCase();
    if (!KEBAB_CASE.test(id)) throw new Error(`id '${rawId}' must be kebab-case`);
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

export const CLASSIFICATION_TOOL_NAME = 'report_row_constructions';
export const DEFAULT_CLASSIFICATION_BATCH_SIZE = 20;

/** The escape hatches. Both collapse to `constructionId: null` — the verdict
 *  step only needs "did this row resolve", and separating them would imply a
 *  precision the classifier does not have. */
const UNRESOLVED_IDS = new Set(['none', 'unclear']);

/**
 * The learner-visible surface of a row, per exercise type. Returns null when
 * the row is malformed — a defensive skip beats a crash on one legacy row.
 */
export function rowSurfaceFor(
  type: ExerciseType,
  content: Record<string, unknown>,
): string | null {
  if (type === ExerciseType.CLOZE) {
    const stem = content.sentence;
    const answer = content.correctAnswer;
    if (typeof stem !== 'string' || typeof answer !== 'string') return null;
    return `${stem}   [answer: ${answer}]`;
  }
  if (type === ExerciseType.TRANSLATION) {
    const source = content.sourceText;
    const reference = content.referenceTranslation;
    if (typeof source !== 'string' || typeof reference !== 'string') return null;
    return `${source}   [reference: ${reference}]`;
  }
  if (type === ExerciseType.SENTENCE_CONSTRUCTION) {
    // SC has no `correctAnswer`, so the MODEL ANSWERS are the evidence — they
    // are the target-language sentences the row is built around, and the only
    // thing that shows which sub-construction it actually drills. The same
    // mapping #687 settled on for `backfill:variant-seeds`.
    //
    // `targetStructure` rides along when present: it is the generator's own
    // prose description of what the draft was asked for, which is precisely the
    // question being put to the classifier.
    //
    // Capped at three answers so one verbose row cannot crowd out its
    // batch-mates, and null when there is no usable answer — classifying a
    // sub-construction from a situation prompt alone would be a guess, and a
    // guess here is worse than an honest unresolved.
    const prompt = content.prompt;
    if (typeof prompt !== 'string') return null;
    const models = Array.isArray(content.modelAnswers)
      ? content.modelAnswers.filter(
          (m): m is string => typeof m === 'string' && m.trim() !== '',
        )
      : [];
    if (models.length === 0) return null;
    const target =
      typeof content.targetStructure === 'string' && content.targetStructure.trim() !== ''
        ? `   [target structure: ${content.targetStructure}]`
        : '';
    return `${prompt}${target}   [model answers: ${models.slice(0, 3).join(' | ')}]`;
  }
  return null;
}

export const CLASSIFICATION_SYSTEM_PROMPT = `You classify pre-generated language exercises by which construction each one realizes.

You are given a numbered list of constructions and a numbered list of exercises. For EVERY exercise, return the id of the single construction it realizes.

Two escape hatches, and using them honestly matters more than covering every row:
- \`none\` — the exercise realizes some other construction of this grammar point that is not on the list.
- \`unclear\` — the exercise is ambiguous between two listed constructions, or too short to tell.

Do not stretch an exercise to fit a listed construction. A high rate of \`none\` is a useful signal that the construction list is wrong, and it is read as exactly that downstream — guessing to look decisive destroys that signal.

Judge only what the exercise actually contains. Call the ${CLASSIFICATION_TOOL_NAME} tool with one entry per exercise.`;

export type ClassificationInput = {
  constructions: readonly ClaimedConstruction[];
  type: ExerciseType;
  rows: readonly AuditRow[];
};

export function buildClassificationUserPrompt(input: ClassificationInput): string {
  // Labels only — never the enumerator's rationale, so the classifier reads
  // what a row IS rather than what the enumerator hoped to find.
  const list = input.constructions.map((c) => `- ${c.id}: ${c.label}`).join('\n');
  const rows = input.rows
    .map((r, i) => `${i + 1}. ${rowSurfaceFor(input.type, r.content) ?? '(unreadable row)'}`)
    .join('\n');
  return `Constructions:
${list}

Exercises (${input.type}):
${rows}

Classify every exercise.`;
}

export const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: CLASSIFICATION_TOOL_NAME,
  description: 'Report which construction each exercise realizes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '1-based index of the exercise.' },
            constructionId: {
              type: 'string',
              description: "A listed construction id, or 'none', or 'unclear'.",
            },
          },
          required: ['index', 'constructionId'],
        },
      },
    },
    required: ['classifications'],
  },
};

/**
 * Pure validator. Returns exactly `batchSize` entries in input order.
 *
 * An id the enumeration never produced is normalised to null rather than
 * trusted: a hallucinated id would otherwise inflate a construction's count
 * and mask the very absence being measured. Omitted rows are likewise null —
 * a silently short answer must not shrink the denominator.
 */
export function parseRowClassifications(
  input: unknown,
  batchSize: number,
  validIds: ReadonlySet<string>,
): RowClassification[] {
  if (!isObject(input)) throw new Error('classification result must be an object');
  const raw = input.classifications;
  if (!Array.isArray(raw)) throw new Error('classifications must be an array');

  const out: RowClassification[] = Array.from({ length: batchSize }, () => ({
    constructionId: null,
  }));

  for (const entry of raw) {
    if (!isObject(entry)) throw new Error('each classification must be an object');
    const index = entry.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > batchSize) {
      throw new Error(`classification index ${String(index)} out of range 1..${batchSize}`);
    }
    const id = entry.constructionId;
    if (typeof id !== 'string') throw new Error('constructionId must be a string');
    out[index - 1] = {
      constructionId: UNRESOLVED_IDS.has(id) || !validIds.has(id) ? null : id,
    };
  }

  return out;
}

/** Call Claude with the forced classification tool for one batch of rows. */
export async function classifyRowBatch(
  client: Anthropic,
  input: ClassificationInput,
  signal?: AbortSignal,
): Promise<{ classifications: RowClassification[]; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: CONSTRUCTION_COVERAGE_MODEL,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: CLASSIFICATION_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildClassificationUserPrompt(input) }],
      tools: [CLASSIFICATION_TOOL],
      tool_choice: { type: 'tool' as const, name: CLASSIFICATION_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`classifyRowBatch: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  const validIds = new Set(input.constructions.map((c) => c.id));
  return {
    classifications: parseRowClassifications(toolUse.input, input.rows.length, validIds),
    usage: response.usage,
  };
}

export const PROPOSAL_TOOL_NAME = 'report_mechanism_proposal';

const PROPOSABLE_MECHANISMS = ['construction-variants', 'coverage-spec'] as const;

export type MechanismProposal = {
  mechanism: (typeof PROPOSABLE_MECHANISMS)[number];
  /** Paste-ready TypeScript fragment for the curriculum entry. */
  snippet: string;
  notes: string;
};

export const PROPOSAL_SYSTEM_PROMPT = `You author a fix for a grammar point whose exercise pool has been measured as covering only some of the constructions the point teaches.

You are given the point, the constructions it claims, and how many sampled exercises realize each. Produce a paste-ready TypeScript fragment for the curriculum entry.

For \`construction-variants\`, emit a \`constructionVariants\` array. Each entry needs:
- \`id\` — kebab-case, stable. Reuse the ids you are given; renaming one resets that variant's measured coverage.
- \`directive\` — strict prompt text naming the sub-construction, with a concrete exemplar. This is injected verbatim into the generation prompt, so it must be an instruction a generator can follow, not a description of the grammar.
- \`share\` — relative weight. Give the prototypical construction a plurality without letting it own the pool; a share of 3 against three share-1 variants targets 50%.

For \`coverage-spec\`, emit a \`coverageSpec\` fragment with one or two axes and an absolute minimum approved-count floor per value. Floors are absolute counts, not percentages.

Keep the snippet minimal — only the fields being added. A human reviews and commits it.`;

export type ProposalInput = {
  grammarPoint: GrammarPoint;
  mechanism: (typeof PROPOSABLE_MECHANISMS)[number];
  counts: readonly ConstructionCount[];
  sampled: number;
};

export function buildProposalUserPrompt(input: ProposalInput): string {
  const { grammarPoint: gp } = input;
  const rows = input.counts
    .map(
      (c) =>
        `- ${c.id} (${c.label}) — realized ${c.count}/${input.sampled} sampled` +
        `${c.mustRepresent ? '' : ' [not load-bearing]'}`,
    )
    .join('\n');
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}

Measured coverage:
${rows}

Recommended mechanism: ${input.mechanism}

Author the fix.`;
}

export const PROPOSAL_TOOL: Anthropic.Tool = {
  name: PROPOSAL_TOOL_NAME,
  description: 'Report a paste-ready curriculum fragment fixing a coverage gap.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mechanism: { type: 'string', enum: [...PROPOSABLE_MECHANISMS] },
      snippet: { type: 'string', description: 'Paste-ready TypeScript fragment.' },
      notes: { type: 'string', description: 'One or two sentences for the reviewer.' },
    },
    required: ['mechanism', 'snippet', 'notes'],
  },
};

export function parseMechanismProposal(input: unknown): MechanismProposal {
  if (!isObject(input)) throw new Error('proposal must be an object');
  const mechanism = input.mechanism;
  if (
    typeof mechanism !== 'string' ||
    !(PROPOSABLE_MECHANISMS as readonly string[]).includes(mechanism)
  ) {
    throw new Error(`mechanism '${String(mechanism)}' is not proposable`);
  }
  return {
    mechanism: mechanism as MechanismProposal['mechanism'],
    snippet: requireNonEmptyString(input.snippet, 'snippet'),
    notes: requireNonEmptyString(input.notes, 'notes'),
  };
}

export async function proposeMechanism(
  client: Anthropic,
  input: ProposalInput,
  signal?: AbortSignal,
): Promise<{ proposal: MechanismProposal; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: CONSTRUCTION_COVERAGE_MODEL,
      max_tokens: CONSTRUCTION_COVERAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: PROPOSAL_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildProposalUserPrompt(input) }],
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: 'tool' as const, name: PROPOSAL_TOOL_NAME },
      temperature: CONSTRUCTION_COVERAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`proposeMechanism: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { proposal: parseMechanismProposal(toolUse.input), usage: response.usage };
}
