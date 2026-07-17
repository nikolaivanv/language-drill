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
 *          [--language ES] [--level A1] [--word-count 30] [--umbrella <key>]
 * Defaults to ES A1 when --language/--level are omitted (original behaviour).
 * `--umbrella <key>` restricts the run to a single umbrella in that scope
 * (surgical top-up without re-growing the whole level).
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createClaudeClient } from '@language-drill/ai';
import {
  CefrLevel,
  Language,
  type CefrLevel as CefrLevelType,
  type GrammarPoint,
  type LearningLanguage,
} from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';
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

export async function loadExistingLemmas(
  db: Db,
  language: LearningLanguage,
  umbrellaKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ lemma: vocabTarget.lemma })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, language),
        eq(vocabTarget.umbrellaKey, umbrellaKey),
      ),
    );
  return rows.map((r) => r.lemma);
}

function parseWordCount(argv: readonly string[]): number {
  const i = argv.indexOf('--word-count');
  if (i !== -1 && argv[i + 1]) {
    const n = Number.parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_WORD_COUNT;
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
  const wordCount = parseWordCount(argv);
  const language = parseLanguage(argv);
  const level = parseLevel(argv);
  const umbrellaKey = parseUmbrella(argv);

  const db = createDb(databaseUrl);
  const client = createClaudeClient(anthropicApiKey);
  const umbrellas = filterUmbrellaByKey(
    resolveVocabUmbrellas(ALL_CURRICULA, language, level),
    umbrellaKey,
  );

  process.stdout.write(
    `Authoring ${umbrellas.length} ${language} ${level} vocab umbrella(s)` +
      `${umbrellaKey ? ` (filtered to ${umbrellaKey})` : ''}, ~${wordCount} words each.\n`,
  );

  for (const umbrella of umbrellas) {
    const avoidWords = await loadExistingLemmas(db, language, umbrella.key);
    const { rows, rawCount, keptCount } = await runOneUmbrella({
      db,
      client,
      umbrella,
      wordCount,
      avoidWords,
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
      `[${umbrella.key}] proposed ${rawCount}, kept ${keptCount}, inserted ${inserted}\n`,
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
