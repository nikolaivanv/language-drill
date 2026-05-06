/**
 * `pnpm review:flagged` — interactive review CLI for flagged exercises.
 *
 * Walks the flagged queue one row at a time. Each row prints, then a single
 * keystroke advances: `a` approve, `r` reject, `s` skip, `q` quit. Every
 * UPDATE carries `AND review_status = 'flagged'` so a concurrent state change
 * (another reviewer, a Phase 4 Lambda) just no-ops the statement.
 */

import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { type SQL, and, asc, count, eq } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema/index';

import { requireEnv } from './env-helpers';
import {
  parseReviewArgs,
  type ReviewArgs,
} from './review-flagged-parse-args';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Subset of `exercises` columns the review CLI reads. Matches the
 * `SELECT id, language, difficulty, type, grammar_point_key, content_json,
 * quality_score, flagged_reasons, generated_at FROM exercises ...` from
 * Requirement 6.3.
 *
 * `language`, `difficulty`, `type`, `grammarPointKey` are nullable in the
 * schema (`pgTable` declares them as plain `text(...)` without `.notNull()`),
 * so the type widens to `string | null`. `qualityScore` is `number | null` per
 * `real('quality_score')`. `contentJson` and `flaggedReasons` are `unknown`
 * because their `jsonb(...)` declarations don't carry a generic.
 */
