/**
 * `pnpm review:flagged-theory` — interactive review CLI for flagged
 * theory pages.
 *
 * Walks the flagged-theory queue one row at a time. Each row prints (via
 * `theoryTopicJsonToText` from Task 13), then a single keystroke advances:
 * `a` approve, `r` reject, `s` skip, `q` quit. Every UPDATE carries
 * `AND review_status = 'flagged'` so a concurrent state change (another
 * reviewer, the Phase 4 Lambda) just no-ops the statement instead of
 * clobbering existing state.
 *
 * Task 17 lands the DB helpers (select / count / render / write). Task 18
 * adds the `main()` driver + summary printer.
 *
 * Structural mirror of `review-flagged.ts` (exercise side). Deltas:
 *   - No `--type` predicate (theory has no per-type fan-out).
 *   - Plain-text renderer via `theoryTopicJsonToText` instead of
 *     `JSON.stringify(contentJson, null, 2)` — theory's deep tree is
 *     unreadable as raw JSON; the plain-text form is what reviewers scan.
 *   - `tryApproveTheory` runs against `theory_topics`, not `exercises`.
 */

import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { type SQL, and, asc, count, eq } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { theoryTopics } from '../src/schema/index';

import {
  parseTheoryTopicJson,
  type TheoryTopicJson,
} from '@language-drill/shared';

import { requireEnv } from './env-helpers';
import {
  createKeystrokeReader,
  isUniqueViolation,
} from './review-flagged';
import {
  parseTheoryReviewArgs,
  type TheoryReviewArgs,
} from './review-flagged-theory-parse-args';
import { theoryTopicJsonToText } from './theory-json-to-text';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Subset of `theory_topics` columns the review CLI reads. Mirrors the
 * exercise-side `FlaggedRow` shape minus the `difficulty` / `type` /
 * `_dedupKey` columns and with `contentJson` typed to the JSONB generic
 * Drizzle infers from `$type<TheoryTopicJson>()`.
 */
