/**
 * Find and (optionally) delete zombie `generation_jobs` rows — entries stuck
 * in `status='running'` past the Lambda's 900 s hard timeout. The
 * soft-deadline finalizer added to the generation handler should make these
 * vanishingly rare; this script is the locked door behind it for any zombie
 * that still slips past (e.g. Lambda OOM, hard process crash before the
 * setTimeout fires).
 *
 * `DELETE`, not `UPDATE status='failed'`: the handler's idempotency guard
 * treats `failed` as `completed` and would never re-run the cell. `DELETE`
 * lets the next scheduler tick re-queue and re-run cleanly.
 *
 * Defaults to dry-run; pass `--apply` to actually delete. See CLAUDE.md
 * "Pre-Push Checks" for the test command (`packages/db/scripts/
 * cleanup-zombie-jobs.test.ts`).
 *
 * Usage:
 *   pnpm --filter @language-drill/db cleanup:zombies                # dry-run
 *   pnpm --filter @language-drill/db cleanup:zombies -- --apply
 *   pnpm --filter @language-drill/db cleanup:zombies -- --max-age-minutes 30
 *   pnpm --filter @language-drill/db cleanup:zombies -- --limit 10
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { generationJobs } from '../src/schema/index';

const DEFAULT_MAX_AGE_MINUTES = 15;
const DEFAULT_LIMIT = 50;

export type CleanupZombieJobsArgs = {
  apply: boolean;
  maxAgeMinutes: number;
  limit: number;
};

export type ZombieRow = {
  id: string;
  cellKey: string;
  startedAt: Date | null;
};

export function parseCleanupArgs(argv: readonly string[]): CleanupZombieJobsArgs {
  let apply = false;
  let maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES;
  let limit = DEFAULT_LIMIT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm forwards `--` as an arg when callers use `pnpm <cmd> -- --apply`.
    // Treat it as a separator and skip.
    if (arg === '--') {
      continue;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      apply = false;
    } else if (arg === '--max-age-minutes') {
      const next = argv[++i];
      if (next === undefined) {
        throw new Error('--max-age-minutes requires a value');
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
          `--max-age-minutes must be a positive number, got ${next}`,
        );
      }
      maxAgeMinutes = parsed;
    } else if (arg === '--limit') {
      const next = argv[++i];
      if (next === undefined) {
        throw new Error('--limit requires a value');
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `--limit must be a positive integer, got ${next}`,
        );
      }
      limit = parsed;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return { apply, maxAgeMinutes, limit };
}

export async function findZombieJobs(
  db: Db,
  args: { maxAgeMinutes: number; limit: number },
): Promise<ZombieRow[]> {
  const cutoff = sql<Date>`NOW() - (${args.maxAgeMinutes} || ' minutes')::interval`;
  const rows = await db
    .select({
      id: generationJobs.id,
      cellKey: generationJobs.cellKey,
      startedAt: generationJobs.startedAt,
    })
    .from(generationJobs)
    .where(
      and(eq(generationJobs.status, 'running'), lt(generationJobs.startedAt, cutoff)),
    )
    .orderBy(generationJobs.startedAt)
    .limit(args.limit);
  return rows;
}

export async function deleteZombieJobs(
  db: Db,
  ids: readonly string[],
): Promise<ZombieRow[]> {
  if (ids.length === 0) return [];
  const deleted = await db
    .delete(generationJobs)
    .where(
      and(
        eq(generationJobs.status, 'running'),
        // `inArray` instead of raw `= ANY(${ids})` so drizzle binds the JS
        // array as a Postgres array properly. Raw interpolation passes the
        // array as a single text param and Postgres rejects with `22P02`
        // ("Array value must start with '{'").
        inArray(generationJobs.id, [...ids]),
      ),
    )
    .returning({
      id: generationJobs.id,
      cellKey: generationJobs.cellKey,
      startedAt: generationJobs.startedAt,
    });
  return deleted;
}

async function main(): Promise<void> {
  const args = parseCleanupArgs(process.argv.slice(2));
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const zombies = await findZombieJobs(db, args);

  if (zombies.length === 0) {
    console.log(
      `No zombie generation_jobs older than ${args.maxAgeMinutes}m found.`,
    );
    return;
  }

  console.log(
    `Found ${zombies.length} zombie generation_jobs (status='running', started_at < NOW() - ${args.maxAgeMinutes}m):`,
  );
  for (const row of zombies) {
    console.log(`  ${row.id}  ${row.cellKey}  started_at=${row.startedAt?.toISOString()}`);
  }

  if (!args.apply) {
    console.log(
      `\nDry-run (default). Re-run with --apply to DELETE these rows.`,
    );
    return;
  }

  const deleted = await deleteZombieJobs(
    db,
    zombies.map((r) => r.id),
  );
  console.log(`\nDeleted ${deleted.length} rows.`);
  for (const row of deleted) {
    console.log(`  ${row.id}  ${row.cellKey}`);
  }
}

// Skip auto-execution when this module is imported by tests. `import.meta.url`
// equals `process.argv[1]` only when tsx ran the file directly.
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
