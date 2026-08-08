/**
 * `pnpm backfill:demotion-reason` — one-off classifier for exercises that were
 * demoted before `exercises.demotion_reason` existed.
 *
 * Three passes, narrowest first; each only touches rows still NULL:
 *   1. quality      — the row carries validator/revalidator flagged_reasons
 *   2. learner-flag — an admin upheld a learner's flag on it
 *   3. pool-hygiene — everything else that left the pool
 *
 * Known, accepted gap: `demote:pool` was also used for genuine quality sweeps
 * (self-revealing-target, cloze tense-determinacy, answer/stem overlap). Those
 * rows wrote no flagged_reasons and carry no demotion timestamp, so pass 3
 * files them as pool-hygiene and their attempts keep counting. This
 * under-excludes; it never over-excludes. Guessing the other way would destroy
 * legitimate evidence, and Task 3 makes this the last cohort that can be
 * ambiguous.
 *
 * Dry-run by default; pass --apply to write. Idempotent.
 *
 * Required env: DATABASE_URL.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema';
import type { DemotionReason } from '../src/lib/evidence';

export const BACKFILL_STEPS: readonly {
  reason: DemotionReason;
  label: string;
  predicate: SQL;
}[] = [
  {
    reason: 'quality',
    label: 'carries validator/revalidator flagged_reasons',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null
      and ${exercises.flaggedReasons} is not null`,
  },
  {
    reason: 'learner-flag',
    label: 'an admin upheld a learner flag on it',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null
      and ${exercises.id} in (
        select exercise_id from exercise_flags where status = 'resolved_rejected'
        union
        select target_id::uuid from admin_audit_log
         where action = 'user_flag.reject' and target_type = 'exercise'
      )`,
  },
  {
    reason: 'pool-hygiene',
    label: 'left the pool for some other reason',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null`,
  },
];

/**
 * Classifies every still-unclassified rejected row into exactly one bucket —
 * its narrowest matching `BACKFILL_STEPS` predicate — via a single grouped
 * query, so the preview reflects a true partition rather than N independent
 * counts.
 *
 * Counting each predicate independently (one `SELECT count(*) ... WHERE
 * <predicate>` per step) is wrong: `BACKFILL_STEPS` is deliberately
 * narrowest-first, so a later predicate (e.g. pass 3's catch-all) is a
 * *superset* of the earlier ones, not a residual — it still matches every
 * row the earlier passes already claimed. Summing independent counts
 * therefore double- (or triple-) counts overlap rows and overstates the
 * catch-all bucket by the size of the narrower ones.
 *
 * A single `CASE WHEN <pred1> THEN … WHEN <pred2> THEN … END` evaluates the
 * predicates in `BACKFILL_STEPS` order and stops at the first match, so a
 * row can only land in one bucket — mutually exclusive by construction,
 * exactly mirroring what the sequential `--apply` loop below does to it
 * (each step's `UPDATE` only ever touches rows still `demotion_reason IS
 * NULL`, so a row claimed by an earlier step is invisible to later ones).
 */
export async function previewBuckets(db: Db): Promise<ReadonlyMap<DemotionReason, number>> {
  const bucketCase = sql.join(
    [
      sql`case`,
      ...BACKFILL_STEPS.map((step) => sql`when ${step.predicate} then ${step.reason}`),
      sql`end`,
    ],
    sql` `,
  );

  // Group by ordinal position (1 = `bucket`), not by re-interpolating
  // `bucketCase` a second time: each `sql` interpolation mints fresh
  // parameter placeholders, so a second copy renders with different `$n`s
  // than the SELECT list's copy and postgres refuses to recognise them as
  // the same expression ("column must appear in the GROUP BY clause").
  const rows = await db
    .select({
      bucket: sql<DemotionReason | null>`${bucketCase}`,
      n: sql<number>`count(*)::int`,
    })
    .from(exercises)
    .groupBy(sql`1`);

  return new Map(
    rows
      .filter((r): r is { bucket: DemotionReason; n: number } => r.bucket !== null)
      .map((r) => [r.bucket, r.n]),
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  const counts = await previewBuckets(db);

  for (const step of BACKFILL_STEPS) {
    const n = counts.get(step.reason) ?? 0;

    console.log(
      `[demotion-reason] ${apply ? 'APPLY' : 'DRY-RUN'} ${step.reason}: ` +
        `${n} rows — ${step.label}`,
    );

    if (apply && n > 0) {
      await db.update(exercises).set({ demotionReason: step.reason }).where(step.predicate);
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(exercises)
    .where(and(eq(exercises.reviewStatus, 'rejected'), isNull(exercises.demotionReason)));

  console.log(
    apply
      ? `[demotion-reason] done — ${remaining} rejected rows still unclassified (expected 0).`
      : '[demotion-reason] dry-run only — pass --apply to write.',
  );
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