export type FlaggedTheoryRow = {
  id: string;
  language: string;
  cefrLevel: string;
  grammarPointKey: string;
  topicId: string;
  contentJson: TheoryTopicJson;
  qualityScore: number | null;
  flaggedReasons: unknown;
  generatedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Slice predicate
// ---------------------------------------------------------------------------

/**
 * Build the `WHERE` predicate shared by `selectFlaggedTheoryRows` and
 * `countFlaggedTheory`:
 *   review_status = 'flagged' AND (slice filters from `args`)
 *
 * Only includes a predicate for fields that are non-null on `args`, so an
 * unscoped `--lang es` walks every level + grammar-point combination.
 */
function flaggedTheorySlicePredicate(args: TheoryReviewArgs): SQL {
  const conditions: SQL[] = [
    eq(theoryTopics.reviewStatus, 'flagged'),
    eq(theoryTopics.language, args.lang),
  ];

  if (args.level !== null) {
    conditions.push(eq(theoryTopics.cefrLevel, args.level));
  }
  if (args.grammarPoint !== null) {
    conditions.push(eq(theoryTopics.grammarPointKey, args.grammarPoint));
  }

  // `and(...)` returns `SQL | undefined` only when called with zero args;
  // we always pass at least two (review_status + language).
  return and(...conditions)!;
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

/**
 * Pull the slice of flagged theory rows matching `args`, oldest first,
 * capped at `args.limit`. Pure read — the reviewer's first keystroke is
 * the gate for any state change (Req 5.2).
 */
export async function selectFlaggedTheoryRows(
  db: Db,
  args: TheoryReviewArgs,
): Promise<FlaggedTheoryRow[]> {
  const rows = await db
    .select({
      id: theoryTopics.id,
      language: theoryTopics.language,
      cefrLevel: theoryTopics.cefrLevel,
      grammarPointKey: theoryTopics.grammarPointKey,
      topicId: theoryTopics.topicId,
      contentJson: theoryTopics.contentJson,
      qualityScore: theoryTopics.qualityScore,
      flaggedReasons: theoryTopics.flaggedReasons,
      generatedAt: theoryTopics.generatedAt,
    })
    .from(theoryTopics)
    .where(flaggedTheorySlicePredicate(args))
    .orderBy(asc(theoryTopics.generatedAt))
    .limit(args.limit);

  return rows;
}

/**
 * Count flagged-theory rows in the same slice — used for the
 * `(<remaining> flagged remain in this slice — re-run to continue)`
 * line in the summary printed by Task 18's `main()`.
 */
export async function countFlaggedTheory(
  db: Db,
  args: TheoryReviewArgs,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(theoryTopics)
    .where(flaggedTheorySlicePredicate(args));

  return rows[0]?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Print one flagged-theory row to `stdout`:
 *   - Header: id-prefix + lang/level/grammarPointKey + qualityScore
 *   - Body: plain-text dump via `theoryTopicJsonToText`. If the JSON fails
 *     re-validation (corrupted row in the DB), print the truncated parser
 *     error in its place rather than crashing the reviewer's session.
 *   - Footer: bullet list of `flagged_reasons`, or `(none recorded)` when
 *     the list is empty or NULL.
 */
export function renderTheoryRow(
  row: FlaggedTheoryRow,
  stdout: NodeJS.WriteStream,
): void {
  const idPrefix = row.id.slice(0, 8);
  const score = formatQualityScore(row.qualityScore);

  stdout.write(
    `─── ${idPrefix}... ───  ${row.language} ${row.cefrLevel} ${row.grammarPointKey}  qualityScore=${score}\n`,
  );

  try {
    const topic = parseTheoryTopicJson(row.contentJson);
    stdout.write(`${theoryTopicJsonToText(topic)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const truncated = message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
    stdout.write(`(content render error: ${truncated})\n`);
  }

  stdout.write('Flagged reasons:\n');
  if (Array.isArray(row.flaggedReasons) && row.flaggedReasons.length > 0) {
    for (const reason of row.flaggedReasons) {
      stdout.write(`  - ${String(reason)}\n`);
    }
  } else {
    stdout.write('  (none recorded)\n');
  }
}

function formatQualityScore(score: number | null): string {
  if (score === null) return 'null';
  return score.toFixed(2);
}

// ---------------------------------------------------------------------------
// State-changing writes
// ---------------------------------------------------------------------------

/**
 * Promote a flagged theory row to `manual-approved`. Returns:
 *   - `'approved'` on a clean UPDATE.
 *   - `'demoted'` when the partial UNIQUE index on
 *     `(language, grammar_point_key) WHERE review_status IN
 *     ('auto-approved', 'manual-approved')` rejects the promotion (an
 *     approved row already occupies the cell). The row is then UPDATEd
 *     to `'rejected'` so the queue advances.
 *
 * Both UPDATEs carry `AND review_status = 'flagged'` so a concurrent
 * state change (another reviewer, the Phase 4 Lambda) just no-ops the
 * statement (Req 5 reliability §).
 *
 * Reuses `isUniqueViolation` from `./review-flagged.ts` — Postgres
 * SQLSTATE 23505 detection is shared across both review CLIs.
 */
export async function tryApproveTheory(
  db: Db,
  row: FlaggedTheoryRow,
): Promise<'approved' | 'demoted'> {
  try {
    await db
      .update(theoryTopics)
      .set({ reviewStatus: 'manual-approved', flaggedReasons: null })
      .where(
        and(
          eq(theoryTopics.id, row.id),
          eq(theoryTopics.reviewStatus, 'flagged'),
        ),
      );
    return 'approved';
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db
        .update(theoryTopics)
        .set({ reviewStatus: 'rejected' })
        .where(
          and(
            eq(theoryTopics.id, row.id),
            eq(theoryTopics.reviewStatus, 'flagged'),
          ),
        );
      return 'demoted';
    }
    throw err;
  }
}

/**
 * Mark a flagged theory row as `rejected`. `flagged_reasons` is
 * intentionally preserved so a later audit can see why the reviewer
 * rejected it (Req 5.4).
 */
export async function rejectTheoryRow(
  db: Db,
  row: FlaggedTheoryRow,
): Promise<void> {
  await db
    .update(theoryTopics)
    .set({ reviewStatus: 'rejected' })
    .where(
      and(
        eq(theoryTopics.id, row.id),
        eq(theoryTopics.reviewStatus, 'flagged'),
      ),
    );
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

export type TheoryReviewCounts = {
  approved: number;
  rejected: number;
  skipped: number;
  /**
   * Approval attempts that hit the partial-unique-index collision and were
   * UPDATEd to `rejected` instead. Tracked separately from `rejected` so
   * the operator can see how often the reviewer's "approve" intent was
   * forced into a "rejected" outcome by an existing approved cell.
   */
  demoted: number;
};

/**
 * Print the review session summary. The "remaining" line only renders when
 * there are still flagged rows in the slice — Req 5.10's hint that the
 * reviewer can re-run to continue.
 */
export function printTheoryReviewSummary(
  counts: TheoryReviewCounts,
  totalReviewed: number,
  remaining: number,
  stdout: NodeJS.WriteStream,
): void {
  stdout.write(
    `Reviewed ${totalReviewed} theory page(s): ${counts.approved} approved, ${counts.rejected} rejected, ${counts.skipped} skipped, ${counts.demoted} demoted\n`,
  );
  if (remaining > 0) {
    stdout.write(
      `(${remaining} flagged remain in this slice — re-run to continue)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// main — interactive driver
// ---------------------------------------------------------------------------

/**
 * Drive the interactive review loop. Importable from tests via the exported
 * `(argv, stdinSource)` signature; the direct-run guard at the bottom of
 * the file wires it to `process.argv` + `process.stdin` for `pnpm
 * review:flagged-theory` invocations.
 *
 * The production guard fires before any DB connection — `--allow-prod` is
 * required under `NODE_ENV=production` (Req Non-Functional § Security).
 * The reader's `close()` runs in a `finally` block so the TTY's raw mode
 * is always restored, even on a thrown error.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  stdinSource: NodeJS.ReadStream | Readable = process.stdin,
): Promise<void> {
  const args = parseTheoryReviewArgs(argv);

  if (process.env['NODE_ENV'] === 'production' && !args.allowProd) {
    console.error(
      'Refusing to run in production. Pass --allow-prod or use the Phase 5 admin UI.',
    );
    process.exit(1);
  }

  const db = createDb(requireEnv('DATABASE_URL'));

  const rows = await selectFlaggedTheoryRows(db, args);
  if (rows.length === 0) {
    process.stdout.write('No flagged theory pages match the filter.\n');
    return;
  }

  const counts: TheoryReviewCounts = {
    approved: 0,
    rejected: 0,
    skipped: 0,
    demoted: 0,
  };
  const reader = createKeystrokeReader(stdinSource);
  let processedCount = 0;

  try {
    outer: for (const row of rows) {
      renderTheoryRow(row, process.stdout);
      while (true) {
        process.stdout.write('[a]pprove / [r]eject / [s]kip / [q]uit > ');
        const key = await reader.next();
        if (key === 'a') {
          const result = await tryApproveTheory(db, row);
          if (result === 'approved') {
            process.stdout.write('✓ approved\n');
            counts.approved++;
          } else {
            process.stdout.write(
              '↓ demoted (another approved row already in cell)\n',
            );
            counts.demoted++;
          }
          processedCount++;
          break;
        } else if (key === 'r') {
          await rejectTheoryRow(db, row);
          process.stdout.write('✗ rejected\n');
          counts.rejected++;
          processedCount++;
          break;
        } else if (key === 's') {
          counts.skipped++;
          processedCount++;
          break;
        } else if (key === 'q') {
          break outer;
        } else {
          process.stdout.write('use a/r/s/q\n');
        }
      }
    }

    const remaining = await countFlaggedTheory(db, args);
    printTheoryReviewSummary(counts, processedCount, remaining, process.stdout);
  } finally {
    reader.close();
  }
}

// ---------------------------------------------------------------------------
// Direct-run guard (so tests can `import { main }` without re-execing)
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then(() => {
      // Force-exit so the Neon Pool's WebSocket connections don't keep the
      // event loop alive after the prompt loop returns.
      process.exit(0);
    })
    .catch((err) => {
      console.error('review-flagged-theory failed:', err);
      process.exit(1);
    });
}
