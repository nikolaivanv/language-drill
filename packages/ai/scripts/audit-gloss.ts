/**
 * packages/ai — audit:gloss CLI. Measures gloss spoilage in the approved cloze
 * pool: an English `glossEn` is meant to disambiguate meaning while leaving the
 * grammar to the learner, but some rows state the rule outright (a parenthetical
 * like "(a current condition)" handing over `está`). Judging all 1,568 approved
 * glossed rows with an LLM is expensive, so this file's `selectRowsToJudge`
 * narrows the judged set to rows an English speaker could actually spoil.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 *
 * Usage:
 *   pnpm audit:gloss --dry-run
 *   pnpm audit:gloss --language ES --cefr A1 --max-cost-usd 2
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { ExerciseType } from '@language-drill/shared';
import { createDb, exercises, getGrammarPoint, requireEnv } from '@language-drill/db';
import type Anthropic from '@anthropic-ai/sdk';

import {
  createClaudeClient,
  triageGlossPoint,
  judgeGlossRow,
  GLOSS_SPOILAGE_MODEL,
  GLOSS_SPOILAGE_PROMPT_VERSION,
  type PointTriageVerdict,
  type GlossVerdict,
} from '../src/index.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.join(SCRIPT_DIR, 'fixtures', 'gloss-spoilage-cases.json');

export type AuditGlossFilters = {
  language?: string;
  cefr?: string;
  grammarPoint?: string;
  limit?: number;
  maxCostUsd?: number;
  out?: string;
  dryRun: boolean;
  checkFixture: boolean;
};

export function parseAuditGlossArgs(argv: string[]): AuditGlossFilters {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      'grammar-point': { type: 'string' },
      limit: { type: 'string' },
      'max-cost-usd': { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'check-fixture': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:gloss [--language ES] [--cefr A1] [--grammar-point <key>]\n' +
        '                   [--limit N] [--max-cost-usd 2] [--out <path>] [--dry-run] [--check-fixture]',
    );
    process.exit(0);
  }

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer, got '${values.limit}'`);
    }
  }

  let maxCostUsd: number | undefined;
  if (values['max-cost-usd'] !== undefined) {
    maxCostUsd = Number(values['max-cost-usd']);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new Error(`--max-cost-usd must be positive, got '${values['max-cost-usd']}'`);
    }
  }

  return {
    // Uppercased so `--language es` works: the pool stores 'ES' / 'A1'. Same
    // footgun as audit-collapse.ts and qa-sample-run.ts — lowercase silently
    // matches zero rows and looks like an empty pool, not a typo.
    language: values.language?.toUpperCase(),
    cefr: values.cefr?.toUpperCase(),
    grammarPoint: values['grammar-point'],
    limit,
    maxCostUsd,
    out: values.out,
    dryRun: values['dry-run'] ?? false,
    checkFixture: values['check-fixture'] ?? false,
  };
}

/** Non-greedy per-span match: `[^)]*` excludes `)` from the content, so a string
 *  with multiple parentheticals yields one match per `(...)` pair instead of one
 *  greedy span running from the first `(` to the last `)`. An unclosed `(` never
 *  matches, since there is no `)` to close it. */
const PARENTHETICAL_RE = /\([^)]*\)/g;

export function hasParenthetical(gloss: string): boolean {
  // A fresh non-global test avoids the /g flag's stateful lastIndex entirely —
  // .match() below reads the whole string in one pass and needs /g, but a
  // single true/false check doesn't, so use a plain (non-stateful) regex.
  return /\([^)]*\)/.test(gloss);
}

export function extractParentheticals(gloss: string): string[] {
  return gloss.match(PARENTHETICAL_RE) ?? [];
}

export type GlossRow = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  acceptableAnswers: string[] | null;
  instructions: string;
  glossEn: string;
};

/**
 * The two-signal rule: keep a row if EITHER signal says it might leak.
 *
 *   1. Point-level — the point's triage verdict is `true` (English marks the
 *      distinction this point tests, e.g. demonstratives), so every gloss in
 *      the point is a candidate leak.
 *   2. Row-level — the row's own gloss carries a parenthetical, REGARDLESS of
 *      the point's verdict. This is what catches "(a current condition)" on a
 *      ser/estar blank: English "is" hides ser/estar, so that point verdicts
 *      `false` and would otherwise be skipped wholesale — yet this one row
 *      states the rule outright anyway. Point-level filtering alone misses it.
 *
 * A point with NO verdict (unknown key, or triage failed/errored) is never
 * silently excluded — an API error must not turn into invisible missing
 * coverage, so every row of an unverdicted point is judged.
 *
 * Each row is returned at most once even when both signals apply.
 */
