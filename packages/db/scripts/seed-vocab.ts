/**
 * Seed the `vocab_lemma` table from the committed per-language artifacts at
 * packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json (produced by
 * `pnpm --filter @language-drill/ai build:vocab-lemma`).
 *
 * Usage: DATABASE_URL=... pnpm --filter @language-drill/db seed:vocab
 * Idempotent: upserts on the (language, lemma) PK.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { vocabLemma } from '../src/schema/index';

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

type SeedRow = { lemma: string; rank: number; posAll: string[]; source: string };

const ARTIFACT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'ai',
  'src',
  'frequency',
  'vocab-lemma',
);

async function seedLanguage(db: Db, lang: Lang): Promise<void> {
  const file = path.join(ARTIFACT_DIR, `${lang}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    console.warn(`[seed-vocab] ${lang}: artifact not found at ${file} — skipping`);
    return;
  }
  const rows = JSON.parse(raw) as SeedRow[];
  const language = lang.toUpperCase();
  // Insert in chunks to stay well under Postgres parameter limits.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map((r) => ({
      language,
      lemma: r.lemma,
      rank: r.rank,
      posAll: r.posAll,
      source: r.source,
    }));
    await db
      .insert(vocabLemma)
      .values(values)
      .onConflictDoUpdate({
        target: [vocabLemma.language, vocabLemma.lemma],
        set: {
          rank: sql`excluded.rank`,
          posAll: sql`excluded.pos_all`,
          source: sql`excluded.source`,
        },
      });
  }
  console.log(`[seed-vocab] ${lang}: upserted ${rows.length} lemmas`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);
  for (const lang of LANGUAGES) await seedLanguage(db, lang);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
