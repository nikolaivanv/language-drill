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

import { parseArgs } from 'node:util';

import { ExerciseType } from '@language-drill/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDb, exercises } from '@language-drill/db';

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