export function selectRowsToJudge(
  rows: readonly GlossRow[],
  pointVerdicts: ReadonlyMap<string, boolean>,
): GlossRow[] {
  const out: GlossRow[] = [];
  for (const row of rows) {
    const verdict = pointVerdicts.get(row.grammarPointKey);
    const pointLeaks = verdict === undefined || verdict === true;
    if (pointLeaks || hasParenthetical(row.glossEn)) {
      out.push(row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading — read-only. Mirrors audit-collapse.ts's loadApprovedRows shape.
// ---------------------------------------------------------------------------

type LoadedRow = {
  id: string;
  grammarPointKey: string | null;
  language: string | null;
  difficulty: string | null;
  contentJson: Record<string, unknown> | null;
};

/**
 * Select approved cloze rows carrying a non-empty `glossEn`, honouring the
 * CLI filters. Read-only. A row is skipped (and counted) when
 * `contentJson.glossEn` is present-per-the-`?`-operator but not a non-empty
 * string, or when the row is missing a grammar point / language / level —
 * both are edge cases the approved-pool invariants should prevent, but a
 * defensive skip beats a crash on one malformed row.
 */
export async function loadGlossedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditGlossFilters,
): Promise<{ rows: GlossRow[]; skippedNoGloss: number }> {
  const conditions = [
    eq(exercises.type, ExerciseType.CLOZE),
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    sql`${exercises.contentJson} ? 'glossEn'`,
    ...(filters.language ? [eq(exercises.language, filters.language)] : []),
    ...(filters.cefr ? [eq(exercises.difficulty, filters.cefr)] : []),
    ...(filters.grammarPoint ? [eq(exercises.grammarPointKey, filters.grammarPoint)] : []),
  ];

  const raw = (await db
    .select({
      id: exercises.id,
      grammarPointKey: exercises.grammarPointKey,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conditions))) as LoadedRow[];

  const rows: GlossRow[] = [];
  let skippedNoGloss = 0;
  for (const r of raw) {
    if (!r.grammarPointKey || !r.language || !r.difficulty) {
      skippedNoGloss++;
      continue;
    }
    const content = r.contentJson ?? {};
    const glossEn = content.glossEn;
    if (typeof glossEn !== 'string' || glossEn.trim().length === 0) {
      skippedNoGloss++;
      continue;
    }
    const acceptableAnswersRaw = content.acceptableAnswers;
    rows.push({
      id: r.id,
      grammarPointKey: r.grammarPointKey,
      language: r.language,
      cefrLevel: r.difficulty,
      sentence: typeof content.sentence === 'string' ? content.sentence : '',
      correctAnswer: typeof content.correctAnswer === 'string' ? content.correctAnswer : '',
      acceptableAnswers: Array.isArray(acceptableAnswersRaw)
        ? acceptableAnswersRaw.filter((a): a is string => typeof a === 'string')
        : null,
      instructions: typeof content.instructions === 'string' ? content.instructions : '',
      glossEn,
    });
  }
  return { rows, skippedNoGloss };
}

function groupByPoint(rows: readonly GlossRow[]): Map<string, GlossRow[]> {
  const groups = new Map<string, GlossRow[]>();
  for (const row of rows) {
    const list = groups.get(row.grammarPointKey);
    if (list) list.push(row);
    else groups.set(row.grammarPointKey, [row]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Cost accounting — same Sonnet per-MTok pricing audit-collapse.ts uses.
// ---------------------------------------------------------------------------

const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;

// parseAuditGlossArgs (Task 3, pinned by tests) leaves --max-cost-usd
// undefined when the flag is omitted — it carries no default of its own.
// `costUsd >= undefined` is always false, so an unresolved undefined here
// would make the cap silently never fire. Apply the same $2 default
// audit-collapse.ts's CLI default uses.
const DEFAULT_MAX_COST_USD = 2;

export function estimateCallCostUsd(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

function roughCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

// Rough token counts for the --dry-run estimate only (no call is made to
// measure these). System prompts are cache-marked, so a real run's actual
// cost trends well below this per-call estimate after the first call in each
// phase — this is a conservative, not-cached, upper bound per call.
const ESTIMATED_POINT_TRIAGE_INPUT_TOKENS = 650;
const ESTIMATED_POINT_TRIAGE_OUTPUT_TOKENS = 80;
const ESTIMATED_ROW_JUDGE_INPUT_TOKENS = 1050;
const ESTIMATED_ROW_JUDGE_OUTPUT_TOKENS = 100;
const ESTIMATED_POINT_TRIAGE_COST_USD = roughCostUsd(
  ESTIMATED_POINT_TRIAGE_INPUT_TOKENS,
  ESTIMATED_POINT_TRIAGE_OUTPUT_TOKENS,
);
const ESTIMATED_ROW_JUDGE_COST_USD = roughCostUsd(
  ESTIMATED_ROW_JUDGE_INPUT_TOKENS,
  ESTIMATED_ROW_JUDGE_OUTPUT_TOKENS,
);

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export type PointTriageReportEntry = {
  grammarPointKey: string;
  grammarPointName: string;
  rowCount: number;
  verdict: PointTriageVerdict | null;
  /** Non-null when triage threw, the point key is unknown to the curriculum,
   *  or the run's cost cap skipped this point. In every case `verdict` stays
   *  null, which `selectRowsToJudge` reads as "judge every row of this
   *  point" — an error here must never read as an exclusion. */
  error: string | null;
  /** true only when triage SUCCEEDED and said English does not mark the
   *  distinction. An error or a cap never sets this true. */
  excluded: boolean;
};

export type GlossFinding = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  glossEn: string;
  verdict: GlossVerdict['verdict'];
  offendingSpan: string | null;
  proposedGloss: string | null;
  loadBearing: boolean;
  reasoning: string;
  confidence: GlossVerdict['confidence'];
};

export type GlossAuditReport = {
  meta: {
    name: string;
    filters: AuditGlossFilters;
    model: string;
    promptVersion: string;
    costUsd: number;
    costCapped: boolean;
    timestamp: string;
    rowsScanned: number;
    rowsSkippedNoGloss: number;
    pointsTotal: number;
    pointsExcluded: number;
    rowsJudged: number;
  };
  pointTriage: PointTriageReportEntry[];
  findings: GlossFinding[];
  errors: string[];
};

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderGlossMarkdown(report: GlossAuditReport): string {
  const { meta, pointTriage, findings, errors } = report;
  const spoiled = findings.filter((f) => f.verdict === 'spoiled');
  const borderline = findings.filter((f) => f.verdict === 'borderline');
  const legitimate = findings.filter((f) => f.verdict === 'legitimate');
  const loadBearing = spoiled.filter((f) => f.loadBearing);
  const scriptable = spoiled.filter((f) => !f.loadBearing);
  const excludedPoints = pointTriage.filter((p) => p.excluded);

  const out: string[] = [
    `# Gloss spoilage audit — ${meta.name}`,
    '',
    `Model: \`${meta.model}\` · Prompt version: \`${meta.promptVersion}\` · Run: ${meta.timestamp}`,
    '',
    '## Summary',
    '',
    `- Rows scanned (approved cloze rows carrying a gloss): **${meta.rowsScanned}**`,
    `- Rows skipped (no usable \`glossEn\`): **${meta.rowsSkippedNoGloss}**`,
    `- Grammar points seen: **${meta.pointsTotal}**`,
    `- Points excluded by triage (English does not mark the tested distinction): **${meta.pointsExcluded}**`,
    `- Rows judged: **${meta.rowsJudged}**`,
    `- Spoiled: **${spoiled.length}** (${scriptable.length} scriptable, ${loadBearing.length} load-bearing)`,
    `- Borderline: **${borderline.length}**`,
    `- Legitimate: **${legitimate.length}**`,
    `- Estimated cost: **$${meta.costUsd.toFixed(2)}**${
      meta.costCapped ? ' — **RUN WAS COST-CAPPED, coverage is incomplete; see Errors**' : ''
    }`,
    `- Errors: **${errors.length}**`,
    '',
  ];

  if (findings.length === 0 && errors.length === 0 && pointTriage.length === 0) {
    out.push('No glossed rows matched the filters. Nothing to act on.', '');
  }

  if (excludedPoints.length > 0) {
    out.push(
      '## Points excluded from row judging',
      '',
      "English does not mark the distinction this point's blanks test, so no gloss in the point can leak the tested contrast on its own. A parenthetical can still separately leak something else — those rows are judged regardless of this exclusion (see the spoiled-rows table below).",
      '',
      '| Point | Rows | Confidence | Reasoning |',
      '|---|---|---|---|',
    );
    for (const p of excludedPoints) {
      out.push(
        `| \`${p.grammarPointKey}\` | ${p.rowCount} | ${p.verdict?.confidence ?? '—'} | ${mdEscape(p.verdict?.reasoning ?? '—')} |`,
      );
    }
    out.push('');
  }

  if (scriptable.length > 0) {
    out.push(
      '## Spoiled rows — repair by editing the gloss',
      '',
      'The offending span can be removed or replaced without making the blank ambiguous; a repair can be scripted straight from this table.',
      '',
      '| id | point | lang/level | offending span | proposed gloss | confidence |',
      '|---|---|---|---|---|---|',
    );
    for (const f of scriptable) {
      out.push(
        `| \`${f.id}\` | \`${f.grammarPointKey}\` | ${f.language}/${f.cefrLevel} | ${mdEscape(f.offendingSpan ?? '')} | ${mdEscape(f.proposedGloss ?? '(drop gloss)')} | ${f.confidence} |`,
      );
    }
    out.push('');
  }

  if (loadBearing.length > 0) {
    out.push(
      '## Load-bearing spoilers — authoring work, not data edits',
      '',
      'The offending span is the only thing forcing the intended reading here. Deleting it (instead of rewriting the sentence) would trade a spoiled exercise for an ambiguous one — these need a human to rewrite the sentence/gloss together, not a scripted trim.',
      '',
      '| id | point | lang/level | sentence | offending span | proposed gloss | reasoning |',
      '|---|---|---|---|---|---|---|',
    );
    for (const f of loadBearing) {
      out.push(
        `| \`${f.id}\` | \`${f.grammarPointKey}\` | ${f.language}/${f.cefrLevel} | ${mdEscape(f.sentence)} | ${mdEscape(f.offendingSpan ?? '')} | ${mdEscape(f.proposedGloss ?? '')} | ${mdEscape(f.reasoning)} |`,
      );
    }
    out.push('');
  }

  if (borderline.length > 0) {
    out.push(
      '## Borderline — needs a human call',
      '',
      '| id | point | lang/level | gloss | reasoning |',
      '|---|---|---|---|---|',
    );
    for (const f of borderline) {
      out.push(
        `| \`${f.id}\` | \`${f.grammarPointKey}\` | ${f.language}/${f.cefrLevel} | ${mdEscape(f.glossEn)} | ${mdEscape(f.reasoning)} |`,
      );
    }
    out.push('');
  }

  if (errors.length > 0) {
    out.push('## Errors', '', ...errors.map((e) => `- ${e}`), '');
  }

  return out.join('\n');
}

function printDryRunEstimate(rows: readonly GlossRow[], pointGroups: Map<string, GlossRow[]>): void {
  const pointsCount = pointGroups.size;
  const floorRowsJudged = rows.filter((r) => hasParenthetical(r.glossEn)).length;
  const ceilingRowsJudged = rows.length;
  const floorCost =
    pointsCount * ESTIMATED_POINT_TRIAGE_COST_USD + floorRowsJudged * ESTIMATED_ROW_JUDGE_COST_USD;
  const ceilingCost =
    pointsCount * ESTIMATED_POINT_TRIAGE_COST_USD + ceilingRowsJudged * ESTIMATED_ROW_JUDGE_COST_USD;

  console.log('[audit-gloss] --dry-run: no API calls made, no report file written.');
  console.log(`[audit-gloss] rows scanned: ${rows.length}`);
  console.log(`[audit-gloss] distinct grammar points (1 triage call each): ${pointsCount}`);
  console.log(
    `[audit-gloss] rows that WILL be judged regardless of triage (carry a parenthetical): ${floorRowsJudged}`,
  );
  console.log(
    `[audit-gloss] rows that MAY be judged in the worst case (no point gets excluded): ${ceilingRowsJudged}`,
  );
  console.log(
    `[audit-gloss] rough estimated cost: $${floorCost.toFixed(2)}–$${ceilingCost.toFixed(2)} ` +
      `(${pointsCount} point-triage calls + ${floorRowsJudged}–${ceilingRowsJudged} row-judge calls; ` +
      'the true figure lands near the low end once triage excludes points where English does not mark the distinction)',
  );
}

// ---------------------------------------------------------------------------
// --check-fixture — precision/recall gate over 10 known-answer prod rows.
// Skips the database entirely. See docs/superpowers/sdd/2026-08-12-
// gloss-spoilage-audit/task-5-brief.md: this is the run that decides whether
// any verdict from this tool can be trusted.
// ---------------------------------------------------------------------------

/** Three draws because the judge is a nondeterministic LLM call — a single
 *  draw near a decision boundary proves nothing (see
 *  docs/analysis/qa-sample-findings-2026-08-11.md, where a one-draw verdict
 *  was later reversed by an n=10 replay). */
export const FIXTURE_DRAWS_PER_CASE = 3;

export type FixtureCase = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  instructions: string;
  glossEn: string;
  expected: 'spoiled' | 'legitimate';
  /** true for a row genuinely held out from GLOSS_ROW_SYSTEM_PROMPT's own
   *  worked examples — the only set that can serve as the gate. false marks
   *  the original 10 cases, which were later found to have their glossEn or
   *  offending span embedded verbatim in the prompt (see the fixture's
   *  top-level `description`): scoring them measures whether the judge can
   *  repeat its own instructions, not whether it generalises. Kept as a
   *  cheap regression guard only — never reported as evidence the judge
   *  works. */
  heldOut: boolean;
  note: string;
};

const FIXTURE_CASE_STRING_FIELDS = [
  'id',
  'grammarPointKey',
  'language',
  'cefrLevel',
  'sentence',
  'correctAnswer',
  'instructions',
  'glossEn',
  'expected',
  'note',
] as const;

/** Reads and structurally validates the fixture. Throws on malformed input —
 *  a bad fixture must fail loudly, not silently score a shorter set. */
export function loadFixtureCases(fixturePath: string): FixtureCase[] {
  const parsed = JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases?: unknown };
  if (!Array.isArray(parsed.cases)) {
    throw new Error(`fixture at ${fixturePath} is missing a 'cases' array`);
  }
  return parsed.cases.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`fixture case ${i} is not an object`);
    }
    const obj = raw as Record<string, unknown>;
    for (const field of FIXTURE_CASE_STRING_FIELDS) {
      if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
        throw new Error(
          `fixture case ${i} (${String(obj.id ?? '?')}) missing non-empty string field '${field}'`,
        );
      }
    }
    const expected = obj.expected as string;
    if (expected !== 'spoiled' && expected !== 'legitimate') {
      throw new Error(`fixture case ${i} (${String(obj.id)}) has unknown expected '${expected}'`);
    }
    if (typeof obj.heldOut !== 'boolean') {
      throw new Error(
        `fixture case ${i} (${String(obj.id)}) missing boolean field 'heldOut' — every case must ` +
          'explicitly declare whether it is genuinely held out from the judge prompt',
      );
    }
    return {
      id: obj.id as string,
      grammarPointKey: obj.grammarPointKey as string,
      language: obj.language as string,
      cefrLevel: obj.cefrLevel as string,
      sentence: obj.sentence as string,
      correctAnswer: obj.correctAnswer as string,
      instructions: obj.instructions as string,
      glossEn: obj.glossEn as string,
      expected,
      heldOut: obj.heldOut,
      note: obj.note as string,
    };
  });
}

