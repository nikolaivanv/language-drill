/**
 * `pnpm generate:vocab-targets` — Claude-backed authoring of curated
 * vocabulary targets. For each vocab umbrella in the selected
 * `(language, level)` scope, proposes words, validates them structurally,
 * joins corpus frequency, and inserts rows `status='flagged'` for human review
 * (`pnpm review:flagged-vocab`). Idempotent: re-runs skip lemmas already
 * present for the umbrella (avoid-list + onConflictDoNothing).
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 * Usage: pnpm --filter @language-drill/db generate:vocab-targets \
 *          [--language ES] [--level A1] [--word-count 30] [--umbrella <key>] [--fill-mix]
 * Defaults to ES A1 when --language/--level are omitted (original behaviour).
 * `--umbrella <key>` restricts the run to a single umbrella in that scope
 * (surgical top-up without re-growing the whole level).
 * `--fill-mix` tops up existing themed umbrellas toward the word-class mix
 * (default --word-count 12); word-class groups are skipped, and an umbrella
 * with untagged rows is refused until `backfill:vocab-target-pos` has run.
 */

import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { createClaudeClient } from '@language-drill/ai';
import {
  CefrLevel,
  Language,
  parseVocabPos,
  type CefrLevel as CefrLevelType,
  type GrammarPoint,
  type LearningLanguage,
} from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';
import { countPos, type PosCounts, type Shortfall } from '../src/vocab-target/mix';
import { runOneUmbrella } from '../src/vocab-target/run-one-umbrella';

const DEFAULT_WORD_COUNT = 30;
const DEFAULT_LANGUAGE: LearningLanguage = Language.ES;
const DEFAULT_LEVEL: CefrLevelType = CefrLevel.A1;

/** Vocab umbrellas for one `(language, level)` scope. */
export function resolveVocabUmbrellas(
  curricula: readonly GrammarPoint[],
  language: LearningLanguage,
  level: CefrLevelType,
): GrammarPoint[] {
  return curricula.filter(
    (p) => p.language === language && p.cefrLevel === level && p.kind === 'vocab',
  );
}

/** Back-compat helper retained for existing callers/tests. */
export function resolveEsA1VocabUmbrellas(
  curricula: readonly GrammarPoint[],
): GrammarPoint[] {
  return resolveVocabUmbrellas(curricula, Language.ES, CefrLevel.A1);
}

/**
 * Every curated lemma in the language, any umbrella, any status — the
 * avoid-list, so one word lives in exactly one group per language.
 */
export async function loadLanguageLemmas(db: Db, language: LearningLanguage): Promise<string[]> {
  const rows = await db
    .select({ lemma: vocabTarget.lemma })
    .from(vocabTarget)
    .where(eq(vocabTarget.language, language));
  return rows.map((r) => r.lemma);
}

/** Class counts of an umbrella's live (flagged + approved) rows; untagged = pos null. */
export async function loadUmbrellaPosCounts(
  db: Db,
  language: LearningLanguage,
  umbrellaKey: string,
): Promise<{ counts: PosCounts; untagged: number }> {
  const rows = await db
    .select({ pos: vocabTarget.pos })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, language),
        eq(vocabTarget.umbrellaKey, umbrellaKey),
        inArray(vocabTarget.status, ['flagged', 'approved']),
      ),
    );
  const parsed = rows.map((r) => ({ pos: parseVocabPos(r.pos) }));
  return { counts: countPos(parsed), untagged: parsed.filter((r) => r.pos === null).length };
}

export function parseFillMix(argv: readonly string[]): boolean {
  return argv.includes('--fill-mix');
}

export function assertFillMixReady(umbrellaKey: string, untagged: number): void {
  if (untagged > 0) {
    throw new Error(
      `${umbrellaKey} has ${untagged} rows without pos — run backfill:vocab-target-pos first`,
    );
  }
}

const FILL_MIX_WORD_COUNT = 12;

