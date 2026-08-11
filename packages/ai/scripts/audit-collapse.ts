/**
 * packages/ai — audit:collapse CLI. Measures distributional collapse in the
 * approved exercise pool, triages each flagged cell with one Anthropic call, and
 * writes a JSON + markdown report to ./audit-runs/<name>.{json,md}.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 * See docs/superpowers/specs/2026-08-11-pool-collapse-audit-design.md.
 *
 * Usage:
 *   pnpm audit:collapse -- --dry-run
 *   pnpm audit:collapse -- --language ES --cefr B1 --max-cost-usd 2
 */

import { parseArgs } from 'node:util';

import { and, inArray, isNotNull, sql } from 'drizzle-orm';

import { ExerciseType, resolveCellTargetFor } from '@language-drill/shared';
import type { CoverageTags, CurriculumCefrLevel, GrammarPoint, LearningLanguage } from '@language-drill/shared';
import { createDb, exercises, getGrammarPoint } from '@language-drill/db';

import type { AuditRow } from '../src/collapse-metrics.js';

/** One row as loaded from Postgres, before curriculum resolution. */
export type LoadedRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: Record<string, unknown> | null;
  coverageTags: CoverageTags | null;
};

export type AuditCell = {
  cellKey: string;
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  target: number;
  rows: AuditRow[];
};

export type AuditFilters = {
  language?: string;
  cefr?: string;
  type?: string;
  grammarPoint?: string;
  limit?: number;
  minRows: number;
  threshold: number;
  monotonyThreshold: number;
  maxCostUsd: number;
  dryRun: boolean;
  name: string;
};

const EXERCISE_TYPES = new Set<string>(Object.values(ExerciseType));

export function cellKeyOf(
  language: string,
  cefrLevel: string,
  type: ExerciseType,
  grammarPointKey: string,
): string {
  return `${language}:${cefrLevel}:${type}:${grammarPointKey}`;
}

export function parseAuditArgs(argv: string[]): AuditFilters {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      type: { type: 'string' },
      'grammar-point': { type: 'string' },
      limit: { type: 'string' },
      'min-rows': { type: 'string', default: '15' },
      threshold: { type: 'string', default: '0.65' },
      'monotony-threshold': { type: 'string', default: '0.5' },
      'max-cost-usd': { type: 'string', default: '2' },
      'dry-run': { type: 'boolean', default: false },
      name: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:collapse [--language ES] [--cefr B1] [--type cloze] [--grammar-point <key>]\n' +
        '                     [--limit N] [--min-rows 15] [--threshold 0.65]\n' +
        '                     [--monotony-threshold 0.5] [--max-cost-usd 2] [--dry-run] [--name <run>]',
    );
    process.exit(0);
  }

  const minRows = Number(values['min-rows']);
  if (!Number.isInteger(minRows) || minRows < 1) {
    throw new Error(`--min-rows must be a positive integer, got '${values['min-rows']}'`);
  }
  const threshold = Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`--threshold must be in (0, 1], got '${values.threshold}'`);
  }
  const monotonyThreshold = Number(values['monotony-threshold']);
  if (!Number.isFinite(monotonyThreshold) || monotonyThreshold <= 0 || monotonyThreshold > 1) {
    throw new Error(`--monotony-threshold must be in (0, 1], got '${values['monotony-threshold']}'`);
  }
  const maxCostUsd = Number(values['max-cost-usd']);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(`--max-cost-usd must be positive, got '${values['max-cost-usd']}'`);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got '${values.limit}'`);
  }

  return {
    // Uppercased so `--language es` works: the DB stores 'ES' / 'B1'. The
    // qa:sample CLI has the same footgun and requires uppercase by hand.
    language: values.language?.toUpperCase(),
    cefr: values.cefr?.toUpperCase(),
    type: values.type,
    grammarPoint: values['grammar-point'],
    limit,
    minRows,
    threshold,
    monotonyThreshold,
    maxCostUsd,
    dryRun: values['dry-run'] ?? false,
    name: values.name ?? 'audit-collapse',
  };
}

/**
 * Group loaded rows into cells, resolving each against the live curriculum.
 * Rows are dropped (not errored) when their grammar point no longer exists or
 * their type is not a current `ExerciseType` — the pool outlives curriculum
 * edits, and a retired point is not an audit finding.
 */
export function groupRowsIntoCells(rows: readonly LoadedRow[]): AuditCell[] {
  const cells = new Map<string, AuditCell>();

  for (const r of rows) {
    if (!r.grammarPointKey || !r.type || !r.language || !r.difficulty) continue;
    if (!EXERCISE_TYPES.has(r.type)) continue;
    const gp = getGrammarPoint(r.grammarPointKey);
    if (!gp) continue;

    const exerciseType = r.type as ExerciseType;
    const cefrLevel = r.difficulty as CurriculumCefrLevel;
    const key = cellKeyOf(r.language, r.difficulty, exerciseType, r.grammarPointKey);

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        cellKey: key,
        language: r.language as LearningLanguage,
        cefrLevel,
        exerciseType,
        grammarPoint: gp,
        target: resolveCellTargetFor({ exerciseType, cefrLevel, grammarPoint: gp }),
        rows: [],
      };
      cells.set(key, cell);
    }
    cell.rows.push({
      id: r.id,
      type: exerciseType,
      content: r.contentJson ?? {},
      coverageTags: r.coverageTags,
    });
  }

  return [...cells.values()].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}

/** Load every approved row matching the filters. Read-only. */
export async function loadApprovedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditFilters,
): Promise<LoadedRow[]> {
  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNotNull(exercises.grammarPointKey),
  ];
  if (filters.language) conditions.push(sql`${exercises.language} = ${filters.language}`);
  if (filters.cefr) conditions.push(sql`${exercises.difficulty} = ${filters.cefr}`);
  if (filters.type) conditions.push(sql`${exercises.type} = ${filters.type}`);
  if (filters.grammarPoint) {
    conditions.push(sql`${exercises.grammarPointKey} = ${filters.grammarPoint}`);
  }

  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      coverageTags: exercises.coverageTags,
    })
    .from(exercises)
    .where(and(...conditions));

  return rows as LoadedRow[];
}
