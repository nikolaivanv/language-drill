/**
 * One-off backfill of gloss_cache from user_vocabulary. Dry-run by default.
 *   pnpm --filter @language-drill/db seed:gloss-cache            # dry run
 *   pnpm --filter @language-drill/db seed:gloss-cache --apply
 *   pnpm --filter @language-drill/db seed:gloss-cache --apply --language ES --limit 5000
 * Read-only over user_vocabulary; upserts with onConflictDoNothing so it never
 * clobbers a live-minted entry and is safe to re-run.
 */
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { glossCache, userVocabulary } from '../src/schema';
import { deriveSeedRows, type SeedVocabRow } from '../src/gloss-cache/derive-seed';
import type { LearningLanguage } from '@language-drill/shared';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  const apply = process.argv.includes('--apply');
  const languageArg = arg('language');
  const language = languageArg
    ? (languageArg.toUpperCase() as LearningLanguage)
    : undefined;
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  const q = db
    .select({
      language: userVocabulary.language,
      lemma: userVocabulary.lemma,
      gloss: userVocabulary.gloss,
      pos: userVocabulary.pos,
      cefrBand: userVocabulary.cefrBand,
      frequencyRank: userVocabulary.frequencyRank,
      card: userVocabulary.card,
      addedAt: userVocabulary.addedAt,
    })
    .from(userVocabulary)
    .where(language ? eq(userVocabulary.language, language) : undefined);
  const rows = (limit ? await q.limit(limit) : await q) as SeedVocabRow[];

  const seedRows = deriveSeedRows(rows);
  console.log(
    `[seed:gloss-cache] source rows=${rows.length} -> unique lemmas=${seedRows.length} (apply=${apply})`,
  );

  if (!apply) {
    console.log('[seed:gloss-cache] dry run — no writes. Re-run with --apply.');
    console.log(seedRows.slice(0, 10));
    return;
  }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < seedRows.length; i += BATCH) {
    const chunk = seedRows.slice(i, i + BATCH);
    await db.insert(glossCache).values(chunk).onConflictDoNothing({
      target: [glossCache.language, glossCache.lemma],
    });
    written += chunk.length;
    console.log(`[seed:gloss-cache] upserted ${written}/${seedRows.length}`);
  }
  console.log('[seed:gloss-cache] done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
