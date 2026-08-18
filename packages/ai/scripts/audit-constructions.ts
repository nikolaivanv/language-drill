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

import { mkdirSync, writeFileSync } from 'node:fs';
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

const IN_SCOPE_TYPES = [ExerciseType.CLOZE, ExerciseType.TRANSLATION] as const;

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
        '                          [--enumeration-model <id>] [--out <path>]\n' +
        '                          [--dry-run] [--check-fixture]\n\n' +
        '--dry-run makes NO API calls and costs nothing.',
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
    pointsSingleConstruction: number;
    cellsClassified: number;
    rowsSampled: number;
    findings: number;
    enumerationSuspect: number;
    dismissed: number;
    thinCellsSkipped: number;
    enumerationErrors: number;
    costUsd: number;
  };
  findings: ConstructionFinding[];
  enumerationSuspect: Array<{ cellKey: string; unresolved: number; sampled: number }>;
  dismissed: Array<{ cellKey: string; constructionId: string; reason: string; dismissedOn: string }>;
  thinCells: Array<{ cellKey: string; rows: number }>;
  enumerationErrors: Array<{ grammarPointKey: string; message: string }>;
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

export function renderConstructionsMarkdown(report: ConstructionAuditReport): string {
  const lines: string[] = [];
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
    `- Points enumerated: **${report.summary.pointsEnumerated}**`,
    `- Single-construction (classification skipped): **${report.summary.pointsSingleConstruction}**`,
    `- Cells classified: **${report.summary.cellsClassified}**`,
    `- Rows sampled: **${report.summary.rowsSampled}**`,
    `- Findings: **${report.summary.findings}**`,
    `- Enumeration-suspect cells: **${report.summary.enumerationSuspect}**`,
    `- Dismissed by ledger: **${report.summary.dismissed}**`,
    `- Thin cells skipped: **${report.summary.thinCellsSkipped}**`,
    `- Enumeration errors: **${report.summary.enumerationErrors}**`,
    `- Estimated cost: **$${report.summary.costUsd.toFixed(2)}**`,
    '',
    '## Findings',
    '',
  );

  if (report.findings.length === 0) {
    lines.push('_None._', '');
  }
  for (const f of rankFindings(report.findings)) {
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
  const withProposals = report.findings.filter((f) => f.proposal !== null);
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

async function runCheckFixtureMode(_f: AuditConstructionsFilters): Promise<void> {
  throw new Error('not implemented');
}

async function main(): Promise<void> {
  const filters = parseAuditConstructionsArgs(process.argv.slice(2));

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
    const sampled = [...cellsByPoint.values()]
      .flat()
      .reduce((n, c) => n + Math.min(c.rows.length, filters.samplePerCell), 0);
    console.log(
      `[audit-constructions] DRY RUN — no API calls, no cost.\n` +
        `  points to enumerate: ${examinable.length}\n` +
        `  cells in scope: ${cellCount}\n` +
        `  rows that would be sampled (upper bound): ${sampled}\n` +
        `  thin cells skipped (< ${filters.minRows} rows): ${thinCells.length}\n` +
        `  NOTE: classification runs only for points with >=2 must-represent\n` +
        `        constructions, so the real cost is well below this bound.`,
    );
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
        try {
          const { enumeration, usage } = await enumeratePointConstructions(
            client,
            gp,
            undefined,
            filters.enumerationModel,
          );
          budget.spend(estimateCallCostUsd(usage));
          enumerations.set(gp.key, enumeration);
        } catch (err) {
          enumerationErrors.push({
            grammarPointKey: gp.key,
            message: err instanceof Error ? err.message : String(err),
          });
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
        batches.map((batch) =>
          limit(async () => {
            const { classifications, usage } = await classifyRowBatch(client, {
              constructions: enumeration.constructions,
              type: cell.type,
              rows: batch,
            });
            budget.spend(estimateCallCostUsd(usage));
            return classifications;
          }),
        ),
      );
      const classifications: RowClassification[] = results.flat();
      cellsClassified++;
      rowsSampled += sample.length;

      const dismissed = dismissedConstructionIds(cell.grammarPointKey, cell.type);
      for (const id of dismissed) {
        const entry = findConstructionDismissal(cell.grammarPointKey, cell.type, id);
        if (entry) {
          dismissedEntries.push({
            cellKey: cell.cellKey,
            constructionId: id,
            reason: entry.reason,
            dismissedOn: entry.dismissedOn,
          });
        }
      }

      const analysis: CellAnalysis = analyzeCell({
        constructions: enumeration.constructions,
        classifications,
        dismissedConstructionIds: dismissed,
      });

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
        } catch {
          proposal = null;
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
      pointsSingleConstruction: singleConstruction,
      cellsClassified,
      rowsSampled,
      findings: findings.length,
      enumerationSuspect: enumerationSuspect.length,
      dismissed: dismissedEntries.length,
      thinCellsSkipped: thinCells.length,
      enumerationErrors: enumerationErrors.length,
      costUsd: budget.total(),
    },
    findings: rankFindings(findings),
    enumerationSuspect,
    dismissed: dismissedEntries,
    thinCells,
    enumerationErrors,
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
