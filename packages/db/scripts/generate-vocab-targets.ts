/**
 * `pnpm generate:vocab-targets` — Claude-backed authoring of curated ES A1
 * vocabulary targets. For each ES A1 vocab umbrella, proposes words, validates
 * them structurally, joins corpus frequency, and inserts rows `status='flagged'`
 * for human review (`pnpm review:flagged-vocab`). Idempotent: re-runs skip
 * lemmas already present for the umbrella (avoid-list + onConflictDoNothing).
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 * Usage: pnpm --filter @language-drill/db generate:vocab-targets [--word-count 30]
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createClaudeClient } from '@language-drill/ai';
import type { GrammarPoint } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';
import { runOneUmbrella } from '../src/vocab-target/run-one-umbrella';

const DEFAULT_WORD_COUNT = 30;

export function resolveEsA1VocabUmbrellas(
  curricula: readonly GrammarPoint[],
): GrammarPoint[] {
  return curricula.filter(
    (p) => p.language === 'ES' && p.cefrLevel === 'A1' && p.kind === 'vocab',
  );
}

export async function loadExistingLemmas(
  db: Db,
  umbrellaKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ lemma: vocabTarget.lemma })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, 'ES'),
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

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const wordCount = parseWordCount(process.argv.slice(2));

  const db = createDb(databaseUrl);
  const client = createClaudeClient(anthropicApiKey);
  const umbrellas = resolveEsA1VocabUmbrellas(ALL_CURRICULA);

  process.stdout.write(
    `Authoring ${umbrellas.length} ES A1 vocab umbrella(s), ~${wordCount} words each.\n`,
  );

  for (const umbrella of umbrellas) {
    const avoidWords = await loadExistingLemmas(db, umbrella.key);
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
