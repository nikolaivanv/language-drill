/**
 * `pnpm demote:pool` — one-off CLI to demote a single cell's approved
 * exercises back out of the pool so the scheduler regenerates them.
 *
 * Background: some cells accrue approved rows that later turn out to be
 * structurally bad (e.g. the self-revealing-target identity-space collapse
 * — see docs/findings/2026-07-07-self-revealing-target-elicitation.md).
 * Once the generation/validation prompts are fixed, the existing bad rows
 * for that cell need to be cleared so the scheduler re-fills the cell under
 * the corrected prompts.
 *
 * Scope is a single (language, cefr, type, grammarPointKey) cell — narrower
 * than `dedupe-conjugation-pool.ts`, which sweeps a whole language/level.
 * An optional `--content-ilike` substring further narrows to rows whose
 * `content_json` (cast to text) contains it, for surgically demoting only
 * the affected subset of a cell rather than every approved row in it.
 *
 * It never DELETEs — `user_exercise_history` and `playlists` reference
 * `exercises.id` without cascade, so demotion (`review_status = 'rejected'`)
 * preserves the learner's practice history and mastery linkage while
 * removing the rows from every serve path, the scheduler's per-cell target
 * count, and the dedup unique index.
 *
 * Defaults to DRY-RUN; pass --apply to write.
 *
 * Usage:
 *   pnpm demote:pool -- --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals --reason quality
 *   pnpm demote:pool -- --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals --content-ilike üçüncü --reason quality
 *   pnpm demote:pool -- --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals --reason quality --apply
 *
 * Required env: DATABASE_URL.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { createDb } from '../src/client';
import { exercises } from '../src/schema';
import { DEMOTION_REASONS, type DemotionReason } from '../src/lib/evidence';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type DemoteArgs = {
  language: string;
  cefr: string;
  type: string;
  grammarPoint: string;
  contentIlike: string | null;
  apply: boolean;
  reason: DemotionReason;
};

export function parseDemoteArgs(argv: readonly string[]): DemoteArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

  const language = get('--language');
  const cefr = get('--cefr');
  const type = get('--type');
  const grammarPoint = get('--grammar-point');
  if (!language || !cefr || !type || !grammarPoint) {
    throw new Error('--language, --cefr, --type, --grammar-point are required');
  }

  const reason = get('--reason');
  if (!reason || !(DEMOTION_REASONS as readonly string[]).includes(reason)) {
    throw new Error(
      `--reason is required and must be one of: ${DEMOTION_REASONS.join(' | ')}. ` +
        `It decides whether learners keep credit for attempts on these rows — ` +
        `'quality' and 'learner-flag' revoke it, 'duplicate' and 'pool-hygiene' keep it.`,
    );
  }

  return {
    language: language.toUpperCase(),
    cefr: cefr.toUpperCase(),
    type,
    grammarPoint,
    contentIlike: get('--content-ilike'),
    apply: argv.includes('--apply'),
    reason: reason as DemotionReason,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseDemoteArgs(process.argv.slice(2));

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  const filters = [
    eq(exercises.language, args.language),
    eq(exercises.difficulty, args.cefr),
    eq(exercises.type, args.type),
    eq(exercises.grammarPointKey, args.grammarPoint),
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
  ];
  if (args.contentIlike) {
    filters.push(sql`${exercises.contentJson}::text ILIKE ${'%' + args.contentIlike + '%'}`);
  }

  const rows = await db
    .select({ id: exercises.id, contentJson: exercises.contentJson })
    .from(exercises)
    .where(and(...filters));

  const scope = `${args.language}/${args.cefr}/${args.type}/${args.grammarPoint}` +
    (args.contentIlike ? ` (content ILIKE '%${args.contentIlike}%')` : '');

  console.log(
    `[demote-pool] ${args.apply ? 'APPLY' : 'DRY-RUN'} — ${scope}: ${rows.length} approved rows match` +
      (args.apply ? '' : ' (dry-run — pass --apply to demote)'),
  );

  for (const r of rows.slice(0, 5)) {
    console.log('  sample:', JSON.stringify(r.contentJson).slice(0, 120));
  }
  if (rows.length > 5) console.log(`  …and ${rows.length - 5} more`);

  if (!args.apply) {
    console.log('[demote-pool] dry-run only — pass --apply to write.');
    return;
  }

  for (const r of rows) {
    await db
      .update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: args.reason })
      .where(eq(exercises.id, r.id));
  }

  console.log(`[demote-pool] demoted ${rows.length} rows to 'rejected' (reason: ${args.reason}).`);

  if (args.reason === 'quality' || args.reason === 'learner-flag') {
    console.log(
      '[demote-pool] These attempts no longer count as learner evidence. ' +
        'Stored mastery is now stale — run `pnpm backfill:mastery --apply` against this database.',
    );
  }
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