export type FlaggedRow = {
  id: string;
  language: string | null;
  difficulty: string | null;
  type: string | null;
  grammarPointKey: string | null;
  contentJson: unknown;
  qualityScore: number | null;
  flaggedReasons: unknown;
  generatedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Slice predicate
// ---------------------------------------------------------------------------

/**
 * Build the `WHERE` predicate shared by `selectFlaggedRows` and `countFlagged`:
 *   review_status = 'flagged' AND (slice filters from `args`)
 *
 * Only includes a predicate for fields that are non-null on `args`, so an
 * unscoped `--lang es` walks every level + type + grammar-point combination.
 */
function flaggedSlicePredicate(args: ReviewArgs): SQL {
  const conditions: SQL[] = [eq(exercises.reviewStatus, 'flagged')];

  conditions.push(eq(exercises.language, args.lang));

  if (args.level !== null) {
    conditions.push(eq(exercises.difficulty, args.level));
  }
  if (args.type !== null) {
    conditions.push(eq(exercises.type, args.type));
  }
  if (args.grammarPoint !== null) {
    conditions.push(eq(exercises.grammarPointKey, args.grammarPoint));
  }

  // `and(...)` returns `SQL | undefined` only when called with zero args; we
  // always pass at least one (the review_status predicate), so the result is
  // always defined. The non-null assertion keeps the call sites typed as `SQL`.
  return and(...conditions)!;
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

/**
 * Pull the slice of flagged exercises matching `args`, oldest first, capped at
 * `args.limit`. No write happens — Requirement 6.3 is explicit that the
 * reviewer's first keystroke is the gate for any state change.
 */
export async function selectFlaggedRows(
  db: Db,
  args: ReviewArgs,
): Promise<FlaggedRow[]> {
  const rows = await db
    .select({
      id: exercises.id,
      language: exercises.language,
      difficulty: exercises.difficulty,
      type: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      qualityScore: exercises.qualityScore,
      flaggedReasons: exercises.flaggedReasons,
      generatedAt: exercises.generatedAt,
    })
    .from(exercises)
    .where(flaggedSlicePredicate(args))
    .orderBy(asc(exercises.generatedAt))
    .limit(args.limit);

  return rows;
}

/**
 * Count flagged rows in the same slice — used for the
 * `(<remaining> flagged remain in this slice — re-run to continue)` line in
 * the summary printed by Task 23's `main()`.
 */
export async function countFlagged(db: Db, args: ReviewArgs): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(exercises)
    .where(flaggedSlicePredicate(args));

  return rows[0]?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Print the flagged exercise to stdout. Matches the format documented in
 * Requirement 6.4 / design Component 6:
 *   - header with id-prefix + cell key + qualityScore
 *   - JSON-pretty-printed `content_json` with `_dedupKey` stripped (writer
 *     metadata; reviewers don't need to see it)
 *   - bullet list of `flagged_reasons`
 */
export function renderRow(row: FlaggedRow): void {
  const idPrefix = row.id.split('-')[0] ?? row.id;
  const lang = row.language ?? '?';
  const level = row.difficulty ?? '?';
  const type = row.type ?? '?';
  const gp = row.grammarPointKey ?? '?';
  const score = formatQualityScore(row.qualityScore);

  process.stdout.write(
    `─── ${idPrefix}... ───  ${lang} ${level} ${type} ${gp}  qualityScore=${score}\n`,
  );

  // `_dedupKey` is writer-only metadata. Strip it before showing the content.
  // The runtime shape is "object-or-null" (Postgres jsonb); we narrow with a
  // typeof check rather than trusting the schema's `unknown` type.
  if (row.contentJson !== null && typeof row.contentJson === 'object') {
    const { _dedupKey, ...rest } = row.contentJson as Record<string, unknown>;
    void _dedupKey;
    process.stdout.write(`${JSON.stringify(rest, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(row.contentJson, null, 2)}\n`);
  }

  process.stdout.write('Flagged reasons:\n');
  if (Array.isArray(row.flaggedReasons) && row.flaggedReasons.length > 0) {
    for (const reason of row.flaggedReasons) {
      process.stdout.write(`  - ${String(reason)}\n`);
    }
  } else {
    process.stdout.write('  (none recorded)\n');
  }
}

function formatQualityScore(score: number | null): string {
  if (score === null) return 'null';
  return score.toFixed(2);
}

// ---------------------------------------------------------------------------
// Interactive input — keystroke reader
// ---------------------------------------------------------------------------

export type KeystrokeReader = {
  /** Resolves with the next single-character keystroke. */
  next(): Promise<string>;
  /**
   * Restore the input source to its pre-reader state. On the TTY path this
   * exits raw mode and pauses stdin so the Node event loop can quiesce after
   * `main()` resolves; without it the terminal looks frozen. No-op on the
   * test (Readable) path.
   */
  close(): void;
};

/**
 * Build a single-keystroke reader.
 *
 * Production path (`stdinSource === process.stdin`): puts stdin into raw mode
 * via `readline.emitKeypressEvents` so each character resolves a `next()` call
 * without waiting for Enter. Ctrl-C exits cleanly with code 130 after taking
 * stdin out of raw mode (otherwise the terminal stays locked).
 *
 * Test path (any other `Readable`): buffers `'data'` chunks and dispatches one
 * character per `next()` call. Tests can push raw single chars or whole
 * strings; both work.
 *
 * Both paths normalize Enter / Return (CR/LF) to be ignored — the prompt loop
 * keys off single letters, not "press Enter to confirm".
 */
export function createKeystrokeReader(
  stdinSource: NodeJS.ReadStream | Readable,
): KeystrokeReader {
  if (stdinSource === process.stdin) {
    return createTtyReader(process.stdin);
  }
  return createBufferedReader(stdinSource);
}

function createTtyReader(stdin: NodeJS.ReadStream): KeystrokeReader {
  readline.emitKeypressEvents(stdin);
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }

  type KeyMeta = { name?: string; ctrl?: boolean };

  // Track the in-flight 'keypress' listener so close() can detach it even when
  // the user quits in the middle of a `next()` await (e.g. Ctrl-C path takes
  // the same teardown).
  let activeListener: ((ch: string | undefined, key: KeyMeta | undefined) => void) | null = null;
  let closed = false;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    if (activeListener) {
      stdin.removeListener('keypress', activeListener);
      activeListener = null;
    }
    if (stdin.isTTY) stdin.setRawMode(false);
    // Pause stdin so the open file descriptor stops keeping the event loop
    // alive once main() resolves and the DB pool closes.
    stdin.pause();
  };

  return {
    next(): Promise<string> {
      return new Promise((resolve) => {
        const onKey = (ch: string | undefined, key: KeyMeta | undefined): void => {
          // Ctrl-C → graceful exit. Without this, raw mode would swallow it.
          if (key?.ctrl && key.name === 'c') {
            teardown();
            process.exit(130);
            return;
          }
          // Ignore Enter / Return — the prompt loop only acts on letter keys.
          if (key?.name === 'return' || key?.name === 'enter') {
            return;
          }
          stdin.removeListener('keypress', onKey);
          activeListener = null;
          resolve(ch ?? '');
        };
        activeListener = onKey;
        stdin.on('keypress', onKey);
      });
    },
    close: teardown,
  };
}

function createBufferedReader(source: Readable): KeystrokeReader {
  const buffer: string[] = [];
  const waiters: ((value: string) => void)[] = [];

  source.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const ch of text) {
      // Ignore CR/LF so a test harness pushing `'a\n'` still acts like `'a'`.
      if (ch === '\n' || ch === '\r') continue;
      const waiter = waiters.shift();
      if (waiter) waiter(ch);
      else buffer.push(ch);
    }
  });

  return {
    next(): Promise<string> {
      const ch = buffer.shift();
      if (ch !== undefined) return Promise.resolve(ch);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    // No-op on the test path — the injected Readable doesn't own a TTY and
    // the test harness manages its own lifecycle.
    close(): void {},
  };
}

// ---------------------------------------------------------------------------
// Postgres unique-violation detection
// ---------------------------------------------------------------------------

