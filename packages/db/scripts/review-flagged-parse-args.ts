/**
 * Pure CLI argument parser for `pnpm review:flagged`.
 *
 * Parses argv into a typed `ReviewArgs` object, applies defaults, validates
 * inputs, and prints `--help` when requested. No process spawn, no I/O — the
 * function is fully testable from a vitest unit.
 *
 * The CLI surface is documented in spec
 * `.claude/specs/exercise-generation-phase-3/requirements.md` §Requirement 6.
 */

import { CefrLevel, ExerciseType, type LearningLanguage } from '@language-drill/shared';

import { collectRawFlags, requireString } from './parse-args-common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewArgs = {
  lang: LearningLanguage;
  level: CefrLevel | null;
  type: ExerciseType | null;
  grammarPoint: string | null;
  limit: number;
  allowProd: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_LANGUAGES: ReadonlySet<string> = new Set(['ES', 'DE', 'TR']);
const CEFR_LEVELS: ReadonlySet<string> = new Set(Object.values(CefrLevel));
const EXERCISE_TYPES: ReadonlySet<string> = new Set(Object.values(ExerciseType));

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

const HELP_TEXT = `pnpm review:flagged — walk the flagged-exercise queue interactively.

Usage:
  pnpm review:flagged --lang <ES|DE|TR> [options]

Required flags:
  --lang <ES|DE|TR>            Target learning language. EN is rejected — it is
                               source-only (resolved decision #4).

Optional flags:
  --level <A1|A2|B1|B2|C1|C2>  Restrict to one CEFR level. Default: every level.
  --type <cloze|translation|vocab_recall>
                               Restrict to one exercise type. Default: every type.
  --grammar-point <key>        Restrict to one curriculum grammar-point key.
                               Default: every grammar point in the slice.
  --limit <int>                Cap rows pulled per invocation. Range
                               [${MIN_LIMIT}, ${MAX_LIMIT}]. Default: ${DEFAULT_LIMIT}.
  --allow-prod                 Required when NODE_ENV=production. The Phase 5
                               admin UI is the supported prod path.
  --help                       Print this help and exit 0.

Interactive keys: [a]pprove / [r]eject / [s]kip / [q]uit

Example:
  pnpm review:flagged --lang es --level B1 --type cloze \\
    --grammar-point es-b1-present-subjunctive --limit 10
`;

// ---------------------------------------------------------------------------
// parseReviewArgs
// ---------------------------------------------------------------------------

export function parseReviewArgs(argv: readonly string[]): ReviewArgs {
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

  // Optional flags ----------------------------------------------------------

  const level = parseLevelFlag(raw.get('level'));
  const type = parseTypeFlag(raw.get('type'));
  const grammarPoint = raw.get('grammar-point') ?? null;
  const limit = parseLimit(raw.get('limit'));
  const allowProd = raw.get('allow-prod') === 'true';

  // Warnings (non-fatal) ----------------------------------------------------

  if (allowProd && process.env['NODE_ENV'] !== 'production') {
    process.stderr.write('--allow-prod ignored: not running in production\n');
  }

  return {
    lang,
    level,
    type,
    grammarPoint,
    limit,
    allowProd,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseLevelFlag(raw: string | undefined): CefrLevel | null {
  if (raw === undefined) return null;
  const upper = raw.toUpperCase();
  if (!CEFR_LEVELS.has(upper)) {
    throw new Error(
      `--level must be one of A1, A2, B1, B2, C1, C2 (got '${raw}')`,
    );
  }
  return upper as CefrLevel;
}

function parseTypeFlag(raw: string | undefined): ExerciseType | null {
  if (raw === undefined) return null;
  if (!EXERCISE_TYPES.has(raw)) {
    throw new Error(
      `--type must be one of cloze, translation, vocab_recall (got '${raw}')`,
    );
  }
  return raw as ExerciseType;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`--limit must be an integer (got '${raw}')`);
  }
  if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
    throw new Error(`--limit must be in [${MIN_LIMIT}, ${MAX_LIMIT}] (got ${parsed})`);
  }
  return parsed;
}
