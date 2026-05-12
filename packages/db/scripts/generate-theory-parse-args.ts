/**
 * Pure CLI argument parser for `pnpm generate:theory`.
 *
 * Parses argv into a typed `ParsedTheoryArgs` object, applies defaults,
 * validates inputs, and prints `--help` when requested. No process spawn, no
 * I/O — the function is fully testable from a vitest unit.
 *
 * Structural mirror of `generate-exercises-parse-args.ts`. Theory generation
 * has no `--type` / `--count` / `--queue` / `--topic-domain` axes — it
 * produces one explainer per (lang, level, grammar-point) cell — so those
 * flags are intentionally absent.
 *
 * The CLI surface is documented in spec
 * `.claude/specs/theory-generation-phase-2/requirements.md` §Requirement 6.
 */

import { type LearningLanguage } from '@language-drill/shared';

import type { CurriculumCefrLevel } from '../src/curriculum';
import { collectRawFlags, requireString } from './parse-args-common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedTheoryArgs = {
  lang: LearningLanguage;
  level: CurriculumCefrLevel | 'all';
  grammarPoint: string | null;
  batchSeed: string;
  maxCostUsd: number;
  concurrency: number;
  dryRun: boolean;
  allowProd: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_LANGUAGES: ReadonlySet<string> = new Set(['ES', 'DE', 'TR']);
const CURRICULUM_LEVELS: ReadonlySet<string> = new Set(['A1', 'A2', 'B1', 'B2']);

const DEFAULT_BATCH_SEED = 'theory-v1';
const DEFAULT_MAX_COST_USD = 1.0;

const DEFAULT_CONCURRENCY = 1;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

const HELP_TEXT = `pnpm generate:theory — fill the theory_content pool with Claude-generated grammar explainers.

Usage:
  pnpm generate:theory --lang <ES|DE|TR> [options]

Required flags:
  --lang <ES|DE|TR>            Target learning language. EN is rejected — it is
                               source-only for theory generation (resolved
                               decision #5).

Optional flags:
  --level <A1|A2|B1|B2|all>    Target CEFR level. Default: all (runs every
                               curriculum level for the language).
  --grammar-point <key>        Single curriculum entry to scope generation to
                               (e.g. es-b1-present-subjunctive). Default: null
                               (runs all curriculum points matching --level).
  --batch-seed <string>        Bump to regenerate a filled cell with a fresh
                               draft. Default: '${DEFAULT_BATCH_SEED}'.
  --max-cost-usd <number>      Hard cap on total spend (must be > 0).
                               Default: ${DEFAULT_MAX_COST_USD}.
  --concurrency <int>          Cells in parallel. Range [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}]. Default: ${DEFAULT_CONCURRENCY}.
  --dry-run                    Print resolved cells + cost estimate; no DB or
                               Claude calls.
  --allow-prod                 Required when NODE_ENV=production. The Phase 4
                               Lambda is the supported prod path.
  --help                       Print this help and exit 0.

Environment:
  ANTHROPIC_API_KEY            Required unless MOCK_CLAUDE=1.
  DATABASE_URL                 Required — Neon connection string.
  MOCK_CLAUDE=1                Bypass Claude calls; emit deterministic stub
                               drafts for local testing.

Example:
  pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive
`;

// ---------------------------------------------------------------------------
// parseTheoryGenerateArgs
// ---------------------------------------------------------------------------

export function parseTheoryGenerateArgs(
  argv: readonly string[],
): ParsedTheoryArgs {
  if (argv.includes('--help')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const raw = collectRawFlags(argv);

  // Required flags ----------------------------------------------------------

  const langRaw = requireString(raw, 'lang').toUpperCase();
  if (langRaw === 'EN') {
    throw new Error(
      '--lang en is not a learning language for theory generation (resolved decision #5). Use es | de | tr.',
    );
  }
  if (!LEARNING_LANGUAGES.has(langRaw)) {
    throw new Error(`--lang must be one of ES, DE, TR (got '${langRaw}')`);
  }
  const lang = langRaw as LearningLanguage;

  // Optional flags ----------------------------------------------------------

  const level = parseLevelFlag(raw.get('level'));
  const grammarPoint = raw.get('grammar-point') ?? null;
  const batchSeed = raw.get('batch-seed') ?? DEFAULT_BATCH_SEED;
  const maxCostUsd = parseMaxCostUsd(raw.get('max-cost-usd'));
  const concurrency = parseConcurrency(raw.get('concurrency'));
  const dryRun = raw.get('dry-run') === 'true';
  const allowProd = raw.get('allow-prod') === 'true';

  // Warnings (non-fatal) ----------------------------------------------------

  if (allowProd && process.env['NODE_ENV'] !== 'production') {
    process.stderr.write('--allow-prod ignored: not running in production\n');
  }

  return {
    lang,
    level,
    grammarPoint,
    batchSeed,
    maxCostUsd,
    concurrency,
    dryRun,
    allowProd,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseLevelFlag(
  raw: string | undefined,
): CurriculumCefrLevel | 'all' {
  if (raw === undefined) return 'all';
  const levelRaw = raw.toUpperCase();
  if (levelRaw === 'ALL') return 'all';
  if (!CURRICULUM_LEVELS.has(levelRaw)) {
    throw new Error(
      `--level must be one of A1, A2, B1, B2, all (got '${raw}')`,
    );
  }
  return levelRaw as CurriculumCefrLevel;
}

function parseMaxCostUsd(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_COST_USD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--max-cost-usd must be > 0 (got '${raw}')`);
  }
  return parsed;
}

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`--concurrency must be an integer (got '${raw}')`);
  }
  if (parsed < MIN_CONCURRENCY || parsed > MAX_CONCURRENCY) {
    throw new Error(
      `--concurrency must be in [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}] (got ${parsed})`,
    );
  }
  return parsed;
}
