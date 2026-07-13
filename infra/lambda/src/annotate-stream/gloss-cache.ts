/**
 * Cross-user base-gloss cache access for the reading-annotation Lambdas.
 * Read side (skim hits) + write side (skim misses + resolved deep cards).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  glossCache,
  type GlossCacheRow,
  type NewGlossCacheRow,
} from '@language-drill/db';
import type { LearningLanguage, WordFlag } from '@language-drill/shared';

import { db } from '../db';

/** Fetch cached rows for the given lemmas, keyed by lemma. */
export async function lookupGlossCache(
  language: LearningLanguage,
  lemmas: string[],
): Promise<Map<string, GlossCacheRow>> {
  const unique = [...new Set(lemmas)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(glossCache)
    .where(and(eq(glossCache.language, language), inArray(glossCache.lemma, unique)));
  return new Map(rows.map((r) => [r.lemma, r]));
}

/**
 * Build a skim `WordFlag` from a cached row. `freq` comes from the caller
 * (the server frequency dict, authoritative for known lemmas). Returns null
 * when the row lacks a `cefr` band — such a row cannot form a valid WordFlag,
 * so the caller must treat the lemma as a cache miss.
 */
export function wordFlagFromCacheRow(
  row: GlossCacheRow,
  matchedForm: string,
  freq: number,
): (WordFlag & { matchedForm: string }) | null {
  if (row.cefr === null) return null;
  return {
    matchedForm,
    lemma: row.lemma,
    pos: row.pos,
    gloss: row.baseGloss,
    freq,
    cefr: row.cefr,
  };
}

/** Batch upsert on conflict (language, lemma). Last-write-wins. */
export async function upsertGlossCacheRows(rows: NewGlossCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(glossCache)
    .values(rows)
    .onConflictDoUpdate({
      target: [glossCache.language, glossCache.lemma],
      set: {
        baseGloss: sql`excluded.base_gloss`,
        pos: sql`excluded.pos`,
        cefr: sql`excluded.cefr`,
        freqRank: sql`excluded.freq_rank`,
        source: sql`excluded.source`,
        promptVersion: sql`excluded.prompt_version`,
        updatedAt: sql`now()`,
      },
    });
}
