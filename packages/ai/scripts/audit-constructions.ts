/**
 * packages/ai — audit:constructions CLI. Finds grammar points whose approved
 * pool realizes only some of the constructions their description claims: the
 * PR #664 defect class, which `audit:collapse` cannot see because two of its
 * three signals read declared mechanisms a spec-less point lacks by definition
 * and the other two are lexical.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 *
 * Usage:
 *   pnpm audit:constructions --dry-run
 *   pnpm audit:constructions --language ES --cefr B1 --max-cost-usd 2
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  ALL_CURRICULA,
  createDb,
  dismissedConstructionIds,
  exercises,
  findConstructionDismissal,
  requireEnv,
} from '@language-drill/db';
import {
  CONSTRUCTION_COVERAGE_PROMPT_VERSION,
  DEFAULT_CLASSIFICATION_BATCH_SIZE,
  FINDING_MAX_SHARE,
  analyzeCell,
  classifyRowBatch,
  createClaudeClient,
  enumeratePointConstructions,
  pLimit,
  proposeMechanism,
  sampleRowsForCell,
  type CellAnalysis,
  type ConstructionCount,
  type MechanismProposal,
  type PointEnumeration,
  type RowClassification,
} from '../src/index.js';

// sentence_construction joined 2026-08-21. Until then the audit had never
// examined a single SC row in any language, so construction-level collapse
// there was invisible: `audit:collapse` can see SC but only measures answer
// SURFACES and DECLARED mechanisms, and a point that declares neither a
// coverageSpec nor constructionVariants defeats both of its triaged signals —
// 45 rows of one construction over 45 different nouns read as healthy. That is
// the blind spot this tool was built for in #667; it simply did not cover the
// type. Found while checking 404 approved TR SC rows across 8 variant-less
// points (docs/analysis/tr-sc-collapse-2026-08-21.md).
const IN_SCOPE_TYPES = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
] as const;

/** Enumeration attempts per point before recording a failure. See the re-roll
 *  rationale at the stage-1 dispatch. */
export const ENUMERATION_ATTEMPTS = 2;

export type AuditConstructionsFilters = {
  language?: string;
  cefr?: string;
  grammarPoint?: string;
  type?: string;
  maxPoints?: number;
  minRows: number;
  samplePerCell: number;
  seed: string;
  maxCostUsd: number;
  concurrency: number;
  enumerationModel?: string;
  out?: string;
  dryRun: boolean;
  checkFixture: boolean;
};