export type FixtureDraw =
  | {
      ok: true;
      verdict: GlossVerdict['verdict'];
      offendingSpan: string | null;
      proposedGloss: string | null;
      loadBearing: boolean;
      reasoning: string;
      confidence: GlossVerdict['confidence'];
    }
  | { ok: false; error: string };

export type FixtureCaseResult = {
  id: string;
  grammarPointKey: string;
  expected: 'spoiled' | 'legitimate';
  /** Passed through from `FixtureCase.heldOut` so a result can be scored and
   *  reported as part of the gate set or the contaminated regression set
   *  without needing a separate case lookup. */
  heldOut: boolean;
  note: string;
  draws: FixtureDraw[];
  spoiledCount: number;
  legitimateCount: number;
  borderlineCount: number;
  errorCount: number;
  /** The verdict a strict majority (2 of 3) of successful draws agree on, or
   *  'no-majority' when no single verdict clears that bar (including when
   *  every draw errored). `borderline` can win a majority — that is
   *  deliberate: a judge that hedges on a known spoiler has not caught it,
   *  and reporting `borderline` as the majority (rather than folding it into
   *  `legitimate`) surfaces the hedge instead of hiding it. */
  majorityVerdict: GlossVerdict['verdict'] | 'no-majority';
  /** true only when the majority verdict matches what this case requires:
   *  'spoiled' for a known spoiler, 'legitimate' for a known-legitimate row.
   *  A majority of 'borderline' counts as NOT caught for a spoiler. */
  caughtCorrectly: boolean;
};

