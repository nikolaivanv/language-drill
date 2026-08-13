/**
 * `pnpm revalidate:cloze` — one-off CLI to re-route already-stored cloze
 * exercises through the **current** validator (Phase 5 introduced two new
 * gates, `contextSpoilsAnswer` and the lexeme-set rewrite of `ambiguous`).
 * Existing rows in the pool were validated under the older prompt and may
 * still be visible to learners despite being ambiguous ("Sınıfta sekiz ___
 * var") or self-spoiling ("Vowel harmony: front vowel (e) requires -ler
 * suffix"). This script re-scores them and demotes the failures.
 *
 * Scope: `type = 'cloze'` across every (language, cefrLevel). Translation /
 * vocab_recall semantics were untouched by the prompt update, so they would
 * just burn tokens.
 *
 * Demote-only policy — the validator's verdict is allowed to LOWER review
 * status but never RAISE it:
 *
 *   current=auto-approved + new=auto-approved  → no change
 *   current=auto-approved + new=flagged         → write flagged + new reasons
 *   current=auto-approved + new=rejected        → write rejected + new reasons
 *   current=flagged       + new=rejected        → write rejected + new reasons
 *   current=flagged       + new=flagged         → no change (avoid churn)
 *   current=flagged       + new=auto-approved   → no change (never auto-promote)
 *   current=manual-approved                     → SKIPPED (humans decided)
 *   current=rejected                            → SKIPPED (already out)
 *
 * Rows whose `grammarPointKey` no longer resolves in the curriculum are
 * skipped with a logged reason — the validator needs the grammar point to
 * score `grammarPointMatch`.
 *
 * Defaults to dry-run; pass `--apply` to write. The fallback Langfuse path
 * (LANGFUSE_PUBLIC_KEY unset) returns the in-repo prompt template byte-for-
 * byte, so dry-running locally is safe and gives the exact same scoring
 * Lambda would in prod.
 *
 * Narrowing the sweep (a full pass is ~13k rows at ~$0.008/row, and a dry-run
 * costs the same as an apply — only writes are gated):
 *
 *   --grammar-point <key>   repeatable; restricts to a worklist of points
 *   --ids-file <path>       one exercise id per line, `#` comments allowed —
 *                           lets a read-only SQL pre-filter (e.g. "rows that
 *                           still carry a spoiling `context` field") pick the
 *                           rows, so no token is spent on rows that cannot be
 *                           the defect class being chased
 *   --deterministic-only    run ONLY the pure checkers (answer/stem overlap,
 *                           Turkish vowel harmony) — zero LLM calls, $0
 *
 * Usage:
 *   pnpm revalidate:cloze                                 # dry-run, all cloze
 *   pnpm revalidate:cloze --language TR --cefr A1         # narrower
 *   pnpm revalidate:cloze --apply                         # write changes
 *   pnpm revalidate:cloze --limit 100 --concurrency 4     # bounded probe
 *   pnpm revalidate:cloze --apply --max-cost-usd 5
 *   pnpm revalidate:cloze --grammar-point es-b1-superlatives-comparisons --apply
 *   pnpm revalidate:cloze --ids-file ./worklist.txt --apply
 *   pnpm revalidate:cloze --deterministic-only --apply    # free, whole pool
 *
 * (A `--` separator is tolerated — the parser skips it — but not needed.)
 *
 * Required env: DATABASE_URL, plus ANTHROPIC_API_KEY unless
 * `--deterministic-only` is set.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq, inArray } from 'drizzle-orm';

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ValidationResult,
} from '@language-drill/ai';
import {
  CefrLevel,
  ExerciseType,
  Language,
  formatReason,
  type GenerationReason,
} from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { getGrammarPoint } from '../src/curriculum';
import { exercises } from '../src/schema';
import type { ReviewStatus } from '../src/generation/routing';
import {
  decideDemotion,
  decideDeterministicDemotion,
  reconstructDraftAndSpec,
  type CandidateRow,
  type DemotionAction,
  type SkipReason,
} from '../src/generation/revalidation';

import { pLimit } from './p-limit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type RevalidateArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  grammarPoints: string[];
  idsFile: string | null;
  deterministicOnly: boolean;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse an `--ids-file` body: one exercise id per line, blank lines and `#`
 * comments ignored, duplicates collapsed.
 *
 * Non-UUID lines throw rather than being dropped — the whole point of the flag
 * is that a read-only SQL query picked these rows, so a malformed line means
 * the worklist is not what the operator thinks it is. Silently selecting fewer
 * rows would read as "nothing to do".
 */