function positiveInt(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got '${raw}'`);
  }
  return n;
}

export function parseAuditConstructionsArgs(argv: string[]): AuditConstructionsFilters {
  // `--limit` is deliberately declared so it can be REJECTED with a pointer to
  // --max-points. It already means rows in revalidate:cloze and cells in
  // backfill:variant-seeds; silently accepting a third meaning deepens a trap.
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      'grammar-point': { type: 'string' },
      type: { type: 'string' },
      'max-points': { type: 'string' },
      limit: { type: 'string' },
      'min-rows': { type: 'string' },
      'sample-per-cell': { type: 'string' },
      seed: { type: 'string' },
      'max-cost-usd': { type: 'string' },
      concurrency: { type: 'string' },
      'enumeration-model': { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'check-fixture': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:constructions [--language ES] [--cefr B1] [--grammar-point <key>]\n' +
        '                          [--type cloze|translation] [--max-points N]\n' +
        '                          [--min-rows 8] [--sample-per-cell 24] [--seed <s>]\n' +
        '                          [--max-cost-usd 2] [--concurrency 4]\n' +
        '                          [--enumeration-model <id>] [--out <name>]\n' +
        '                          [--dry-run] [--check-fixture]\n\n' +
        '--dry-run makes NO API calls and costs nothing, and prints a rough dollar\n' +
        '  estimate for a real run.\n' +
        '--max-cost-usd defaults to 2 (dollars). A full sweep runs roughly $19, so\n' +
        '  the no-flag invocation truncates well short of a full sweep — check the\n' +
        '  --dry-run estimate first and raise the cap if you want a full pass.\n' +
        '--concurrency parallelizes classification batches WITHIN one cell; cells\n' +
        '  and points are still processed serially.\n' +
        '--max-points caps the points selected from the curriculum BEFORE filtering\n' +
        '  to those that actually have an approved cell, so fewer than N points may\n' +
        '  end up examined.\n' +
        '--out names the run — the report is written to audit-runs/<name>.json and\n' +
        '  audit-runs/<name>.md, not to the literal path given.\n' +
        '--enumeration-model overrides only the enumeration-stage model; the cost\n' +
        '  cap and the reported cost stay priced at Sonnet rates regardless.',
    );
    process.exit(0);
  }

  if (values.limit !== undefined) {
    throw new Error(
      "--limit is not supported (it means rows in revalidate:cloze and cells in " +
        'backfill:variant-seeds). Use --max-points.',
    );
  }

  if (values.type !== undefined && !(IN_SCOPE_TYPES as readonly string[]).includes(values.type)) {
    throw new Error(`--type must be cloze or translation, got '${values.type}'`);
  }

  const maxCostRaw = values['max-cost-usd'];
  const maxCostUsd = maxCostRaw === undefined ? 2 : Number(maxCostRaw);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(`--max-cost-usd must be a positive number, got '${String(maxCostRaw)}'`);
  }

  return {
    language: values.language,
    cefr: values.cefr,
    grammarPoint: values['grammar-point'],
    type: values.type,
    maxPoints:
      values['max-points'] === undefined
        ? undefined
        : positiveInt(values['max-points'], '--max-points', 1),
    minRows: positiveInt(values['min-rows'], '--min-rows', 8),
    samplePerCell: positiveInt(values['sample-per-cell'], '--sample-per-cell', 24),
    seed: values.seed ?? 'default',
    maxCostUsd,
    concurrency: positiveInt(values.concurrency, '--concurrency', 4),
    enumerationModel: values['enumeration-model'],
    out: values.out,
    dryRun: values['dry-run'] ?? false,
    checkFixture: values['check-fixture'] ?? false,
  };
}

export type LoadedRow = {
  id: string;
  type: string | null;
  grammarPointKey: string | null;
  contentJson: Record<string, unknown> | null;
};

export type Cell = {
  cellKey: string;
  grammarPointKey: string;
  type: ExerciseType;
  rows: Array<{ id: string; content: Record<string, unknown> }>;
};

/** Read-only. Mirrors audit-collapse.ts's loadApprovedRows shape. */
export async function loadApprovedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditConstructionsFilters,
): Promise<LoadedRow[]> {
  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNotNull(exercises.grammarPointKey),
    inArray(exercises.type, [...IN_SCOPE_TYPES]),
  ];
  if (filters.language) conditions.push(eq(exercises.language, filters.language));
  if (filters.cefr) conditions.push(eq(exercises.difficulty, filters.cefr));
  if (filters.type) conditions.push(eq(exercises.type, filters.type));
  if (filters.grammarPoint) {
    conditions.push(eq(exercises.grammarPointKey, filters.grammarPoint));
  }

  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conditions));

  return rows as LoadedRow[];
}

export function groupRowsIntoCells(rows: readonly LoadedRow[]): Cell[] {
  const byKey = new Map<string, Cell>();
  for (const row of rows) {
    if (!row.grammarPointKey || !row.type) continue;
    if (!(IN_SCOPE_TYPES as readonly string[]).includes(row.type)) continue;
    const cellKey = `${row.grammarPointKey}:${row.type}`;
    let cell = byKey.get(cellKey);
    if (!cell) {
      cell = {
        cellKey,
        grammarPointKey: row.grammarPointKey,
        type: row.type as ExerciseType,
        rows: [],
      };
      byKey.set(cellKey, cell);
    }
    cell.rows.push({ id: row.id, content: row.contentJson ?? {} });
  }
  return [...byKey.values()].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}

const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;
// All three stages (enumerate, classify, propose) cache-mark their system
// block (`cache_control: { type: 'ephemeral' }` in construction-coverage.ts).
// Anthropic reports those tokens separately from `input_tokens` — a cache
// WRITE costs 1.25x base input (the default 5-minute ephemeral TTL; a future
// switch to `ttl: '1h'` would make this 2x instead), a cache READ costs 0.1x.
// Classification caches the point's construction list, so every new point
// writes a fresh cache entry: omitting these terms would understate the real
// spend behind the money-safety `--max-cost-usd` cap by the large half of
// each call's input.
const SONNET_CACHE_WRITE_USD_PER_MTOK = 3.75; // 1.25x base input, 5-minute ephemeral TTL
const SONNET_CACHE_READ_USD_PER_MTOK = 0.3; // 0.1x base input

export function estimateCallCostUsd(usage: Anthropic.Usage): number {
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK +
    (cacheCreationTokens / 1_000_000) * SONNET_CACHE_WRITE_USD_PER_MTOK +
    (cacheReadTokens / 1_000_000) * SONNET_CACHE_READ_USD_PER_MTOK
  );
}

// Rough, deliberately conservative per-call token estimates for the
// --dry-run dollar estimate only — no call is made to measure these.
// `audit-gloss --dry-run`'s printDryRunEstimate is the precedent. Both stages
// cache-mark their system block, so a real run's actual cost trends well
// below this bound after the first call of each stage; these numbers ignore
// that discount on purpose so the estimate errs high, not low.
const ESTIMATED_ENUMERATION_INPUT_TOKENS = 900;
const ESTIMATED_ENUMERATION_OUTPUT_TOKENS = 500;
const ESTIMATED_CLASSIFICATION_BATCH_INPUT_TOKENS = 1800; // per batch of up to DEFAULT_CLASSIFICATION_BATCH_SIZE rows
const ESTIMATED_CLASSIFICATION_BATCH_OUTPUT_TOKENS = 400;
// Stage 4. Omitting this is what made the 2026-08-19 ES sweep come in at $7.16
// against a "conservative upper bound" of $5.72: 162 findings meant 162
// unpriced snippet-authoring calls. Proposals are output-heavy (a paste-ready
// curriculum fragment), so they cost more per call than either other stage.
// The bound assumes the worst case — every classified cell yields a finding.
const ESTIMATED_PROPOSAL_INPUT_TOKENS = 1200;
const ESTIMATED_PROPOSAL_OUTPUT_TOKENS = 900;

function roughCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

const ESTIMATED_ENUMERATION_COST_USD = roughCostUsd(
  ESTIMATED_ENUMERATION_INPUT_TOKENS,
  ESTIMATED_ENUMERATION_OUTPUT_TOKENS,
);
const ESTIMATED_CLASSIFICATION_BATCH_COST_USD = roughCostUsd(
  ESTIMATED_CLASSIFICATION_BATCH_INPUT_TOKENS,
  ESTIMATED_CLASSIFICATION_BATCH_OUTPUT_TOKENS,
);
const ESTIMATED_PROPOSAL_COST_USD = roughCostUsd(
  ESTIMATED_PROPOSAL_INPUT_TOKENS,
  ESTIMATED_PROPOSAL_OUTPUT_TOKENS,
);

export type Budget = {
  /** Record spend against the running total. */
  spend(usd: number): void;
  /**
   * True while under the cap. The FIRST call that finds the cap reached
   * latches `partial` + a cost-cap `reason` and returns false forever after.
   * The cap bounds NEW work, not work already sent: with concurrency > 1 the
   * in-flight jobs still complete, so `total()` can modestly exceed `maxCostUsd`.
   */
  left(): boolean;
  partial(): boolean;
  reason(): string | null;
  total(): number;
  /** Latches `partial` with a caller-supplied reason — e.g. "N points never
   *  enumerated". A no-op if a reason is already latched (never clobbers an
   *  earlier cost-cap reason with a later, less specific one). */
  markPartial(reason: string): void;
};

/** Seam extracted so the cost-cap / partial state machine — the highest-risk
 *  logic in this file — is unit-testable without driving the whole of
 *  `main()`. */
export function createBudget(maxCostUsd: number): Budget {
  let total = 0;
  let isPartial = false;
  let stoppedReason: string | null = null;

  const markPartial = (reason: string): void => {
    if (isPartial) return;
    isPartial = true;
    stoppedReason = reason;
  };

  return {
    spend(usd: number): void {
      total += usd;
    },
    left(): boolean {
      if (total < maxCostUsd) return true;
      markPartial(`cost cap of $${maxCostUsd} reached`);
      return false;
    },
    partial(): boolean {
      return isPartial;
    },
    reason(): string | null {
      return stoppedReason;
    },
    total(): number {
      return total;
    },
    markPartial,
  };
}

export type ConstructionFinding = {
  cellKey: string;
  grammarPointKey: string;
  grammarPointName: string;
  type: string;
  language: string;
  cefrLevel: string;
  mechanism: PointEnumeration['mechanism'];
  sampled: number;
  classified: number;
  unresolved: number;
  missing: ConstructionCount[];
  counts: ConstructionCount[];
  proposal: MechanismProposal | null;
};

export type ConstructionAuditReport = {
  runName: string;
  promptVersion: string;
  seed: string;
  samplePerCell: number;
  /** True when a cost cap or an abort stopped the run before every point was
   *  examined. A truncated sweep that reads as complete turns a coverage gap
   *  invisible. */
  partial: boolean;
  stoppedReason: string | null;
  summary: {
    pointsEnumerated: number;
    /** examinable.length — the denominator `pointsEnumerated` needs to read as
     *  "40 of 312", not a bare count with no scale. */
    pointsInScope: number;
    pointsSingleConstruction: number;
    cellsClassified: number;
    rowsSampled: number;
    findings: number;
    enumerationSuspect: number;
    dismissed: number;
    thinCellsSkipped: number;
    enumerationErrors: number;
    classificationErrors: number;
    proposalErrors: number;
    costUsd: number;
  };
  findings: ConstructionFinding[];
  enumerationSuspect: Array<{ cellKey: string; unresolved: number; sampled: number }>;
  dismissed: Array<{ cellKey: string; constructionId: string; reason: string; dismissedOn: string }>;
  thinCells: Array<{ cellKey: string; rows: number }>;
  enumerationErrors: Array<{ grammarPointKey: string; message: string }>;
  /** A failed classification batch never aborts the run — its rows are
   *  recorded as unresolved (see `nullClassificationsForBatch`) so the
   *  denominator stays honest, and the failure is recorded here instead. */
  classificationErrors: Array<{ cellKey: string; batchIndex: number; message: string }>;
  /** A failed proposal call is otherwise indistinguishable from a point whose
   *  fix mechanism is legitimately `none`. */
  proposalErrors: Array<{ cellKey: string; grammarPointKey: string; message: string }>;
  /** Points in scope that were never enumerated AND have no recorded
   *  enumeration error — i.e. the cost cap stopped the run before stage 1
   *  even attempted them. Only meaningful (and only rendered) on a partial run. */
  neverEnumerated: string[];
};

/** Zero-realized first, then bigger cells first. The retrofit tail per fix is
 *  real (merge → push-prompts → backfill:variant-seeds → demote:pool), so the
 *  top of this list is what actually gets worked. */
export function rankFindings(findings: readonly ConstructionFinding[]): ConstructionFinding[] {
  return [...findings].sort((a, b) => {
    const aZero = a.missing.some((m) => m.count === 0) ? 0 : 1;
    const bZero = b.missing.some((m) => m.count === 0) ? 0 : 1;
    if (aZero !== bZero) return aZero - bZero;
    if (a.sampled !== b.sampled) return b.sampled - a.sampled;
    return a.cellKey.localeCompare(b.cellKey);
  });
}

function pct(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

/** Fallback used when a classification batch call throws (transient overload,
 *  a malformed tool response, etc.). Every row in the batch resolves to
 *  `constructionId: null` — exactly what an honest `unclear` classification
 *  would produce — so the batch's rows still count toward `sampled` and a
 *  badly-degraded cell surfaces through the existing `enumeration-suspect`
 *  gate rather than vanishing from the denominator. */
export function nullClassificationsForBatch(size: number): RowClassification[] {
  return Array.from({ length: size }, () => ({ constructionId: null }));
}

export function renderConstructionsMarkdown(report: ConstructionAuditReport): string {
  const lines: string[] = [];
  const ranked = rankFindings(report.findings);
  lines.push(`# Construction-coverage audit — ${report.runName}`, '');
  if (report.partial) {
    lines.push(
      `> **PARTIAL RUN** — stopped early: ${report.stoppedReason ?? 'unknown'}. ` +
        'Points after the stop were never examined; absence of a finding below is NOT evidence of coverage.',
      '',
    );
  }
  lines.push(
    `Prompt version: \`${report.promptVersion}\` · seed: \`${report.seed}\` · sample cap: ${report.samplePerCell}`,
    '',
    '## Summary',
    '',
    `- Points enumerated: **${report.summary.pointsEnumerated}** / ${report.summary.pointsInScope} in scope`,
    `- Single-construction (classification skipped): **${report.summary.pointsSingleConstruction}**`,
    `- Cells classified: **${report.summary.cellsClassified}**`,
    `- Rows sampled: **${report.summary.rowsSampled}**`,
    `- Findings: **${report.summary.findings}**`,
    `- Enumeration-suspect cells: **${report.summary.enumerationSuspect}**`,
    `- Dismissed by ledger: **${report.summary.dismissed}**`,
    `- Thin cells skipped: **${report.summary.thinCellsSkipped}**`,
    `- Enumeration errors: **${report.summary.enumerationErrors}**`,
    `- Classification errors: **${report.summary.classificationErrors}**`,
    `- Proposal errors: **${report.summary.proposalErrors}**`,
    `- Estimated cost: **$${report.summary.costUsd.toFixed(2)}**`,
    '',
    '## Findings',
    '',
  );

  if (report.findings.length === 0) {
    lines.push('_None._', '');
  }
  for (const f of ranked) {
    lines.push(
      `### \`${f.cellKey}\` — ${f.grammarPointName}`,
      '',
      `- Mechanism: **${f.mechanism}**`,
      `- Under-represented: ${f.missing
        .map((m) => `**${m.label}** (\`${m.id}\`) — realized ${m.count}/${f.sampled} sampled`)
        .join('; ')}`,
      `- Full distribution (of ${f.classified} classified, ${f.unresolved} unresolved):`,
      ...f.counts.map(
        (c) =>
          `  - \`${c.id}\` ${c.label}: ${c.count} (${pct(c.share)})` +
          `${c.mustRepresent ? '' : ' _[not load-bearing]_'}`,
      ),
      '',
    );
  }

  lines.push('## Proposed snippets', '');
  const withProposals = ranked.filter((f) => f.proposal !== null);
  if (withProposals.length === 0) lines.push('_None._', '');
  for (const f of withProposals) {
    lines.push(
      `### \`${f.grammarPointKey}\` — ${f.proposal?.mechanism}`,
      '',
      f.proposal?.notes ?? '',
      '',
      '```ts',
      f.proposal?.snippet ?? '',
      '```',
      '',
    );
  }

  if (report.proposalErrors.length > 0) {
    lines.push('## Proposal errors', '');
    for (const e of report.proposalErrors) {
      lines.push(`- \`${e.cellKey}\` (\`${e.grammarPointKey}\`): ${e.message}`);
    }
    lines.push('');
  }

  lines.push('## Enumeration-suspect cells', '');
  lines.push(
    '_The construction list is probably wrong for these; no finding was raised._',
    '',
  );
  if (report.enumerationSuspect.length === 0) lines.push('_None._', '');
  for (const s of report.enumerationSuspect) {
    lines.push(`- \`${s.cellKey}\`: ${s.unresolved}/${s.sampled} sampled rows unresolved`);
  }
  lines.push('');

  lines.push('## Dismissed by ledger', '');
  if (report.dismissed.length === 0) lines.push('_None._', '');
  for (const d of report.dismissed) {
    lines.push(`- \`${d.cellKey}\` / \`${d.constructionId}\` (${d.dismissedOn}): ${d.reason}`);
  }
  lines.push('');

  lines.push('## Skipped thin cells', '');
  if (report.thinCells.length === 0) lines.push('_None._', '');
  for (const t of report.thinCells) {
    lines.push(`- \`${t.cellKey}\`: ${t.rows} rows`);
  }
  lines.push('');

  if (report.enumerationErrors.length > 0) {
    lines.push('## Enumeration errors', '');
    for (const e of report.enumerationErrors) {
      lines.push(`- \`${e.grammarPointKey}\`: ${e.message}`);
    }
    lines.push('');
  }

  if (report.classificationErrors.length > 0) {
    lines.push('## Classification errors', '');
    for (const e of report.classificationErrors) {
      lines.push(`- \`${e.cellKey}\` batch ${e.batchIndex}: ${e.message}`);
    }
    lines.push('');
  }

  if (report.partial) {
    lines.push(
      '## Never enumerated',
      '',
      '_Points in scope the cost cap stopped the run from ever attempting — no error, just never reached._',
      '',
    );
    if (report.neverEnumerated.length === 0) {
      lines.push('_None._', '');
    } else {
      for (const key of report.neverEnumerated) lines.push(`- \`${key}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** The grammar points this run covers, honouring the filters. */
export function selectPoints(filters: AuditConstructionsFilters): GrammarPoint[] {
  let points = ALL_CURRICULA.filter((p) => p.kind === 'grammar');
  if (filters.language) points = points.filter((p) => p.language === filters.language);
  if (filters.cefr) points = points.filter((p) => p.cefrLevel === filters.cefr);
  if (filters.grammarPoint) points = points.filter((p) => p.key === filters.grammarPoint);
  points = [...points].sort((a, b) => a.key.localeCompare(b.key));
  if (filters.maxPoints !== undefined) points = points.slice(0, filters.maxPoints);
  return points;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// --check-fixture — precision/recall gate for enumeration stability.
// ---------------------------------------------------------------------------

export const FIXTURE_DRAWS_PER_CASE = 3;

export type FixtureCase = {
  name: string;
  grammarPointKey: string;
  grammarPoint: GrammarPoint;
  expectedMustRepresentCount: number;
  expectedMechanism: PointEnumeration['mechanism'];
};

export function loadFixtureCases(fixturePath: string): FixtureCase[] {
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { cases?: unknown }).cases)
  ) {
    throw new Error(`fixture ${fixturePath} must be an object with a 'cases' array`);
  }
  return (parsed as { cases: FixtureCase[] }).cases;
}

/** Majority vote across draws. A tie counts as a failure — an unstable judge
 *  is not a passing judge. */
export function scoreFixtureCase(
  draws: readonly number[],
  expected: number,
): { majority: number; passed: boolean } {
  const tally = new Map<number, number>();
  for (const d of draws) tally.set(d, (tally.get(d) ?? 0) + 1);
  let majority = draws[0];
  let best = 0;
  let tied = false;
  for (const [value, n] of tally) {
    if (n > best) {
      best = n;
      majority = value;
      tied = false;
    } else if (n === best) {
      tied = true;
    }
  }
  return { majority, passed: !tied && majority === expected };
}

// `--out` names the REPORT, not the fixture, so it is deliberately not consulted
// here — overloading it would make `--check-fixture --out x` silently look for a
// fixture at the report path.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.join(SCRIPT_DIR, 'fixtures', 'construction-coverage-cases.json');

/** `estimateCallCostUsd` hardcodes Sonnet pricing, but stage 1's model is
 *  user-overridable. Opus runs roughly 1.7x Sonnet's cost, so an
 *  `--enumeration-model` override under-counts against `--max-cost-usd` by
 *  that factor with no other signal — a money-safety control, not just a
 *  cosmetic report column. This does not attempt per-model pricing; it only
 *  makes the mispricing visible. */
function warnIfEnumerationModelOverridesCost(filters: AuditConstructionsFilters): void {
  if (!filters.enumerationModel) return;
  console.warn(
    `[audit-constructions] WARNING: --enumeration-model ${filters.enumerationModel} overrides ` +
      'the enumeration-stage model, but --max-cost-usd and every printed cost figure are priced ' +
      'at Sonnet rates. A more expensive model (e.g. Opus, roughly 1.7x Sonnet) will under-count ' +
      'against the cap and the reported total will understate real spend.',
  );
}

async function runCheckFixtureMode(filters: AuditConstructionsFilters): Promise<void> {
  const cases = loadFixtureCases(DEFAULT_FIXTURE_PATH);
  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const budget = createBudget(filters.maxCostUsd);

  let passed = 0;
  let attempted = 0;
  for (const c of cases) {
    if (!budget.left()) {
      console.log(`[audit-constructions] fixture: stopping early — ${budget.reason()}`);
      break;
    }
    attempted++;
    const draws: number[] = [];
    for (let i = 0; i < FIXTURE_DRAWS_PER_CASE; i++) {
      const { enumeration, usage } = await enumeratePointConstructions(
        client,
        c.grammarPoint,
        undefined,
        filters.enumerationModel,
      );
      budget.spend(estimateCallCostUsd(usage));
      draws.push(enumeration.constructions.filter((x) => x.mustRepresent).length);
    }
    const score = scoreFixtureCase(draws, c.expectedMustRepresentCount);
    if (score.passed) passed++;
    console.log(
      `${score.passed ? 'PASS' : 'FAIL'}  ${c.name}  draws=[${draws.join(', ')}]  ` +
        `majority=${score.majority}  expected=${c.expectedMustRepresentCount}`,
    );
  }
  console.log(
    `\n[audit-constructions] fixture: ${passed}/${attempted} passed` +
      (attempted < cases.length ? ` (${cases.length - attempted} case(s) never attempted — cost cap)` : ''),
  );
  if (passed < cases.length) process.exitCode = 1;
}

async function main(): Promise<void> {
  const filters = parseAuditConstructionsArgs(process.argv.slice(2));
  warnIfEnumerationModelOverridesCost(filters);

  if (filters.checkFixture) {
    await runCheckFixtureMode(filters);
    return;
  }

  const db = createDb(requireEnv('DATABASE_URL'));
  const rows = await loadApprovedRows(db, filters);
  const allCells = groupRowsIntoCells(rows);
  const points = selectPoints(filters);
  const pointKeys = new Set(points.map((p) => p.key));

  const cellsByPoint = new Map<string, Cell[]>();
  const thinCells: ConstructionAuditReport['thinCells'] = [];
  for (const cell of allCells) {
    if (!pointKeys.has(cell.grammarPointKey)) continue;
    if (cell.rows.length < filters.minRows) {
      thinCells.push({ cellKey: cell.cellKey, rows: cell.rows.length });
      continue;
    }
    const list = cellsByPoint.get(cell.grammarPointKey) ?? [];
    list.push(cell);
    cellsByPoint.set(cell.grammarPointKey, list);
  }

  const examinable = points.filter((p) => (cellsByPoint.get(p.key)?.length ?? 0) > 0);

  if (filters.dryRun) {
    const cellCount = [...cellsByPoint.values()].reduce((n, list) => n + list.length, 0);
    const cellList = [...cellsByPoint.values()].flat();
    const sampled = cellList.reduce(
      (n, c) => n + Math.min(c.rows.length, filters.samplePerCell),
      0,
    );
    // Upper bound: assumes every cell needs classification (in reality only
    // points with >=2 must-represent constructions do — unknowable before
    // stage 1 runs) and ignores the prompt-cache discount after each stage's
    // first call. Deliberately conservative, per the estimate constants above.
    const classificationBatches = cellList.reduce(
      (n, c) =>
        n +
        Math.ceil(
          Math.min(c.rows.length, filters.samplePerCell) / DEFAULT_CLASSIFICATION_BATCH_SIZE,
        ),
      0,
    );
    const estimatedCostUsd =
      examinable.length * ESTIMATED_ENUMERATION_COST_USD +
      classificationBatches * ESTIMATED_CLASSIFICATION_BATCH_COST_USD +
      // Worst case: every classified cell produces a finding and therefore a
      // proposal call. Cells, not findings — findings are not knowable here.
      cellCount * ESTIMATED_PROPOSAL_COST_USD;
    console.log(
      `[audit-constructions] DRY RUN — no API calls, no cost.\n` +
        `  points to enumerate: ${examinable.length}\n` +
        `  cells in scope: ${cellCount}\n` +
        `  rows that would be sampled (upper bound): ${sampled}\n` +
        `  thin cells skipped (< ${filters.minRows} rows): ${thinCells.length}\n` +
        `  rough upper-bound cost estimate: $${estimatedCostUsd.toFixed(2)} ` +
        `(upper bound — assumes every cell needs classification AND yields a\n` +
        `        proposal, and ignores prompt-cache discounts after each stage's\n` +
        `        first call)\n` +
        `  NOTE: classification runs only for points with >=2 must-represent\n` +
        `        constructions, so the real cost is well below this bound.`,
    );
    if (estimatedCostUsd > filters.maxCostUsd) {
      console.log(
        `[audit-constructions] NOTE: this rough estimate ($${estimatedCostUsd.toFixed(2)}) exceeds ` +
          `--max-cost-usd ${filters.maxCostUsd} — an unflagged run will likely stop early, roughly ` +
          `$${(estimatedCostUsd - filters.maxCostUsd).toFixed(2)} short of a full sweep. Raise ` +
          '--max-cost-usd if you want the full sweep.',
      );
    }
    return;
  }

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const limit = pLimit(filters.concurrency);
  const budget = createBudget(filters.maxCostUsd);

  const enumerations = new Map<string, PointEnumeration>();
  const enumerationErrors: ConstructionAuditReport['enumerationErrors'] = [];

  await Promise.all(
    examinable.map((gp) =>
      limit(async () => {
        if (!budget.left()) return;
        // One re-roll on failure. Enumeration failures observed on the
        // 2026-08-19 ES sweep were intermittent serialization faults, not
        // properties of the point: Anthropic tool-use sometimes returns
        // `constructions` as a JSON string, and sometimes that string carries
        // unescaped inner quotes ('indicative ("in case")') that defeat even
        // jsonrepair's delimiter heuristic — the shape @language-drill/shared's
        // decodeMaybeRepaired documents as unrepairable. Its recovery path is a
        // regenerate retry, and the same one works here: two of the three
        // failures re-rolled clean on the very next call. A retry costs one
        // extra call only on the failing point, against losing that point from
        // the sweep entirely.
        for (let attempt = 1; attempt <= ENUMERATION_ATTEMPTS; attempt++) {
          try {
            const { enumeration, usage } = await enumeratePointConstructions(
              client,
              gp,
              undefined,
              filters.enumerationModel,
            );
            budget.spend(estimateCallCostUsd(usage));
            enumerations.set(gp.key, enumeration);
            break;
          } catch (err) {
            // Record only once the last attempt is spent, so a point that
            // recovers on the re-roll leaves no error behind and does not
            // latch `partial`.
            if (attempt === ENUMERATION_ATTEMPTS) {
              enumerationErrors.push({
                grammarPointKey: gp.key,
                message: `${err instanceof Error ? err.message : String(err)} (after ${ENUMERATION_ATTEMPTS} attempts)`,
              });
            }
          }
        }
      }),
    ),
  );

  // A point whose enumeration failed (Anthropic degraded, a parser change,
  // etc.) is never examined for classification either — that is exactly the
  // "truncated sweep reads as complete" failure `partial` exists to flag, so
  // it must latch the same way a cost-cap stop does. `markPartial` no-ops if
  // a cost-cap reason already latched during stage 1, so this never clobbers
  // the more specific reason.
  if (enumerationErrors.length > 0) {
    budget.markPartial(
      `${enumerationErrors.length} point(s) failed enumeration and were never examined`,
    );
  }

  const findings: ConstructionFinding[] = [];
  const enumerationSuspect: ConstructionAuditReport['enumerationSuspect'] = [];
  const dismissedEntries: ConstructionAuditReport['dismissed'] = [];
  const classificationErrors: ConstructionAuditReport['classificationErrors'] = [];
  const proposalErrors: ConstructionAuditReport['proposalErrors'] = [];
  let cellsClassified = 0;
  let rowsSampled = 0;
  let singleConstruction = 0;

  for (const gp of examinable) {
    const enumeration = enumerations.get(gp.key);
    if (!enumeration) continue;
    const mustRepresent = enumeration.constructions.filter((c) => c.mustRepresent);
    if (mustRepresent.length < 2) {
      singleConstruction++;
      continue;
    }

    for (const cell of cellsByPoint.get(gp.key) ?? []) {
      if (!budget.left()) break;
      const sample = sampleRowsForCell(cell.rows, filters.seed, filters.samplePerCell);
      const batches = chunk(sample, DEFAULT_CLASSIFICATION_BATCH_SIZE);
      const results = await Promise.all(
        batches.map((batch, batchIndex) =>
          limit(async () => {
            try {
              const { classifications, usage } = await classifyRowBatch(client, {
                constructions: enumeration.constructions,
                type: cell.type,
                rows: batch,
              });
              budget.spend(estimateCallCostUsd(usage));
              return classifications;
            } catch (err) {
              // A single batch failure (transient overload across ~600 calls,
              // or a parser throw on a malformed tool response) must not sink
              // the whole run — the rows resolve to unresolved instead, which
              // the existing judge-health gate below already handles honestly.
              classificationErrors.push({
                cellKey: cell.cellKey,
                batchIndex,
                message: err instanceof Error ? err.message : String(err),
              });
              return nullClassificationsForBatch(batch.length);
            }
          }),
        ),
      );
      const classifications: RowClassification[] = results.flat();
      cellsClassified++;
      rowsSampled += sample.length;

      const dismissed = dismissedConstructionIds(cell.grammarPointKey, cell.type);

      const analysis: CellAnalysis = analyzeCell({
        constructions: enumeration.constructions,
        classifications,
        dismissedConstructionIds: dismissed,
      });

      // Only record a dismissal as "suppressed a finding" when the ledgered
      // construction was actually at-or-below the finding threshold this run
      // — otherwise `summary.dismissed` reads as "N findings suppressed" when
      // it may mean "N dismissals exist and none were needed."
      for (const id of dismissed) {
        const entry = findConstructionDismissal(cell.grammarPointKey, cell.type, id);
        if (!entry) continue;
        const countEntry = analysis.counts.find((c) => c.id === id);
        if (countEntry && countEntry.mustRepresent && countEntry.share <= FINDING_MAX_SHARE) {
          dismissedEntries.push({
            cellKey: cell.cellKey,
            constructionId: id,
            reason: entry.reason,
            dismissedOn: entry.dismissedOn,
          });
        }
      }

      if (analysis.status === 'enumeration-suspect') {
        enumerationSuspect.push({
          cellKey: cell.cellKey,
          unresolved: analysis.unresolved,
          sampled: analysis.sampled,
        });
        continue;
      }
      if (analysis.status !== 'finding') continue;

      let proposal: MechanismProposal | null = null;
      if (enumeration.mechanism !== 'none' && budget.left()) {
        try {
          const result = await proposeMechanism(client, {
            grammarPoint: gp,
            mechanism: enumeration.mechanism,
            counts: analysis.counts,
            sampled: analysis.sampled,
          });
          budget.spend(estimateCallCostUsd(result.usage));
          proposal = result.proposal;
        } catch (err) {
          proposal = null;
          proposalErrors.push({
            cellKey: cell.cellKey,
            grammarPointKey: gp.key,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      findings.push({
        cellKey: cell.cellKey,
        grammarPointKey: cell.grammarPointKey,
        grammarPointName: gp.name,
        type: cell.type,
        language: gp.language,
        cefrLevel: gp.cefrLevel,
        mechanism: enumeration.mechanism,
        sampled: analysis.sampled,
        classified: analysis.classified,
        unresolved: analysis.unresolved,
        missing: analysis.missing,
        counts: analysis.counts,
        proposal,
      });
    }
  }

  // Mirrors the enumeration-error latch above: a cell with a failed batch
  // still gets a verdict (its rows read as unresolved), but the run as a
  // whole must not read as a complete sweep when a call actually failed.
  if (classificationErrors.length > 0) {
    budget.markPartial(
      `${classificationErrors.length} classification batch(es) failed and were recorded as unresolved`,
    );
  }

  const enumerationErrorKeys = new Set(enumerationErrors.map((e) => e.grammarPointKey));
  const neverEnumerated = examinable
    .filter((p) => !enumerations.has(p.key) && !enumerationErrorKeys.has(p.key))
    .map((p) => p.key);

  const runName = filters.out ?? `constructions-${filters.seed}`;
  const report: ConstructionAuditReport = {
    runName,
    promptVersion: CONSTRUCTION_COVERAGE_PROMPT_VERSION,
    seed: filters.seed,
    samplePerCell: filters.samplePerCell,
    partial: budget.partial(),
    stoppedReason: budget.reason(),
    summary: {
      pointsEnumerated: enumerations.size,
      pointsInScope: examinable.length,
      pointsSingleConstruction: singleConstruction,
      cellsClassified,
      rowsSampled,
      findings: findings.length,
      enumerationSuspect: enumerationSuspect.length,
      dismissed: dismissedEntries.length,
      thinCellsSkipped: thinCells.length,
      enumerationErrors: enumerationErrors.length,
      classificationErrors: classificationErrors.length,
      proposalErrors: proposalErrors.length,
      costUsd: budget.total(),
    },
    findings: rankFindings(findings),
    enumerationSuspect,
    dismissed: dismissedEntries,
    thinCells,
    enumerationErrors,
    classificationErrors,
    proposalErrors,
    neverEnumerated,
  };

  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${runName}.json`), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(path.join(outDir, `${runName}.md`), renderConstructionsMarkdown(report), 'utf8');
  console.log(
    `[audit-constructions] ${findings.length} findings · $${budget.total().toFixed(2)} · audit-runs/${runName}.md`,
  );
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[audit-constructions] unhandled failure:', err);
    process.exit(1);
  });
}
