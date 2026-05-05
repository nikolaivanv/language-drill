/**
 * Pure CLI argument parser for `pnpm generate:exercises`.
 *
 * Parses argv into a typed `ParsedArgs` object, applies defaults, validates
 * inputs, and prints `--help` when requested. No process spawn, no I/O — the
 * function is fully testable from a vitest unit.
 *
 * The CLI surface is documented in spec
 * `.claude/specs/exercise-generation-phase-2/requirements.md` §Requirement 4.
 */

import { ExerciseType, type LearningLanguage } from '@language-drill/shared';

import type { CurriculumCefrLevel } from '../src/curriculum';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedArgs = {
  lang: LearningLanguage;
  level: CurriculumCefrLevel;
  type: ExerciseType | 'all';
  grammarPoint: string | null;
  count: number;
  topicDomain: string | null;
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
const EXERCISE_TYPES: ReadonlySet<string> = new Set(Object.values(ExerciseType));

const DEFAULT_COUNT = 50;
const MIN_COUNT = 1;
const MAX_COUNT = 200;

const DEFAULT_BATCH_SEED = 'phase-2-default';
const DEFAULT_MAX_COST_USD = 5;

const DEFAULT_CONCURRENCY = 1;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

const HELP_TEXT = `pnpm generate:exercises — fill the exercise pool with Claude-generated drafts.

Usage:
  pnpm generate:exercises --lang <ES|DE|TR> --level <A1|A2|B1|B2> [options]

Required flags:
  --lang <ES|DE|TR>            Target learning language. EN is rejected — it is
                               source-only (resolved decision #4).
  --level <A1|A2|B1|B2>        Target CEFR level.

Optional flags:
  --type <cloze|translation|vocab_recall>
                               Exercise type. Default: all (runs all three types).
  --grammar-point <key>        Single curriculum entry to scope generation to.
                               Requires --type to be set to a concrete type.
                               Default: null (runs all matching cells).
  --count <int>                Drafts per cell. Range [${MIN_COUNT}, ${MAX_COUNT}]. Default: ${DEFAULT_COUNT}.
  --topic-domain <string>      Recorded on rows for forward-compat; prompts
                               are domain-agnostic in Phase 2. Default: null.
  --batch-seed <string>        Bump to add another N drafts to a filled cell.
                               Default: '${DEFAULT_BATCH_SEED}'.
  --max-cost-usd <number>      Hard cap on total spend (must be > 0).
                               Default: ${DEFAULT_MAX_COST_USD}.
  --concurrency <int>          Cells in parallel. Range [${MIN_CONCURRENCY}, ${MAX_CONCURRENCY}]. Default: ${DEFAULT_CONCURRENCY}.
                               Values > 1 share rate-limit budget with the live
                               evaluator; prefer off-hours.
  --dry-run                    Print resolved cells + cost estimate; no DB or
                               Claude calls.
  --allow-prod                 Required when NODE_ENV=production. The Phase 4
                               Lambda is the supported prod path.
  --help                       Print this help and exit 0.

Example:
  pnpm generate:exercises --lang es --level B1 --type cloze \\
    --grammar-point es-b1-present-subjunctive --count 50
`;

// ---------------------------------------------------------------------------
// parseGenerateArgs
// ---------------------------------------------------------------------------

export function parseGenerateArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes('--help')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const raw = collectRawFlags(argv);

  // Required flags ----------------------------------------------------------

  const langRaw = requireString(raw, 'lang').toUpperCase();
  if (langRaw === 'EN') {
    throw new Error(
      "--lang en is not a learning language for generation (resolved decision #4 in docs/exercise-generation-plan.md). Use es | de | tr.",
    );
  }
  if (!LEARNING_LANGUAGES.has(langRaw)) {
    throw new Error(`--lang must be one of ES, DE, TR (got '${langRaw}')`);
  }
  const lang = langRaw as LearningLanguage;

  const levelRaw = requireString(raw, 'level').toUpperCase();
  if (!CURRICULUM_LEVELS.has(levelRaw)) {
    throw new Error(`--level must be one of A1, A2, B1, B2 (got '${levelRaw}')`);
  }
  const level = levelRaw as CurriculumCefrLevel;

  // Optional flags ----------------------------------------------------------

  const type = parseTypeFlag(raw.get('type'));
  const grammarPoint = raw.get('grammar-point') ?? null;
  const count = parseCount(raw.get('count'));
  const topicDomain = raw.get('topic-domain') ?? null;
  const batchSeed = raw.get('batch-seed') ?? DEFAULT_BATCH_SEED;
  const maxCostUsd = parseMaxCostUsd(raw.get('max-cost-usd'));
  const concurrency = parseConcurrency(raw.get('concurrency'));
  const dryRun = raw.get('dry-run') === 'true';
  const allowProd = raw.get('allow-prod') === 'true';

  // Cross-flag validation ---------------------------------------------------

  if (grammarPoint !== null && type === 'all') {
    throw new Error(
      "you must scope --type when generating against a single grammar point (e.g. --type cloze)",
    );
  }

  // Warnings (non-fatal) ----------------------------------------------------

  if (allowProd && process.env['NODE_ENV'] !== 'production') {
    process.stderr.write('--allow-prod ignored: not running in production\n');
  }

  if (concurrency > 1) {
    process.stderr.write(
      `Warning: --concurrency ${concurrency} shares rate-limit budget with the live evaluator. Consider running off-hours.\n`,
    );
  }

  return {
    lang,
    level,
    type,
    grammarPoint,
    count,
    topicDomain,
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

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['dry-run', 'allow-prod', 'help']);

function collectRawFlags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument '${token}'`);
    }

    const eqIdx = token.indexOf('=');
    let name: string;
    let value: string | undefined;

    if (eqIdx >= 0) {
      name = token.slice(2, eqIdx);
      value = token.slice(eqIdx + 1);
    } else {
      name = token.slice(2);
      value = undefined;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      out.set(name, 'true');
      continue;
    }

    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${name} requires a value`);
      }
      value = next;
      i++;
    }

    out.set(name, value);
  }

  return out;
}

function requireString(raw: Map<string, string>, name: string): string {
  const value = raw.get(name);
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parseTypeFlag(raw: string | undefined): ExerciseType | 'all' {
  if (raw === undefined) return 'all';
  if (raw === 'all') return 'all';
  if (!EXERCISE_TYPES.has(raw)) {
    throw new Error(
      `--type must be one of cloze, translation, vocab_recall, all (got '${raw}')`,
    );
  }
  return raw as ExerciseType;
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_COUNT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`--count must be an integer (got '${raw}')`);
  }
  if (parsed < MIN_COUNT || parsed > MAX_COUNT) {
    throw new Error(`--count must be in [${MIN_COUNT}, ${MAX_COUNT}] (got ${parsed})`);
  }
  return parsed;
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