/**
 * Where to look for an `--ids-file`, in order.
 *
 * `pnpm --filter @language-drill/db revalidate:cloze` runs the script with cwd
 * `packages/db`, so a path copied from the docs (`docs/analysis/…`) is
 * repo-relative and would ENOENT. Try the literal (cwd-relative) path first,
 * then the same path from the repo root; an absolute path is used as given.
 */
export function idsFileCandidates(
  rawPath: string,
  cwd: string,
  repoRoot: string,
): string[] {
  if (path.isAbsolute(rawPath)) return [rawPath];
  const fromCwd = path.resolve(cwd, rawPath);
  const fromRoot = path.resolve(repoRoot, rawPath);
  return fromCwd === fromRoot ? [fromCwd] : [fromCwd, fromRoot];
}

/** Repo root, from `<root>/packages/db/scripts/` — three levels up. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Read an `--ids-file` from the first candidate that exists, or fail naming
 * every path tried — a bare ENOENT stack does not tell the operator that the
 * script's cwd is `packages/db`, not the repo root.
 */
function readIdsFile(rawPath: string): string {
  const candidates = idsFileCandidates(rawPath, process.cwd(), REPO_ROOT);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `--ids-file '${rawPath}' not found. Tried:\n` +
        candidates.map((candidate) => `  ${candidate}`).join('\n'),
    );
  }
  return readFileSync(found, 'utf8');
}

export function parseIdsFile(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!UUID_RE.test(line)) {
      throw new Error(`--ids-file line ${index + 1} is not a UUID: '${line}'`);
    }
    const id = line.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) {
    throw new Error('--ids-file contained no ids');
  }
  return ids;
}

export function parseRevalidateArgs(argv: readonly string[]): RevalidateArgs {
  let apply = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  const grammarPoints: string[] = [];
  let idsFile: string | null = null;
  let deterministicOnly = false;
  let limit: number | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      apply = false;
    } else if (arg === '--language' || arg === '--lang') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!LANGUAGE_VALUES.has(upper as Language)) {
        throw new Error(
          `${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${next}'`,
        );
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!CEFR_VALUES.has(upper as CefrLevel)) {
        throw new Error(
          `${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${next}'`,
        );
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--grammar-point') {
      // Validated like --language/--cefr: an unvalidated key silently selects
      // zero rows, which reads as "nothing to do" rather than "you typo'd".
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      if (!getGrammarPoint(next)) {
        throw new Error(`${arg}: unknown grammar point '${next}'`);
      }
      if (!grammarPoints.includes(next)) grammarPoints.push(next);
    } else if (arg === '--ids-file') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      idsFile = next;
    } else if (arg === '--deterministic-only') {
      deterministicOnly = true;
    } else if (arg === '--limit') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--limit requires a value');
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive integer, got ${next}`);
      }
      limit = parsed;
    } else if (arg === '--concurrency') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--concurrency requires a value');
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--concurrency must be a positive integer, got ${next}`);
      }
      concurrency = parsed;
    } else if (arg === '--max-cost-usd') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--max-cost-usd requires a value');
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
          `--max-cost-usd must be a positive number, got ${next}`,
        );
      }
      maxCostUsd = parsed;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return {
    apply,
    language,
    cefrLevel,
    grammarPoints,
    idsFile,
    deterministicOnly,
    limit,
    concurrency,
    maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

/**
 * A candidate plus its stored `flagged_reasons`. The deterministic pass has no
 * fresh verdict to regenerate reasons from, so it must carry the existing ones
 * forward instead of overwriting them.
 */
type Candidate = CandidateRow & { flaggedReasons: GenerationReason[] | null };

async function fetchCandidates(
  db: Db,
  args: RevalidateArgs,
  ids: readonly string[] | null,
): Promise<Candidate[]> {
  const filters = [
    eq(exercises.type, ExerciseType.CLOZE),
    inArray(exercises.reviewStatus, ['auto-approved', 'flagged']),
  ];
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));
  if (args.grammarPoints.length > 0) {
    filters.push(inArray(exercises.grammarPointKey, args.grammarPoints));
  }
  if (ids) filters.push(inArray(exercises.id, [...ids]));

  const query = db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
      grammarPointKey: exercises.grammarPointKey,
      topicDomain: exercises.topicDomain,
      modelId: exercises.modelId,
      reviewStatus: exercises.reviewStatus,
      flaggedReasons: exercises.flaggedReasons,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as Candidate[];
}