export type FixtureUnresolvedCase = {
  id: string;
  grammarPointKey: string;
  error: string;
};

/** Strict majority (>50%) of the successful draws; ties and all-error cases
 *  are reported as 'no-majority' rather than guessed at. */
export function computeMajorityVerdict(
  verdicts: readonly GlossVerdict['verdict'][],
): GlossVerdict['verdict'] | 'no-majority' {
  if (verdicts.length === 0) return 'no-majority';
  const counts: Record<GlossVerdict['verdict'], number> = {
    spoiled: 0,
    legitimate: 0,
    borderline: 0,
  };
  for (const v of verdicts) counts[v]++;
  const entries = Object.entries(counts) as [GlossVerdict['verdict'], number][];
  const max = Math.max(...entries.map(([, c]) => c));
  const top = entries.filter(([, c]) => c === max);
  if (top.length !== 1 || max * 2 <= verdicts.length) return 'no-majority';
  return top[0][0];
}

export function buildFixtureCaseResult(
  fixtureCase: FixtureCase,
  draws: FixtureDraw[],
): FixtureCaseResult {
  const okDraws = draws.filter((d): d is Extract<FixtureDraw, { ok: true }> => d.ok);
  const verdictList = okDraws.map((d) => d.verdict);
  const spoiledCount = verdictList.filter((v) => v === 'spoiled').length;
  const legitimateCount = verdictList.filter((v) => v === 'legitimate').length;
  const borderlineCount = verdictList.filter((v) => v === 'borderline').length;
  const errorCount = draws.length - okDraws.length;
  const majorityVerdict = computeMajorityVerdict(verdictList);
  const caughtCorrectly =
    fixtureCase.expected === 'spoiled'
      ? majorityVerdict === 'spoiled'
      : majorityVerdict === 'legitimate';

  return {
    id: fixtureCase.id,
    grammarPointKey: fixtureCase.grammarPointKey,
    expected: fixtureCase.expected,
    heldOut: fixtureCase.heldOut,
    note: fixtureCase.note,
    draws,
    spoiledCount,
    legitimateCount,
    borderlineCount,
    errorCount,
    majorityVerdict,
    caughtCorrectly,
  };
}