/**
 * SQLSTATE `23505` is Postgres's `unique_violation`. `tryApprove` catches it
 * to demote the row to `rejected` per Requirement 6.10 — the partial UNIQUE
 * index from Requirement 4.1 fires when a flagged duplicate would be promoted
 * to `manual-approved` while another approved row already occupies the slot.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Error && 'code' in err) {
    return (err as { code: string }).code === '23505';
  }
  return false;
}

// ---------------------------------------------------------------------------
// State-changing writes
// ---------------------------------------------------------------------------

/**
 * Promote a flagged row to `manual-approved`. Returns:
 *   - `'approved'` on a clean UPDATE
 *   - `'demoted'` when the partial UNIQUE index rejects the promotion (a
 *     duplicate already lives in the cell as auto-approved or manual-approved);
 *     the row is then UPDATEd to `'rejected'` so the queue advances.
 *
 * Both UPDATEs carry `AND review_status = 'flagged'` so a concurrent state
 * change (another reviewer, a Phase 4 Lambda) just no-ops the statement
 * instead of clobbering whatever already happened.
 */
export async function tryApprove(
  db: Db,
  row: FlaggedRow,
): Promise<'approved' | 'demoted'> {
  try {
    await db
      .update(exercises)
      .set({ reviewStatus: 'manual-approved', flaggedReasons: null })
      .where(
        and(eq(exercises.id, row.id), eq(exercises.reviewStatus, 'flagged')),
      );
    return 'approved';
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db
        .update(exercises)
        .set({ reviewStatus: 'rejected' })
        .where(
          and(
            eq(exercises.id, row.id),
            eq(exercises.reviewStatus, 'flagged'),
          ),
        );
      return 'demoted';
    }
    throw err;
  }
}

/**
 * Mark a flagged row as `rejected`. `flagged_reasons` is intentionally
 * preserved so a later audit can see why the reviewer rejected it.
 */
export async function rejectRow(db: Db, row: FlaggedRow): Promise<void> {
  await db
    .update(exercises)
    .set({ reviewStatus: 'rejected' })
    .where(
      and(eq(exercises.id, row.id), eq(exercises.reviewStatus, 'flagged')),
    );
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

export type ReviewCounts = {
  approved: number;
  rejected: number;
  skipped: number;
};

/**
 * Print the review session summary. The "remaining" line only renders when
 * there are still flagged rows in the slice — Requirement 6.6's hint that the
 * reviewer can re-run to continue.
 */
export function printReviewSummary(
  counts: ReviewCounts,
  totalReviewed: number,
  remaining: number,
): void {
  process.stdout.write(
    `Reviewed ${totalReviewed} exercise(s): ${counts.approved} approved, ${counts.rejected} rejected, ${counts.skipped} skipped\n`,
  );
  if (remaining > 0) {
    process.stdout.write(
      `(${remaining} flagged remain in this slice — re-run to continue)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  stdinSource: NodeJS.ReadStream | Readable = process.stdin,
): Promise<void> {
  const args = parseReviewArgs(argv);

  // Production guard fires before any DB connection — the supported prod path
  // is the Phase 5 admin UI; the CLI is dev/admin-only (Requirement 6.9).
  if (process.env['NODE_ENV'] === 'production' && !args.allowProd) {
    console.error(
      'Refusing to run in production. Pass --allow-prod or use the Phase 5 admin UI.',
    );
    process.exit(1);
  }

  const db = createDb(requireEnv('DATABASE_URL'));

  const rows = await selectFlaggedRows(db, args);
  if (rows.length === 0) {
    process.stdout.write('No flagged exercises in this slice.\n');
    return;
  }

  const counts: ReviewCounts = { approved: 0, rejected: 0, skipped: 0 };
  const reader = createKeystrokeReader(stdinSource);
  let processedCount = 0;

  try {
    outer: for (const row of rows) {
      renderRow(row);
      while (true) {
        process.stdout.write('[a]pprove / [r]eject / [s]kip / [q]uit > ');
        const key = await reader.next();
        if (key === 'a') {
          const result = await tryApprove(db, row);
          if (result === 'approved') {
            process.stdout.write('Approved.\n');
            counts.approved++;
          } else {
            process.stdout.write(
              'Cannot approve — duplicate of an existing approved exercise in this cell. Marking rejected instead.\n',
            );
            counts.rejected++;
          }
          processedCount++;
          break;
        } else if (key === 'r') {
          await rejectRow(db, row);
          process.stdout.write('Rejected.\n');
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

    const remaining = await countFlagged(db, args);
    printReviewSummary(counts, processedCount, remaining);
  } finally {
    // Always restore cooked mode + pause stdin, even on a thrown error, so
    // the terminal returns to a usable state.
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
      console.error('review-flagged failed:', err);
      process.exit(1);
    });
}