export function parseWordCount(argv: readonly string[], fillMix: boolean): number {
  const i = argv.indexOf('--word-count');
  if (i !== -1 && argv[i + 1]) {
    const n = Number.parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fillMix ? FILL_MIX_WORD_COUNT : DEFAULT_WORD_COUNT;
}

/**
 * One per-umbrella log line. A run that kept nothing must not look like
 * success (`remainingShortfall` is measured on the kept set, so it reads
 * {0,0} then) — unless a fill-mix plan asked for nothing.
 */
export function formatUmbrellaLog(args: {
  umbrellaKey: string;
  fillMix: boolean;
  requestedNothing: boolean;
  rawCount: number;
  keptCount: number;
  keptRows: number;
  inserted: number;
  followUp: boolean;
  remainingShortfall: Shortfall;
}): string {
  const { umbrellaKey, remainingShortfall: sf } = args;
  if (args.keptRows === 0) {
    if (args.fillMix && args.requestedNothing) return `[${umbrellaKey}] already balanced\n`;
    return `[${umbrellaKey}] NO WORDS KEPT (proposed ${args.rawCount}, kept ${args.keptCount}, inserted ${args.inserted})\n`;
  }
  const short = sf.verb + sf.adjectiveOrAdverb;
  return (
    `[${umbrellaKey}] proposed ${args.rawCount}, kept ${args.keptCount}, inserted ${args.inserted}` +
    `${args.followUp ? ', 1 follow-up' : ''}` +
    `${short > 0 ? `, STILL SHORT verbs ${sf.verb} / adj+adv ${sf.adjectiveOrAdverb}` : ''}\n`
  );
}

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

export function parseLanguage(argv: readonly string[]): LearningLanguage {
  const raw = parseFlag(argv, '--language');
  if (raw === undefined) return DEFAULT_LANGUAGE;
  const upper = raw.toUpperCase();
  const valid = (Object.values(Language) as string[]).filter((l) => l !== Language.EN);
  if (!valid.includes(upper)) {
    throw new Error(
      `--language must be one of ${valid.join(', ')} (got "${raw}")`,
    );
  }
  return upper as LearningLanguage;
}

export function parseUmbrella(argv: readonly string[]): string | undefined {
  return parseFlag(argv, '--umbrella');
}

/**
 * Narrow a resolved umbrella list to a single key (surgical top-up of one
 * umbrella without re-running — and over-growing — its whole level). Undefined
 * key ⇒ the full list. Throws if the key isn't a vocab umbrella in scope.
 */
export function filterUmbrellaByKey(
  umbrellas: readonly GrammarPoint[],
  key: string | undefined,
): GrammarPoint[] {
  if (key === undefined) return [...umbrellas];
  const match = umbrellas.filter((u) => u.key === key);
  if (match.length === 0) {
    throw new Error(
      `--umbrella "${key}" is not a vocab umbrella in the selected language/level scope`,
    );
  }
  return match;
}

export function parseLevel(argv: readonly string[]): CefrLevelType {
  const raw = parseFlag(argv, '--level');
  if (raw === undefined) return DEFAULT_LEVEL;
  const upper = raw.toUpperCase();
  if (!(Object.values(CefrLevel) as string[]).includes(upper)) {
    throw new Error(
      `--level must be one of ${Object.values(CefrLevel).join(', ')} (got "${raw}")`,
    );
  }
  return upper as CefrLevelType;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const argv = process.argv.slice(2);
  const fillMix = parseFillMix(argv);
  const wordCount = parseWordCount(argv, fillMix);
  const language = parseLanguage(argv);
  const level = parseLevel(argv);
  const umbrellaKey = parseUmbrella(argv);

  const db = createDb(databaseUrl);
  const client = createClaudeClient(anthropicApiKey);
  const resolved = filterUmbrellaByKey(
    resolveVocabUmbrellas(ALL_CURRICULA, language, level),
    umbrellaKey,
  );
  // --fill-mix tops up themed topics only; word-class groups are skipped.
  const umbrellas = fillMix ? resolved.filter((u) => !u.vocabGroup) : resolved;

  process.stdout.write(
    `Authoring ${umbrellas.length} ${language} ${level} vocab umbrella(s)` +
      `${umbrellaKey ? ` (filtered to ${umbrellaKey})` : ''}${fillMix ? ' in --fill-mix mode' : ''}, ~${wordCount} words each.\n`,
  );

  for (const umbrella of umbrellas) {
    const { counts, untagged } = await loadUmbrellaPosCounts(db, language, umbrella.key);
    if (fillMix) assertFillMixReady(umbrella.key, untagged);
    // Reloaded per umbrella so words inserted earlier in this run are avoided.
    const avoidWords = await loadLanguageLemmas(db, language);
    const { rows, rawCount, keptCount, followUp, remainingShortfall } = await runOneUmbrella({
      db,
      client,
      umbrella,
      wordCount,
      avoidWords,
      existing: counts,
      fillMix,
    });

    let inserted = 0;
    if (rows.length > 0) {
      const res = await db
        .insert(vocabTarget)
        .values(rows)
        .onConflictDoNothing({
          target: [
            vocabTarget.language,
            vocabTarget.umbrellaKey,
            vocabTarget.lemma,
          ],
        })
        .returning({ id: vocabTarget.id });
      inserted = res.length;
    }
    process.stdout.write(
      formatUmbrellaLog({
        umbrellaKey: umbrella.key,
        fillMix,
        requestedNothing: rawCount === 0,
        rawCount,
        keptCount,
        keptRows: rows.length,
        inserted,
        followUp: Boolean(followUp),
        remainingShortfall,
      }),
    );
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
