// One-off: rebuild user_grammar_mastery from existing user_exercise_history by
// replaying each user's attempts (per grammar point) through the same update
// rule the live submit path uses. Idempotent — recomputes each row from
// scratch. Dry-run by default; pass --apply to write.
//
//   pnpm backfill:mastery [--apply] [--user=<id>] [--language=ES|DE|TR|EN] [--include-demoted]
import { createDb } from '../src/client';
import { run, summarize, formatDiffReport } from '../src/mastery/rebuild';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const userFilter = arg('user');
  const languageFilter = arg('language');
  // Attempts on exercises later demoted for a defect are excluded by default —
  // the learner was marked down for the item's fault. `--include-demoted` is
  // the rollback path: it restores the pre-2026-08 *evidence selection*
  // (replay everything, defect-demoted or not) and never deletes. It does not
  // restore pre-2026-08 mastery *values* — scores are always recomputed under
  // the current `updateMastery`, which since 2026-08-08 seeds a first
  // observation against a neutral prior rather than taking its raw score.
  // It does NOT retroactively restore a `user_grammar_mastery` row that a
  // PRIOR (buggy) run already deleted for an incidental-fold-only grammar
  // point — the replay still can't see incidental observations at all (they
  // have no `user_exercise_history` row to replay from), so the upsert loop
  // never recreates them regardless of this flag. That kind of row can only
  // come back by re-running the live submit path (the learner practicing
  // again) or a manual insert.
  const includeDemoted = process.argv.includes('--include-demoted');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const result = await run(db, { apply, userFilter, languageFilter, includeDemoted });

  console.log(
    summarize({
      apply,
      includeDemoted,
      upserts: result.upserts,
      deletes: result.deletes,
      groupCount: result.groupCount,
      historyRowCount: result.historyRowCount,
    }),
  );
  // The old→new diff is what the `--apply` review gate is read against, so it
  // prints on every run, dry or not — a dry run without it, and an applied run
  // that never showed it, are both unreviewable.
  console.log(formatDiffReport(result.diff));
  process.exit(0);
}

// Skip auto-execution when imported by tests.
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