/**
 * `qualityScore` is written only when a fresh verdict produced one. A
 * deterministic demotion has no score to write, and clobbering the stored one
 * would erase the last real measurement.
 */
async function applyDemotion(
  db: Db,
  rowId: string,
  action: Extract<DemotionAction, { kind: 'demote' }>,
  qualityScore: number | null,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      reviewStatus: action.to,
      flaggedReasons: action.reasons,
      ...(qualityScore !== null ? { qualityScore } : {}),
      ...(action.to === 'rejected' ? { demotionReason: 'quality' as const } : {}),
    })
    .where(eq(exercises.id, rowId));
}

/**
 * Write a demotion (when `--apply`) and turn it into the outcome to report.
 * A failed write degrades to a logged skip rather than being reported as a
 * demotion that never happened. `result` is null on the deterministic pass.
 */
async function persistDemotion(
  db: Db,
  row: Candidate,
  action: Extract<DemotionAction, { kind: 'demote' }>,
  result: ValidationResult | null,
  apply: boolean,
): Promise<Outcome> {
  if (apply) {
    try {
      await applyDemotion(db, row.id, action, result?.qualityScore ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[update-failed] ${row.id}: ${message}\n`);
      return {
        kind: 'skip',
        row,
        reason: 'malformed-content-json',
        detail: `update failed: ${message}`,
      };
    }
  }
  return { kind: 'demote', row, action, result };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'no-change'; row: Candidate }
  // `result` is null for a deterministic demotion — no LLM verdict was produced.
  | { kind: 'demote'; row: Candidate; action: Extract<DemotionAction, { kind: 'demote' }>; result: ValidationResult | null }
  | { kind: 'skip'; row: Candidate; reason: SkipReason | 'manual-approved' | 'rejected'; detail?: string };

function printSummary(outcomes: readonly Outcome[], usage: ClaudeUsageBreakdown, args: RevalidateArgs): void {
  const noChange = outcomes.filter((o) => o.kind === 'no-change').length;
  const demoteToFlagged = outcomes.filter(
    (o) => o.kind === 'demote' && o.action.to === 'flagged',
  ).length;
  const demoteToRejected = outcomes.filter(
    (o) => o.kind === 'demote' && o.action.to === 'rejected',
  ).length;
  const skipped = outcomes.filter((o) => o.kind === 'skip').length;

  process.stdout.write('\n=== Revalidation summary ===\n');
  process.stdout.write(`  rows scanned:      ${outcomes.length}\n`);
  process.stdout.write(`  no change:         ${noChange}\n`);
  process.stdout.write(`  demote → flagged:  ${demoteToFlagged}\n`);
  process.stdout.write(`  demote → rejected: ${demoteToRejected}\n`);
  process.stdout.write(`  skipped:           ${skipped}\n`);
  process.stdout.write(
    `  tokens:            input=${usage.inputTokens.toLocaleString()} ` +
      `cache_read=${usage.cacheReadInputTokens.toLocaleString()} ` +
      `cache_create=${usage.cacheCreationInputTokens.toLocaleString()} ` +
      `output=${usage.outputTokens.toLocaleString()}\n`,
  );
  process.stdout.write(`  estimated cost:    $${estimateCostUsd(usage).toFixed(4)}\n`);
  process.stdout.write(
    `  pass:              ${args.deterministicOnly ? 'DETERMINISTIC-ONLY (no LLM calls)' : 'LLM validator + deterministic checks'}\n`,
  );
  process.stdout.write(`  mode:              ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}\n`);

  if (demoteToFlagged + demoteToRejected > 0) {
    process.stdout.write('\nDemotions:\n');
    for (const o of outcomes) {
      if (o.kind !== 'demote') continue;
      const reasons =
        o.action.reasons.length > 0
          ? o.action.reasons.map(formatReason).join('; ')
          : '(no reasons)';
      const qs =
        o.result === null ? 'n/a' : o.result.qualityScore.toFixed(2);
      process.stdout.write(
        `  ${o.row.id}  ${o.row.language}/${o.row.difficulty}  ` +
          `${o.action.from} → ${o.action.to}  qs=${qs}  ${reasons}\n`,
      );
    }
  }
  if (skipped > 0) {
    const skipReasons = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind !== 'skip') continue;
      skipReasons.set(o.reason, (skipReasons.get(o.reason) ?? 0) + 1);
    }
    process.stdout.write('\nSkip reasons:\n');
    for (const [reason, count] of skipReasons) {
      process.stdout.write(`  ${reason}: ${count}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseRevalidateArgs(process.argv.slice(2));

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  // The deterministic pass never calls Claude, so it must not demand a key.
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (!anthropicKey && !args.deterministicOnly) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const ids = args.idsFile ? parseIdsFile(readIdsFile(args.idsFile)) : null;

  const db = createDb(databaseUrl);
  const client = anthropicKey ? createClaudeClient(anthropicKey) : null;

  process.stdout.write(
    `Filters: type=cloze` +
      `${args.language ? ` language=${args.language}` : ''}` +
      `${args.cefrLevel ? ` cefr=${args.cefrLevel}` : ''}` +
      `${args.grammarPoints.length > 0 ? ` grammar-point=${args.grammarPoints.join(',')}` : ''}` +
      `${ids ? ` ids-file=${args.idsFile} (${ids.length} ids)` : ''}` +
      `${args.limit !== null ? ` limit=${args.limit}` : ''}` +
      `${args.deterministicOnly ? ' deterministic-only' : ''}\n`,
  );

  const candidates = await fetchCandidates(db, args, ids);
  if (candidates.length === 0) {
    process.stdout.write('No matching rows.\n');
    return;
  }
  process.stdout.write(`Found ${candidates.length} candidate rows.\n`);

  const limit = pLimit(args.concurrency);
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  const outcomes: Outcome[] = [];
  let costStopped = false;

  await Promise.all(
    candidates.map((row, idx) =>
      limit(async () => {
        if (costStopped) {
          outcomes[idx] = { kind: 'skip', row, reason: 'rejected', detail: 'cost-cap reached' };
          return;
        }

        const recon = reconstructDraftAndSpec(row, ExerciseType.CLOZE);
        if (!recon.ok) {
          outcomes[idx] = { kind: 'skip', row, reason: recon.reason, detail: recon.detail };
          return;
        }

        // `client === null` is only reachable under --deterministic-only (the
        // env guard above), and narrows `client` for the LLM branch below.
        //
        // The deterministic checkers need only (content, language), but this
        // pass still goes through `reconstructDraftAndSpec` so both passes
        // share one skip taxonomy. Consequence: a row whose grammar point no
        // longer resolves is skipped here too, even though the overlap checker
        // could have scored it. That is a handful of rows pool-wide.
        if (args.deterministicOnly || client === null) {
          const action = decideDeterministicDemotion(
            row.reviewStatus as ReviewStatus,
            recon.draft.contentJson,
            recon.spec.language,
            row.flaggedReasons ?? [],
          );
          if (action.kind === 'skip') {
            outcomes[idx] = { kind: 'skip', row, reason: action.reason };
            return;
          }
          if (action.kind === 'no-change') {
            outcomes[idx] = { kind: 'no-change', row };
            return;
          }
          outcomes[idx] = await persistDemotion(db, row, action, null, args.apply);
          return;
        }

        let result: ValidationResult;
        let callUsage: ClaudeUsageBreakdown;
        try {
          const r = await validateDraft(client, recon.draft, recon.spec);
          result = r.result;
          callUsage = r.tokenUsage;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes[idx] = {
            kind: 'skip',
            row,
            reason: 'malformed-content-json',
            detail: `validator threw: ${message}`,
          };
          return;
        }

        usage = addUsage(usage, callUsage);
        if (estimateCostUsd(usage) > args.maxCostUsd) {
          costStopped = true;
          process.stderr.write(
            `\n[cost-cap] estimated cost ($${estimateCostUsd(usage).toFixed(4)}) > --max-cost-usd ($${args.maxCostUsd.toFixed(2)}); stopping new validator calls.\n`,
          );
        }

        const action = decideDemotion(
          row.reviewStatus as ReviewStatus,
          result,
          recon.draft.contentJson,
          (row.language ?? undefined) as Language | undefined,
        );
        if (action.kind === 'skip') {
          outcomes[idx] = { kind: 'skip', row, reason: action.reason };
          return;
        }
        if (action.kind === 'no-change') {
          outcomes[idx] = { kind: 'no-change', row };
          return;
        }

        outcomes[idx] = await persistDemotion(db, row, action, result, args.apply);
      }),
    ),
  );

  // Promise.all preserves order via the index map above; compact any sparse
  // entries (none expected — every branch writes outcomes[idx]).
  const compacted = outcomes.filter((o): o is Outcome => o !== undefined);
  printSummary(compacted, usage, args);
}

// Skip auto-execution when this module is imported by tests.
const invokedDirectly = process.argv[1]
  ? import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1])
  : false;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
