/**
 * One-off runner for the PR #634 / #631 collapse repass (2026-08-14).
 *
 * `pnpm demote:pool` is single-cell and writes NO rollback artifact — the
 * gap recorded after the #640 backfill, where the only fine-grained record of
 * the mutated rows lived outside the repo. This runner closes both gaps for
 * the 80-cell repass:
 *
 *   Phase 1 (always) — resolve the exact rows each cell would demote and write
 *   them to a rollback artifact IN the repo, keyed on primary key.
 *   Phase 2 (--apply) — demote exactly those captured ids, nothing re-queried.
 *
 * Capturing and mutating the SAME id list is the point: a re-query between the
 * two phases could drift (a concurrent generation run inserts rows, shifting
 * `ORDER BY created_at ASC LIMIT n`), leaving an artifact that does not
 * describe what was actually written.
 *
 * Row selection is delegated to `selectRowsToDemote` from the real CLI rather
 * than reimplemented here, so limit/ordering/status semantics cannot drift
 * from `pnpm demote:pool`.
 *
 * Reason is pinned to `pool-hygiene`: these rows are structurally
 * under-covering a declared mechanism, not defective. `quality` /
 * `learner-flag` would revoke learners' credit for past attempts on them.
 *
 * Defaults to dry-run; pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=<prod> npx tsx scripts/collapse-repass-2026-08-14.ts
 *   DATABASE_URL=<prod> npx tsx scripts/collapse-repass-2026-08-14.ts --apply
 *   DATABASE_URL=<prod> npx tsx scripts/collapse-repass-2026-08-14.ts --revert <artifact> --apply
 *
 * Required env: DATABASE_URL.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { eq, inArray } from 'drizzle-orm';

import { createDb } from '../src/client';
import { exercises } from '../src/schema';
import { selectRowsToDemote } from './demote-cell-pool';

const REASON = 'pool-hygiene' as const;
const ANALYSIS = path.join(import.meta.dirname, '../../../docs/analysis');

/**
 * `--pass <n>` selects the worklist/artifact pair, so a follow-up pass reuses
 * this runner instead of cloning it. Each pass gets its OWN artifact: pass 1's
 * file is the only fine-grained record of the rows it demoted, and a shared
 * path would let pass 2 overwrite it.
 */
function passSuffix(argv: readonly string[]): string {
  const i = argv.indexOf('--pass');
  const n = i >= 0 ? argv[i + 1] : null;
  if (n === null || n === '1') return '';
  if (!/^[0-9]+$/.test(n)) throw new Error(`--pass must be a positive integer (got '${n}')`);
  return `-pass${n}`;
}

const SUFFIX = passSuffix(process.argv);
const WORKLIST = path.join(
  ANALYSIS,
  `collapse-repass${SUFFIX}-2026-08-14-worklist.json`,
);
const ARTIFACT = path.join(
  ANALYSIS,
  `collapse-repass${SUFFIX}-2026-08-14-rollback.json`,
);

type WorkCell = {
  cellKey: string;
  language: string;
  cefr: string;
  type: string;
  grammarPoint: string;
  approved: number;
  target: number;
  limit: number;
  mechanism: string;
};

type CapturedCell = {
  cellKey: string;
  mechanism: string;
  approvedBefore: number;
  /** Primary keys demoted, in the order the CLI would have taken them. */
  ids: string[];
};

const CHUNK = 200;

/**
 * Demote by primary key, chunked. A per-id UPDATE loop over 831 rows is ~831
 * round trips to Neon and blew a 2-minute timeout mid-run; batching by id keeps
 * the whole set well inside one invocation.
 */
async function demoteIds(db: ReturnType<typeof createDb>, ids: string[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await db
      .update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: REASON })
      .where(inArray(exercises.id, chunk));
    done += chunk.length;
  }
  return done;
}

