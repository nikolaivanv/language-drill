// One-off: rebuild user_grammar_mastery by replaying each user's evidence —
// both user_exercise_history (host observations) and error_observations
// (reconstructed incidental observations) — through the same update rule the
// live submit path uses. Idempotent — recomputes each row from scratch.
// Dry-run by default; pass --apply to write.
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
  // The replay DOES reconstruct incidental observations from
  // `error_observations`, so `--include-demoted` CAN recreate a
  // `user_grammar_mastery` row that a prior run deleted for an
  // incidental-fold-only grammar point, with a score recomputed from
  // whatever evidence survives. The remaining limit is precise: recovery
  // depends on the backing `error_observations` rows still existing. That
  // table cascades from `user_exercise_history`, so if the originating
  // history row was deleted, the evidence is genuinely gone and no flag
  // recovers it — only re-running the live submit path (the learner
  // practicing again) or a manual insert brings it back.
  const includeDemoted = process.argv.includes('--include-demoted');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  // maxDeletes stays null here: this CLI is human-gated by the dry-run its
  // operator reads (and the --apply confirmation) before ever writing, unlike
  // the scheduled unattended run, which sets a real threshold.
  const result = await run(db, { apply, userFilter, languageFilter, includeDemoted, maxDeletes: null });

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
