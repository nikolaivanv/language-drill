/**
 * `pnpm dedup:sc-pool` — one-off CLI to de-duplicate the EXISTING approved
 * sentence_construction pool.
 *
 * Background: `canonicalSurface` for `sentence_construction` used to key on
 * the instructional prompt; a fix re-keyed it onto the primary model answer
 * (`modelAnswers[0]`) instead — two reworded instructions that funnel to the
 * same answer are redundant. Rows already in the pool were inserted (and
 * their `_dedupKey` stamped) under the OLD prompt-based key, so the live
 * unique index no longer reflects their true collisions. This script
 * regroups every `(language, difficulty, grammarPointKey, canonicalSurface)`
 * cluster of `auto-approved` / `manual-approved` / `flagged` rows under the
 * NEW key, keeps one survivor per cluster, and DEMOTES the rest to
 * `review_status = 'rejected'` — same convention as `demote:pool`
 * (`demote-cell-pool.ts`). It never DELETEs — `user_exercise_history` and
 * `playlists` reference `exercises.id` without cascade, so demotion preserves
 * the learner's practice history and mastery linkage while removing the rows
 * from every serve path and the dedup unique index.
 *
 * Survivor selection per group: approved (`auto-approved`/`manual-approved`)
 * preferred over `flagged`, then highest `qualityScore` (null = -1), then
 * oldest `createdAt`. Every surviving row whose stored `content_json._dedupKey`
 * differs from the recomputed key is backfilled to the new key, so a future
 * re-generation of the same answer collides with the survivor and is blocked.
 *
 * Makes no LLM calls — pure regrouping (`groupSentenceConstructionDuplicates`
 * in `../src/generation/sc-dedup-cleanup`) plus DB reads/writes.
 *
 * Defaults to DRY-RUN; pass --apply to write.
 *
 * Usage:
 *   pnpm dedup:sc-pool
 *   pnpm dedup:sc-pool -- --language ES --cefr B1
 *   pnpm dedup:sc-pool -- --language ES --cefr B1 --limit 500
 *   pnpm dedup:sc-pool -- --apply
 *
 * Required env: DATABASE_URL.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { exercises } from '../src/schema';
import {
  groupSentenceConstructionDuplicates,
  type CleanupPlan,
  type ScRow,
} from '../src/generation/sc-dedup-cleanup';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type DedupScArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  limit: number | null;
};

const LANGUAGE_VALUES = new Set<string>(Object.values(Language));
const CEFR_VALUES = new Set<string>(Object.values(CefrLevel));

export function parseDedupScArgs(argv: readonly string[]): DedupScArgs {
  let apply = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let limit: number | null = null;

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
      if (!LANGUAGE_VALUES.has(upper)) {
        throw new Error(
          `${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${next}'`,
        );
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      const upper = next.toUpperCase();
      if (!CEFR_VALUES.has(upper)) {
        throw new Error(
          `${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${next}'`,
        );
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--limit') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--limit requires a value');
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive integer, got ${next}`);
      }
      limit = parsed;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return { apply, language, cefrLevel, limit };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------

async function fetchRows(db: Db, args: DedupScArgs): Promise<ScRow[]> {
  const filters = [
    eq(exercises.type, ExerciseType.SENTENCE_CONSTRUCTION),
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
  ];
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));

  const query = db
    .select({
      id: exercises.id,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      reviewStatus: exercises.reviewStatus,
      qualityScore: exercises.qualityScore,
      createdAt: exercises.createdAt,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as unknown as ScRow[];
}

async function applyPlan(db: Db, plan: CleanupPlan): Promise<void> {
  // Order matters: demote duplicates FIRST (removing their old keys from the
  // partial unique index), THEN backfill survivors — so no two indexed rows
  // ever momentarily share a `_dedupKey`.
  for (const id of plan.toDemote) {
    await db.update(exercises).set({ reviewStatus: 'rejected' }).where(eq(exercises.id, id));
  }
  for (const { id, newKey } of plan.toBackfill) {
    const [existing] = await db
      .select({ contentJson: exercises.contentJson })
      .from(exercises)
      .where(eq(exercises.id, id));
    if (!existing) continue;
    await db
      .update(exercises)
      .set({ contentJson: { ...(existing.contentJson as object), _dedupKey: newKey } })
      .where(eq(exercises.id, id));
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseDedupScArgs(process.argv.slice(2));

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  process.stdout.write(
    `Filters: type=sentence_construction` +
      `${args.language ? ` language=${args.language}` : ''}` +
      `${args.cefrLevel ? ` cefr=${args.cefrLevel}` : ''}` +
      `${args.limit !== null ? ` limit=${args.limit}` : ''}\n`,
  );

  const rows = await fetchRows(db, args);
  if (rows.length === 0) {
    process.stdout.write('No matching rows.\n');
    return;
  }
  process.stdout.write(`Found ${rows.length} candidate rows.\n`);

  const plan = groupSentenceConstructionDuplicates(rows);

  process.stdout.write(
    `\n=== SC dedup cleanup summary ===\n` +
      `  rows scanned:     ${rows.length}\n` +
      `  to demote:        ${plan.toDemote.length}\n` +
      `  to backfill key:  ${plan.toBackfill.length}\n` +
      `  mode:             ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}\n`,
  );

  if (plan.toDemote.length > 0) {
    process.stdout.write('\nDemotions (sample):\n');
    for (const id of plan.toDemote.slice(0, 10)) {
      process.stdout.write(`  ${id}\n`);
    }
    if (plan.toDemote.length > 10) {
      process.stdout.write(`  …and ${plan.toDemote.length - 10} more\n`);
    }
  }

  if (!args.apply) {
    process.stdout.write('\n(dry-run — pass --apply to write.)\n');
    return;
  }

  await applyPlan(db, plan);
  process.stdout.write(
    `\nApplied: demoted ${plan.toDemote.length}, backfilled ${plan.toBackfill.length}.\n`,
  );
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