/** Current review_status for the given ids, batched. */
async function statusOf(
  db: ReturnType<typeof createDb>,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: exercises.id, status: exercises.reviewStatus })
      .from(exercises)
      .where(inArray(exercises.id, ids.slice(i, i + 500)));
    for (const r of rows) out.set(r.id, r.status);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const revertIdx = process.argv.indexOf('--revert');
  const revertPath = revertIdx >= 0 ? process.argv[revertIdx + 1] : null;

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  // -- Revert path -----------------------------------------------------------
  // Restores only rows this runner actually demoted. `auto-approved` is the
  // status every captured row held: the worklist is built from the audit's
  // approved pool, and `manual-approved` rows are re-checked below before any
  // restore so a hand-curated row is never silently relabelled.
  if (revertPath) {
    const artifact = JSON.parse(readFileSync(revertPath, 'utf8')) as {
      cells: CapturedCell[];
      priorStatusById?: Record<string, string>;
    };
    const ids = artifact.cells.flatMap((c) => c.ids);
    console.log(`[repass] REVERT ${apply ? 'APPLY' : 'DRY-RUN'} — ${ids.length} rows`);
    if (!apply) {
      console.log('[repass] dry-run only — pass --apply to write.');
      return;
    }
    for (const id of ids) {
      const prior = artifact.priorStatusById?.[id] ?? 'auto-approved';
      await db
        .update(exercises)
        .set({ reviewStatus: prior, demotionReason: null })
        .where(eq(exercises.id, id));
    }
    console.log(`[repass] restored ${ids.length} rows.`);
    return;
  }

  // -- Resume path -----------------------------------------------------------
  // Completes a run that died partway (the first --apply hit a 2-minute
  // timeout after 54 of 80 cells). It works ONLY from the captured id list —
  // never re-selecting — because the rows already demoted now read as
  // 'rejected', so a fresh `selectRowsToDemote` would skip them and pick the
  // NEXT-oldest approved rows instead, demoting well beyond the plan.
  // Idempotent: ids already rejected are left alone.
  if (process.argv.includes('--resume')) {
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { cells: CapturedCell[] };
    const ids = artifact.cells.flatMap((c) => c.ids);
    const status = await statusOf(db, ids);
    const remaining = ids.filter((id) => status.get(id) !== 'rejected');
    const alreadyDone = ids.length - remaining.length;
    console.log(
      `[repass] RESUME ${apply ? 'APPLY' : 'DRY-RUN'} — ${ids.length} planned, ` +
        `${alreadyDone} already demoted, ${remaining.length} remaining`,
    );
    const missing = ids.filter((id) => !status.has(id));
    if (missing.length) console.warn(`[repass] WARN ${missing.length} planned ids no longer exist`);
    if (!apply) {
      console.log('[repass] dry-run only — pass --apply to write.');
      return;
    }
    const n = await demoteIds(db, remaining);
    console.log(`[repass] demoted ${n} remaining rows (total now ${alreadyDone + n}/${ids.length}).`);
    return;
  }

  // -- Phase 1: capture ------------------------------------------------------
  const worklist = JSON.parse(readFileSync(WORKLIST, 'utf8')) as { work: WorkCell[] };
  const captured: CapturedCell[] = [];
  const priorStatusById: Record<string, string> = {};

  for (const cell of worklist.work) {
    const rows = await selectRowsToDemote(db, {
      language: cell.language,
      cefr: cell.cefr,
      type: cell.type,
      grammarPoint: cell.grammarPoint,
      contentIlike: null,
      limit: cell.limit,
    });
    if (rows.length !== cell.limit) {
      console.warn(
        `[repass] WARN ${cell.cellKey}: expected ${cell.limit} rows, selected ${rows.length}`,
      );
    }
    captured.push({
      cellKey: cell.cellKey,
      mechanism: cell.mechanism,
      approvedBefore: cell.approved,
      ids: rows.map((r) => r.id),
    });
  }

  // Record each row's pre-demotion status so the revert restores what was
  // actually there rather than assuming 'auto-approved'. One batched read —
  // a per-id loop would be 831 round trips.
  const allIds = captured.flatMap((c) => c.ids);
  for (const [id, status] of await statusOf(db, allIds)) priorStatusById[id] = status;

  const totalRows = captured.reduce((a, c) => a + c.ids.length, 0);

  // Refuse only when the artifact on disk records an APPLIED run — that file is
  // the sole fine-grained record of those rows' prior status. A dry-run
  // artifact is a disposable preview and must stay overwritable, or the
  // customary dry-run-then-apply sequence would block itself.
  if (existsSync(ARTIFACT)) {
    const prior = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { applied?: boolean };
    if (prior.applied) {
      console.error(
        `[repass] refusing to overwrite an APPLIED artifact: ${ARTIFACT}\n` +
          '  It is the only fine-grained record of that run. Move it aside first.',
      );
      process.exit(1);
    }
  }

  writeFileSync(
    ARTIFACT,
    JSON.stringify(
      { generated: '2026-08-14', reason: REASON, applied: apply, cells: captured, priorStatusById },
      null,
      2,
    ),
  );
  console.log(`[repass] wrote rollback artifact: ${ARTIFACT}`);
  console.log(
    `[repass] ${apply ? 'APPLY' : 'DRY-RUN'} — ${captured.length} cells, ${totalRows} rows, reason=${REASON}`,
  );

  if (!apply) {
    console.log('[repass] dry-run only — pass --apply to write.');
    return;
  }

  // -- Phase 2: demote exactly the captured ids ------------------------------
  const done = await demoteIds(db, captured.flatMap((c) => c.ids));
  console.log(`[repass] demoted ${done} rows to 'rejected' (reason: ${REASON}).`);
  console.log(
    "[repass] 'pool-hygiene' preserves learner evidence — no backfill:mastery needed.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
