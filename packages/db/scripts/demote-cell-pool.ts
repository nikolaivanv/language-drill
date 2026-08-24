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
 * `--ids-file <path>` names the rows outright — one exercise id per line, `#`
 * comments allowed, same format as `revalidate:cloze` (shared implementation in
 * ./lib/ids-file.ts). Use it when the subset is defined by something the other
 * filters cannot see. The motivating case (2026-08-24): a demotion driven by
 * `coverage_tags` is not expressible at all here, because `--content-ilike`
 * reads `content_json` while `case`/`number` live in a separate column. The
 * `de-b1-relative-pronouns` zip-residue demotion had to be steered through
 * `correctAnswer` spellings instead, which worked only because that cell
 * happened to have a clean lexical handle — `referenceTranslation` on the
 * translation half did not, since an unanchored `deren` also matches `anderen`.
 *
 * Three properties make it safe to point at a captured worklist:
 *   - ids narrow ON TOP of the cell filters, never instead of them, so a stale
 *     or mis-built file cannot reach rows outside the cell you named;
 *   - it is mutually exclusive with `--limit` and `--content-ilike`, which
 *     would otherwise silently demote some other subset than the file lists;
 *   - any id that does not match an approved row in the cell ABORTS the run,
 *     naming the offenders. Demoting fewer rows than the worklist names is the
 *     exact failure this flag exists to prevent, and every cause is worth
 *     stopping for (already demoted, wrong cell, stale capture).
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
 *   pnpm demote:pool -- --language DE --cefr B1 --type cloze --grammar-point de-b1-relative-pronouns --ids-file docs/analysis/worklist.txt --reason pool-hygiene
 *
 * Required env: DATABASE_URL.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../src/client';
