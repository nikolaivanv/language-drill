/**
 * Pure CLI argument parser for `pnpm review:flagged-theory`.
 *
 * Parses argv into a typed `TheoryReviewArgs` object, applies defaults,
 * validates inputs, and prints `--help` when requested. No process spawn,
 * no I/O — the function is fully testable from a vitest unit.
 *
 * Structural mirror of `review-flagged-parse-args.ts` (the exercise-side
 * parser) minus the `--type` flag (theory has no per-type fan-out) and
 * with a narrower `--level` range: theory pages stop at B2 (curriculum
 * coverage ceiling), so C1/C2 are explicitly rejected here.
 *
 * The CLI surface is documented in spec
 * `.claude/specs/theory-generation-phase-3/requirements.md` §Requirement 5.
 */

import type {
  CurriculumCefrLevel,
  LearningLanguage,
} from '@language-drill/shared';

import { collectRawFlags, requireString } from './parse-args-common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TheoryReviewArgs = {
  lang: LearningLanguage;
  level: CurriculumCefrLevel | null;
  grammarPoint: string | null;
  limit: number;
  allowProd: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_LANGUAGES: ReadonlySet<string> = new Set(['ES', 'DE', 'TR']);
const THEORY_CEFR_LEVELS: ReadonlySet<string> = new Set([
  'A1',
  'A2',
  'B1',
  'B2',
]);

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

const HELP_TEXT = `pnpm review:flagged-theory — walk the flagged-theory queue interactively.

Usage:
  pnpm review:flagged-theory --lang <ES|DE|TR> [options]

Required flags:
  --lang <ES|DE|TR>            Target learning language. EN is rejected — it
                               is the metalanguage, not a theory subject.

Optional flags:
  --level <A1|A2|B1|B2>        Restrict to one CEFR level. Default: every
                               level. C1/C2 are rejected — theory curriculum
                               stops at B2.
  --grammar-point <key>        Restrict to one curriculum grammar-point key.
                               Default: every grammar point in the slice.
  --limit <int>                Cap rows pulled per invocation. Range
                               [${MIN_LIMIT}, ${MAX_LIMIT}]. Default: ${DEFAULT_LIMIT}.
  --allow-prod                 Required when NODE_ENV=production. The Phase 5
                               admin UI is the supported prod path.
  --help                       Print this help and exit 0.

Interactive keys: [a]pprove / [r]eject / [s]kip / [q]uit

Example:
  pnpm review:flagged-theory --lang es --level B1
`;

// ---------------------------------------------------------------------------
// parseTheoryReviewArgs
// ---------------------------------------------------------------------------

export function parseTheoryReviewArgs(
  argv: readonly string[],
): TheoryReviewArgs {
  if (argv.includes('--help')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const raw = collectRawFlags(argv);

  // Required flags ----------------------------------------------------------

  const langRaw = requireString(raw, 'lang').toUpperCase();
  if (langRaw === 'EN') {
    throw new Error(
      '--lang en is not a learning language. Use es | de | tr.',
    );
  }
  if (!LEARNING_LANGUAGES.has(langRaw)) {
    throw new Error(`--lang must be one of ES, DE, TR (got '${langRaw}')`);
  }
  const lang = langRaw as LearningLanguage;

  // Optional flags ----------------------------------------------------------

  const level = parseLevelFlag(raw.get('level'));
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
    grammarPoint,
    limit,
    allowProd,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseLevelFlag(
  raw: string | undefined,
): CurriculumCefrLevel | null {
  if (raw === undefined) return null;
  const upper = raw.toUpperCase();
  if (!THEORY_CEFR_LEVELS.has(upper)) {
    throw new Error(
      `--level must be one of A1, A2, B1, B2 (got '${raw}'). Theory curriculum stops at B2.`,
    );
  }
  return upper as CurriculumCefrLevel;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`--limit must be an integer (got '${raw}')`);
  }
  if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
    throw new Error(
      `--limit must be in [${MIN_LIMIT}, ${MAX_LIMIT}] (got ${parsed})`,
    );
  }
  return parsed;
}