export type FixtureScore = {
  /** null when no case's majority came out 'spoiled' — precision is
   *  undefined, not zero, with no positive predictions to be wrong about. */
  precision: number | null;
  /** null only if the fixture carries zero known spoilers (never true for
   *  the shipped fixture, but kept honest for a hypothetical smaller one). */
  recall: number | null;
  truePositives: FixtureCaseResult[];
  /** Known-legitimate rows whose majority came out 'spoiled' — the dangerous
   *  direction: acting on this would trim a gloss doing real disambiguation
   *  work. */
  falsePositives: FixtureCaseResult[];
  /** Known spoilers whose majority did NOT come out 'spoiled' (legitimate,
   *  borderline, or no-majority all count as a miss here). */
  falseNegatives: FixtureCaseResult[];
  /** Required gate: every case's majority verdict matches its expected
   *  label. */
  gatePassed: boolean;
};

export function scoreFixtureResults(results: readonly FixtureCaseResult[]): FixtureScore {
  const truePositives = results.filter(
    (r) => r.expected === 'spoiled' && r.majorityVerdict === 'spoiled',
  );
  const falsePositives = results.filter(
    (r) => r.expected === 'legitimate' && r.majorityVerdict === 'spoiled',
  );
  const falseNegatives = results.filter(
    (r) => r.expected === 'spoiled' && r.majorityVerdict !== 'spoiled',
  );
  const predictedSpoiledCount = truePositives.length + falsePositives.length;
  const actualSpoiledCount = results.filter((r) => r.expected === 'spoiled').length;

  return {
    precision: predictedSpoiledCount === 0 ? null : truePositives.length / predictedSpoiledCount,
    recall: actualSpoiledCount === 0 ? null : truePositives.length / actualSpoiledCount,
    truePositives,
    falsePositives,
    falseNegatives,
    gatePassed: results.length > 0 && results.every((r) => r.caughtCorrectly),
  };
}