import { createDb } from '../src/client';
import { exercises } from '../src/schema';
import { DEMOTION_REASONS, NON_EVIDENCE_DEMOTION_REASONS, type DemotionReason } from '../src/lib/evidence';
import { parseIdsFile, readIdsFile } from './lib/ids-file';

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
  /** Cap the number of rows demoted (oldest first). null = no cap. */
  limit: number | null;
  /**
   * Path to a worklist of exercise ids, one per line. Held as a PATH, not as
   * parsed ids, so `parseDemoteArgs` stays pure and unit-testable without a
   * filesystem; `main()` resolves and reads it.
   */
  idsFile: string | null;
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

  let limit: number | null = null;
  if (argv.includes('--limit')) {
    // `get()` alone can't tell "flag absent" from "flag present, no value" —
    // both return null. That ambiguity is harmless for the other flags here,
    // but for `--limit` it is dangerous: `--limit` as the final token would
    // silently resolve to "no cap" and demote an entire matching cell instead
    // of throwing. Check presence explicitly and require a value.
    const rawLimit = get('--limit');
    if (rawLimit === null) {
      throw new Error('--limit requires a value (e.g. --limit 28) — given with no argument');
    }
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive integer (got '${rawLimit}')`);
    }
    limit = parsed;
  }

  let idsFile: string | null = null;
  if (argv.includes('--ids-file')) {
    // Same presence check as --limit above, for the same reason: `--ids-file`
    // as the final token would otherwise resolve to null and silently demote
    // the whole cell instead of the named rows.
    idsFile = get('--ids-file');
    if (idsFile === null) {
      throw new Error('--ids-file requires a value (e.g. --ids-file worklist.txt) — given with no argument');
    }
  }

  const contentIlike = get('--content-ilike');

  // Both of these also narrow the selection, and an operator passing one
  // alongside --ids-file almost certainly believes it is doing something it is
  // not. Refuse rather than silently letting one win.
  if (idsFile !== null && limit !== null) {
    throw new Error(
      '--ids-file cannot be combined with --limit: the id list IS the selection, ' +
        'so a cap could only demote an arbitrary subset of the rows the file names.',
    );
  }
  if (idsFile !== null && contentIlike !== null) {
    throw new Error(
      '--ids-file cannot be combined with --content-ilike: both narrow the selection. ' +
        'Filter the worklist when you build it instead.',
    );
  }

  return {
    language: language.toUpperCase(),
    cefr: cefr.toUpperCase(),
    type,
    grammarPoint,
    contentIlike,
    apply: argv.includes('--apply'),
    reason: reason as DemotionReason,
    limit,
    idsFile,
  };
}

// ---------------------------------------------------------------------------
// Row selection (extracted so it can be unit-tested against a mocked Db)
// ---------------------------------------------------------------------------

export type SelectRowsArgs = Pick<
  DemoteArgs,
  'language' | 'cefr' | 'type' | 'grammarPoint' | 'contentIlike' | 'limit'
> & {
  /** Resolved worklist ids from `--ids-file`, or null. */
  ids: readonly string[] | null;
};

/**
 * The requested ids that no selected row carries.
 *
 * `demote:pool` is a destructive write on a set the operator captured ahead of
 * time, so demoting fewer rows than the file names must be loud. Causes are all
 * things worth stopping for: the row was already demoted (a re-run), it is in a
 * different cell than the one named, or the capture is stale.
 *
 * Case-insensitive: `parseIdsFile` lowercases what it reads, but ids coming
 * back from Postgres need not match that casing, and a false "missing" would
 * block a correct run.
 */
export function findUnmatchedIds(
  requested: readonly string[],
  rows: readonly { id: string }[],
): string[] {
  const found = new Set(rows.map((r) => r.id.toLowerCase()));
  return requested.filter((id) => !found.has(id.toLowerCase()));
}

/**
 * Selects the approved rows matching a cell (+ optional content filter),
 * capped to the oldest `limit` rows when set. Dry-run and --apply in
 * `main()` both call this exact function once and share its result, so the
 * printed count always matches what --apply would actually demote. Oldest-
 * first (`ORDER BY created_at ASC`) keeps the most recently generated — and
 * so most prompt-current — rows in the pool. Without a limit, no ORDER BY /
 * LIMIT is applied at all — identical query to before the flag existed.
 */
export async function selectRowsToDemote(
  db: Db,
  args: SelectRowsArgs,
): Promise<{ id: string; contentJson: unknown }[]> {
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
  if (args.ids) {
    // ON TOP of the cell filters, never instead of them: the operator still
    // declares which cell they are demoting from, so a stale or mis-built
    // worklist cannot reach rows outside it.
    filters.push(inArray(exercises.id, [...args.ids]));
  }

  const baseQuery = db
    .select({ id: exercises.id, contentJson: exercises.contentJson })
    .from(exercises)
    .where(and(...filters));

  // No ORDER BY / LIMIT with an ids file — the list IS the selection, not a
  // slice of one, and parseDemoteArgs already refuses --ids-file with --limit.
  return args.limit !== null
    ? await baseQuery.orderBy(asc(exercises.createdAt)).limit(args.limit)
    : await baseQuery;
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

  const ids = args.idsFile ? parseIdsFile(readIdsFile(args.idsFile)) : null;

  const rows = await selectRowsToDemote(db, { ...args, ids });

  if (ids) {
    const missing = findUnmatchedIds(ids, rows);
    if (missing.length > 0) {
      console.error(
        `[demote-pool] ${missing.length} of ${ids.length} ids in '${args.idsFile}' do not match an ` +
          `approved row in ${args.language}/${args.cefr}/${args.type}/${args.grammarPoint}:`,
      );
      for (const id of missing.slice(0, 10)) console.error(`  ${id}`);
      if (missing.length > 10) console.error(`  …and ${missing.length - 10} more`);
      throw new Error(
        'Refusing to proceed: demoting fewer rows than the worklist names is the failure this ' +
          'flag exists to prevent. Each missing id is already demoted (a re-run), in a different ' +
          'cell, or from a stale capture. Re-derive the worklist, or trim it to what is still ' +
          'approved, so the file says exactly what will happen.',
      );
    }
  }

  const scope = `${args.language}/${args.cefr}/${args.type}/${args.grammarPoint}` +
    (args.contentIlike ? ` (content ILIKE '%${args.contentIlike}%')` : '') +
    (ids ? ` (ids-file ${args.idsFile}, ${ids.length} ids, all matched)` : '') +
    (args.limit !== null ? ` (limit ${args.limit}, oldest first)` : '');

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

  if ((NON_EVIDENCE_DEMOTION_REASONS as readonly DemotionReason[]).includes(args.reason)) {
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
