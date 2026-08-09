/**
 * Nightly mastery rebuild. Replays every learner's evidence — host history
 * plus incidental error observations — and rewrites user_grammar_mastery, so
 * stored scores self-heal after a demotion revokes evidence. Read-time
 * surfaces already re-derive per request; this is for the stored table.
 *
 * DATABASE_URL only. No Claude, no cost beyond Postgres.
 */
import { createDb, requireEnv, run, summarize, formatDiffReport } from '@language-drill/db';

const DEFAULT_MAX_DELETES = 5;

const db = createDb(requireEnv('DATABASE_URL'));

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

export async function handler(): Promise<void> {
  const raw = process.env['MASTERY_REBUILD_MAX_DELETES'];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  const maxDeletes = Number.isFinite(parsed) ? parsed : DEFAULT_MAX_DELETES;

  const result = await run(db, { apply: true, includeDemoted: false, maxDeletes });

  log({
    event: 'mastery_rebuild',
    aborted: result.aborted,
    upserts: result.upserts,
    deletes: result.deletes,
    groups: result.groupCount,
    observations: result.historyRowCount,
    maxDeletes,
  });
  console.log(summarize({ apply: !result.aborted, upserts: result.upserts, deletes: result.deletes, groupCount: result.groupCount, historyRowCount: result.historyRowCount, includeDemoted: false }));
  console.log(formatDiffReport(result.diff));

  if (result.aborted) {
    // Nothing was written. Throwing increments the Lambda Errors metric, which
    // raises the operational alarm — a run this anomalous wants a human.
    log({ event: 'mastery_rebuild_aborted', deletes: result.deletes, maxDeletes, rows: result.diff.deleted });
    throw new Error(
      `Mastery rebuild aborted: would delete ${result.deletes} rows, above the ${maxDeletes} threshold. Nothing was written.`,
    );
  }
}