/**
 * Runs `judgeGlossRow` `drawsPerCase` times per fixture case. A case whose
 * `grammarPointKey` fails to resolve is reported in `unresolved`, never
 * substituted with a different point. Honors `maxCostUsd` mid-run — once hit,
 * remaining draws are recorded as skipped (not silently omitted) so every
 * case still gets a result with an accurate error/skip count.
 */
export async function runFixtureCheck(
  client: Anthropic,
  cases: readonly FixtureCase[],
  drawsPerCase: number,
  maxCostUsd: number,
): Promise<{
  results: FixtureCaseResult[];
  unresolved: FixtureUnresolvedCase[];
  costUsd: number;
  costCapped: boolean;
}> {
  const results: FixtureCaseResult[] = [];
  const unresolved: FixtureUnresolvedCase[] = [];
  let costUsd = 0;
  let costCapped = false;

  for (const fixtureCase of cases) {
    const gp = getGrammarPoint(fixtureCase.grammarPointKey);
    if (!gp) {
      unresolved.push({
        id: fixtureCase.id,
        grammarPointKey: fixtureCase.grammarPointKey,
        error: `grammar point key '${fixtureCase.grammarPointKey}' not found in the live curriculum`,
      });
      continue;
    }

    const draws: FixtureDraw[] = [];
    for (let i = 0; i < drawsPerCase; i++) {
      if (costUsd >= maxCostUsd) {
        costCapped = true;
        draws.push({ ok: false, error: `skipped — run hit --max-cost-usd ${maxCostUsd}` });
        continue;
      }
      try {
        const { verdict, usage } = await judgeGlossRow(client, {
          grammarPoint: gp,
          language: fixtureCase.language,
          cefrLevel: fixtureCase.cefrLevel,
          sentence: fixtureCase.sentence,
          correctAnswer: fixtureCase.correctAnswer,
          acceptableAnswers: null,
          instructions: fixtureCase.instructions,
          glossEn: fixtureCase.glossEn,
        });
        costUsd += estimateCallCostUsd(usage);
        draws.push({
          ok: true,
          verdict: verdict.verdict,
          offendingSpan: verdict.offendingSpan,
          proposedGloss: verdict.proposedGloss,
          loadBearing: verdict.loadBearing,
          reasoning: verdict.reasoning,
          confidence: verdict.confidence,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        draws.push({ ok: false, error: message });
      }
    }

    results.push(buildFixtureCaseResult(fixtureCase, draws));
  }

  return { results, unresolved, costUsd, costCapped };
}

function printFixtureCaseDraws(r: FixtureCaseResult): void {
  console.log('');
  console.log(`${r.id}  (${r.grammarPointKey})  expected: ${r.expected}`);
  r.draws.forEach((d, i) => {
    if (d.ok) {
      const spanNote = d.verdict === 'spoiled' ? ` | offendingSpan: "${d.offendingSpan}"` : '';
      console.log(`  draw ${i + 1}: ${d.verdict} (confidence: ${d.confidence})${spanNote}`);
      console.log(`    reasoning: ${d.reasoning}`);
    } else {
      console.log(`  draw ${i + 1}: ERROR — ${d.error}`);
    }
  });
  console.log(
    `  tally: spoiled=${r.spoiledCount} legitimate=${r.legitimateCount} ` +
      `borderline=${r.borderlineCount} error=${r.errorCount} → majority: ${r.majorityVerdict} ` +
      (r.caughtCorrectly ? '(correct)' : '(WRONG)'),
  );
}

function printFixtureScoreSummary(label: string, score: FixtureScore): void {
  console.log(`  ${label} precision: ${score.precision === null ? 'n/a' : score.precision.toFixed(2)}`);
  console.log(`  ${label} recall: ${score.recall === null ? 'n/a' : score.recall.toFixed(2)}`);
  if (score.falsePositives.length > 0) {
    console.log(
      `  ${label} FALSE POSITIVES — legitimate rows flagged spoiled on a majority (the dangerous direction):`,
    );
    for (const fp of score.falsePositives) {
      console.log(`    - ${fp.id} (${fp.grammarPointKey})`);
    }
  }
  if (score.falseNegatives.length > 0) {
    console.log(`  ${label} MISSED SPOILERS — known spoiler not caught on a majority:`);
    for (const fn of score.falseNegatives) {
      console.log(`    - ${fn.id} (${fn.grammarPointKey}): majority verdict = ${fn.majorityVerdict}`);
    }
  }
}

/**
 * Prints per-case draws and the summary for BOTH sets, with the held-out set
 * clearly marked as the gate and the contaminated set clearly marked as NOT
 * evidence of generalisation (see `FixtureCase.heldOut` doc comment — the
 * contaminated 10 have their glossEn or offending span embedded verbatim in
 * GLOSS_ROW_SYSTEM_PROMPT, so scoring them only measures whether the judge
 * can repeat its own instructions).
 */
function printFixtureCheckReport(
  heldOutResults: readonly FixtureCaseResult[],
  heldOutScore: FixtureScore,
  contaminatedResults: readonly FixtureCaseResult[],
  contaminatedScore: FixtureScore,
  unresolved: readonly FixtureUnresolvedCase[],
  costUsd: number,
  costCapped: boolean,
): void {
  console.log('');
  console.log(
    '[audit-gloss] === --check-fixture: HELD-OUT set — THE GATE (spans verified absent from the judge prompt) ===',
  );
  for (const r of heldOutResults) printFixtureCaseDraws(r);

  console.log('');
  console.log(
    '[audit-gloss] === --check-fixture: CONTAMINATED set — regression guard ONLY, NOT evidence of generalisation ===',
  );
  console.log(
    '[audit-gloss] (every case below has its glossEn or offending span embedded verbatim in GLOSS_ROW_SYSTEM_PROMPT as a worked example)',
  );
  for (const r of contaminatedResults) printFixtureCaseDraws(r);

  if (unresolved.length > 0) {
    console.log('');
    console.log(
      '[audit-gloss] UNRESOLVED cases (grammar point key not found in the live curriculum — reported, not substituted):',
    );
    for (const u of unresolved) {
      console.log(`  - ${u.id} (${u.grammarPointKey}): ${u.error}`);
    }
  }

  console.log('');
  console.log('[audit-gloss] === --check-fixture: summary ===');
  console.log('  --- HELD-OUT (the gate) ---');
  printFixtureScoreSummary('held-out', heldOutScore);
  console.log(
    `  held-out gate ${heldOutScore.gatePassed ? 'PASSED' : 'FAILED'}: all known spoilers majority-'spoiled' AND all known-legitimate rows majority-'legitimate', on the held-out set`,
  );
  console.log('  --- CONTAMINATED (regression guard only — NOT evidence of generalisation) ---');
  printFixtureScoreSummary('contaminated', contaminatedScore);
  console.log(`  cost: $${costUsd.toFixed(2)}${costCapped ? ' (CAPPED — run incomplete, see draws above)' : ''}`);
}

async function runCheckFixtureMode(filters: AuditGlossFilters): Promise<void> {
  console.log(
    '[audit-gloss] --check-fixture: skipping the database, reading scripts/fixtures/gloss-spoilage-cases.json',
  );
  const cases = loadFixtureCases(DEFAULT_FIXTURE_PATH);
  const heldOutCases = cases.filter((c) => c.heldOut);
  const contaminatedCases = cases.filter((c) => !c.heldOut);
  console.log(
    `[audit-gloss] loaded ${cases.length} fixture cases (${heldOutCases.length} held-out — the gate, ` +
      `${contaminatedCases.length} contaminated — regression guard only); running ${FIXTURE_DRAWS_PER_CASE} draws ` +
      `each (${cases.length * FIXTURE_DRAWS_PER_CASE} calls)…`,
  );

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const maxCostUsd = filters.maxCostUsd ?? DEFAULT_MAX_COST_USD;

  const { results, unresolved, costUsd, costCapped } = await runFixtureCheck(
    client,
    cases,
    FIXTURE_DRAWS_PER_CASE,
    maxCostUsd,
  );
  const heldOutResults = results.filter((r) => r.heldOut);
  const contaminatedResults = results.filter((r) => !r.heldOut);
  const heldOutScore = scoreFixtureResults(heldOutResults);
  const contaminatedScore = scoreFixtureResults(contaminatedResults);
  printFixtureCheckReport(
    heldOutResults,
    heldOutScore,
    contaminatedResults,
    contaminatedScore,
    unresolved,
    costUsd,
    costCapped,
  );

  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  const name = filters.out ?? 'gloss-fixture-check';
  const jsonPath = path.join(outDir, `${name}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        meta: {
          model: GLOSS_SPOILAGE_MODEL,
          promptVersion: GLOSS_SPOILAGE_PROMPT_VERSION,
          drawsPerCase: FIXTURE_DRAWS_PER_CASE,
          costUsd,
          costCapped,
          timestamp: new Date().toISOString(),
          casesTotal: cases.length,
          casesResolved: results.length,
          gate: 'heldOutScore — see below; contaminatedScore is a regression guard only, not evidence of generalisation',
        },
        heldOut: { results: heldOutResults, score: heldOutScore },
        contaminated: { results: contaminatedResults, score: contaminatedScore },
        unresolved,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`[audit-gloss] wrote ${jsonPath}`);
}

async function main(): Promise<void> {
  const filters = parseAuditGlossArgs(process.argv.slice(2));

  if (filters.checkFixture) {
    await runCheckFixtureMode(filters);
    return;
  }

  const db = createDb(requireEnv('DATABASE_URL'));

  console.log('[audit-gloss] loading approved glossed cloze rows…');
  const { rows, skippedNoGloss } = await loadGlossedRows(db, filters);
  const limitedRows = filters.limit !== undefined ? rows.slice(0, filters.limit) : rows;
  console.log(
    `[audit-gloss] ${limitedRows.length} rows loaded (${skippedNoGloss} skipped: no usable glossEn)` +
      (filters.limit !== undefined ? ` [--limit ${filters.limit}, ${rows.length} matched before limit]` : ''),
  );

  const pointGroups = groupByPoint(limitedRows);

  if (filters.dryRun) {
    printDryRunEstimate(limitedRows, pointGroups);
    return;
  }

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const maxCostUsd = filters.maxCostUsd ?? DEFAULT_MAX_COST_USD;

  let costUsd = 0;
  let costCapped = false;
  const pointVerdicts = new Map<string, boolean>();
  const pointTriage: PointTriageReportEntry[] = [];
  const errors: string[] = [];

  const pointEntries = [...pointGroups.entries()];
  console.log(`[audit-gloss] triaging ${pointEntries.length} points…`);
  for (let i = 0; i < pointEntries.length; i++) {
    const [pointKey, pointRows] = pointEntries[i];

    if (costUsd >= maxCostUsd) {
      costCapped = true;
      const remaining = pointEntries.slice(i);
      errors.push(
        `${remaining.length} point(s) skipped triage — run hit --max-cost-usd ${maxCostUsd}, starting at '${pointKey}'`,
      );
      for (const [pk, pr] of remaining) {
        pointTriage.push({
          grammarPointKey: pk,
          grammarPointName: getGrammarPoint(pk)?.name ?? '(unknown — not in curriculum)',
          rowCount: pr.length,
          verdict: null,
          error: `skipped — run hit --max-cost-usd ${maxCostUsd}`,
          excluded: false,
        });
      }
      break;
    }

    const gp = getGrammarPoint(pointKey);
    if (!gp) {
      pointTriage.push({
        grammarPointKey: pointKey,
        grammarPointName: '(unknown — not in curriculum)',
        rowCount: pointRows.length,
        verdict: null,
        error: 'grammar point key not found in the live curriculum; all its rows will be judged',
        excluded: false,
      });
      continue;
    }

    const sampleGlosses = pointRows.slice(0, 3).map((r) => r.glossEn);
    try {
      const { verdict, usage } = await triageGlossPoint(client, {
        grammarPoint: gp,
        language: pointRows[0].language,
        cefrLevel: pointRows[0].cefrLevel,
        sampleGlosses,
      });
      costUsd += estimateCallCostUsd(usage);
      pointVerdicts.set(pointKey, verdict.englishEncodesDistinction);
      pointTriage.push({
        grammarPointKey: pointKey,
        grammarPointName: gp.name,
        rowCount: pointRows.length,
        verdict,
        error: null,
        excluded: !verdict.englishEncodesDistinction,
      });
    } catch (err) {
      // A triage FAILURE must leave this point with NO verdict — never
      // silently exclude its rows because the API call errored.
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`point ${pointKey}: triage failed — ${message}`);
      pointTriage.push({
        grammarPointKey: pointKey,
        grammarPointName: gp.name,
        rowCount: pointRows.length,
        verdict: null,
        error: message,
        excluded: false,
      });
    }
  }

  const toJudge = selectRowsToJudge(limitedRows, pointVerdicts);
  console.log(`[audit-gloss] judging ${toJudge.length} of ${limitedRows.length} rows…`);

  const findings: GlossFinding[] = [];
  for (let i = 0; i < toJudge.length; i++) {
    const row = toJudge[i];

    if (costUsd >= maxCostUsd) {
      costCapped = true;
      const remaining = toJudge.length - i;
      errors.push(
        `${remaining} row(s) skipped judging — run hit --max-cost-usd ${maxCostUsd}, starting at '${row.id}'`,
      );
      break;
    }

    const gp = getGrammarPoint(row.grammarPointKey);
    if (!gp) {
      errors.push(`row ${row.id}: grammar point '${row.grammarPointKey}' not found in curriculum; skipped`);
      continue;
    }

    try {
      const { verdict, usage } = await judgeGlossRow(client, {
        grammarPoint: gp,
        language: row.language,
        cefrLevel: row.cefrLevel,
        sentence: row.sentence,
        correctAnswer: row.correctAnswer,
        acceptableAnswers: row.acceptableAnswers,
        instructions: row.instructions,
        glossEn: row.glossEn,
      });
      costUsd += estimateCallCostUsd(usage);
      findings.push({
        id: row.id,
        grammarPointKey: row.grammarPointKey,
        language: row.language,
        cefrLevel: row.cefrLevel,
        sentence: row.sentence,
        correctAnswer: row.correctAnswer,
        glossEn: row.glossEn,
        verdict: verdict.verdict,
        offendingSpan: verdict.offendingSpan,
        proposedGloss: verdict.proposedGloss,
        loadBearing: verdict.loadBearing,
        reasoning: verdict.reasoning,
        confidence: verdict.confidence,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`row ${row.id} (${row.grammarPointKey}): judge failed — ${message}`);
    }
  }

  const report: GlossAuditReport = {
    meta: {
      name: filters.out ?? 'audit-gloss',
      filters,
      model: GLOSS_SPOILAGE_MODEL,
      promptVersion: GLOSS_SPOILAGE_PROMPT_VERSION,
      costUsd,
      costCapped,
      timestamp: new Date().toISOString(),
      rowsScanned: limitedRows.length,
      rowsSkippedNoGloss: skippedNoGloss,
      pointsTotal: pointGroups.size,
      pointsExcluded: pointTriage.filter((p) => p.excluded).length,
      rowsJudged: findings.length,
    },
    pointTriage,
    findings,
    errors,
  };

  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${report.meta.name}.json`);
  const mdPath = path.join(outDir, `${report.meta.name}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, renderGlossMarkdown(report), 'utf8');

  console.log(`[audit-gloss] wrote ${jsonPath}`);
  console.log(`[audit-gloss] wrote ${mdPath}`);
  console.log(
    `[audit-gloss] estimated cost $${costUsd.toFixed(2)}${costCapped ? ' (CAPPED — see Errors in the report)' : ''}`,
  );
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[audit-gloss] unhandled failure:', err);
    process.exit(1);
  });
}
