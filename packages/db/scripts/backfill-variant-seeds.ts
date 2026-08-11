/**
 * `pnpm backfill:variant-seeds` — one-off CLI labelling the approved
 * cloze/translation pool of the `constructionVariants` points with the variant
 * id each row actually realizes. Prerequisite for the PR #631 repass; see
 * docs/superpowers/specs/2026-08-11-variant-seed-backfill-design.md.
 *
 * Writes are keyed on the row's PRIMARY KEY — never on a content pattern. The
 * classifier decides, the dry run shows exactly which ids get which value, and
 * SQL only applies those decisions.
 *
 * Defaults to dry-run; `--apply` writes and additionally requires `--snapshot
 * <neon-branch-id>` or an explicit `--no-snapshot`.
 *
 * Usage:
 *   pnpm backfill:variant-seeds
 *   pnpm backfill:variant-seeds -- --language ES --grammar-point es-b1-que-vs-cual
 *   pnpm backfill:variant-seeds -- --apply --snapshot br-abc123
 *   pnpm backfill:variant-seeds -- --revert backfill-runs/run.json --apply
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import type { ClassifierConfidence, ClassifierRow } from '@language-drill/ai';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

const LANGUAGE_VALUES = new Set<string>(Object.values(Language));
const CEFR_VALUES = new Set<string>(Object.values(CefrLevel));

/** Only these two types ever carry a construction-variant seed. */
const ELIGIBLE_TYPES = new Set<string>([ExerciseType.CLOZE, ExerciseType.TRANSLATION]);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type BackfillArgs = {
  apply: boolean;
  /** Path to a prior run's artifact; restores each entry's oldSeedWord. */
  revertFrom: string | null;
  /** Neon branch id taken as a pre-apply snapshot; recorded in the artifact. */
  snapshot: string | null;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  grammarPoint: string | null;
  minConfidence: 'high' | 'medium';
  limit: number | null;
  batchSize: number;
  concurrency: number;
  maxCostUsd: number;
  name: string;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let revertFrom: string | null = null;
  let snapshot: string | null = null;
  let noSnapshot = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let grammarPoint: string | null = null;
  let minConfidence: 'high' | 'medium' = 'high';
  let limit: number | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;
  let name = 'backfill-variant-seeds';

  const need = (arg: string, next: string | undefined): string => {
    if (next === undefined) throw new Error(`${arg} requires a value`);
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --flag` forwards a bare `--`; the sibling db CLIs
    // all skip it, and CLAUDE.md documents that invocation style.
    if (arg === '--') continue;
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--no-snapshot') noSnapshot = true;
    else if (arg === '--snapshot') snapshot = need(arg, argv[++i]);
    else if (arg === '--revert') revertFrom = need(arg, argv[++i]);
    else if (arg === '--grammar-point') grammarPoint = need(arg, argv[++i]);
    else if (arg === '--name') name = need(arg, argv[++i]);
    else if (arg === '--language' || arg === '--lang') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!LANGUAGE_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${upper}'`);
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!CEFR_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${upper}'`);
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--min-confidence') {
      const v = need(arg, argv[++i]);
      // 'low' is deliberately not accepted: a low-confidence label is exactly
      // the wrong-label case this design treats as worse than no label.
      if (v !== 'high' && v !== 'medium') {
        throw new Error(`--min-confidence: expected high|medium, got '${v}'`);
      }
      minConfidence = v;
    } else if (arg === '--limit' || arg === '--batch-size' || arg === '--concurrency' || arg === '--max-cost-usd') {
      const parsed = Number(need(arg, argv[++i]));
      if (arg === '--max-cost-usd') {
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${arg} must be positive`);
        maxCostUsd = parsed;
      } else {
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`${arg} must be a positive integer, got '${parsed}'`);
        }
        if (arg === '--limit') limit = parsed;
        else if (arg === '--batch-size') batchSize = parsed;
        else concurrency = parsed;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: backfill:variant-seeds [--language ES] [--cefr B1] [--grammar-point <key>]\n' +
          '       [--min-confidence high|medium] [--limit N] [--batch-size 20]\n' +
          '       [--concurrency 4] [--max-cost-usd 5] [--name <run>]\n' +
          '       [--apply --snapshot <neon-branch-id> | --apply --no-snapshot]\n' +
          '       [--revert <artifact.json> --apply]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument '${arg}'`);
    }
  }

  // The forcing function: an --apply run must name its rollback snapshot or
  // explicitly disclaim one. Reverting is exempt — the undo path must not have
  // friction at the moment you need it.
  if (apply && revertFrom === null && snapshot === null && !noSnapshot) {
    throw new Error(
      '--apply requires --snapshot <neon-branch-id> (take a Neon branch off the target first) ' +
        'or an explicit --no-snapshot',
    );
  }

  return {
    apply, revertFrom, snapshot, language, cefrLevel, grammarPoint,
    minConfidence, limit, batchSize, concurrency, maxCostUsd, name,
  };
}

// ---------------------------------------------------------------------------
// Row selection
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  grammarPointKey: string;
  type: ExerciseType;
  language: string;
  difficulty: string;
  contentJson: Record<string, unknown>;
};

/**
 * Whether this row should be classified at all. Three independent guards:
 * the point must declare variants, the type must be one that carries a variant
 * seed, and the row must not already be correctly labelled (which makes the
 * pass resumable and leaves the ~331 already-correct rows alone).
 */
export function isEligible(gp: GrammarPoint, row: CandidateRow): boolean {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return false;
  if (!ELIGIBLE_TYPES.has(row.type)) return false;

  const current = row.contentJson.seedWord;
  if (typeof current === 'string' && variants.some((v) => v.id === current)) return false;

  return true;
}

/**
 * The learner-visible content the classifier judges. Returns null when the row
 * lacks a usable field — sending empty text would invite a confident guess from
 * no evidence.
 */
export function toClassifierRow(row: CandidateRow): ClassifierRow | null {
  const c = row.contentJson;
  if (row.type === ExerciseType.CLOZE) {
    const prompt = c.sentence;
    const answer = c.correctAnswer;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  if (row.type === ExerciseType.TRANSLATION) {
    const prompt = c.sourceText;
    const answer = c.referenceTranslation;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

/** One row's change. `oldSeedWord` is what makes `--revert` possible. */
export type ArtifactEntry = {
  id: string;
  cellKey: string;
  oldSeedWord: string | null;
  newSeedWord: string;
  confidence: ClassifierConfidence;
};

export type Artifact = {
  name: string;
  createdAtIso: string;
  applied: boolean;
  snapshotBranchId: string | null;
  minConfidence: 'high' | 'medium';
  entries: ArtifactEntry[];
};
