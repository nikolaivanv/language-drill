/**
 * DB-backed frequency / verb bands for generation seed selection. Queries
 * `vocab_lemma` (lemma-level, PoS-bearing) and returns deduped-by-lemma
 * arrays with stopwords removed and rows ordered by rank ascending with lemma
 * tie-break. The deterministic `pickSeeds`/`pickConjugationSeeds` consume the
 * returned array.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { loadFrequency } from '@language-drill/ai';
import type { LearningLanguage } from '@language-drill/shared';

import type { Db } from '../client';
import { vocabLemma } from '../schema/index';

async function bandQuery(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
  verbsOnly: boolean,
): Promise<readonly string[]> {
  const conds = [
    eq(vocabLemma.language, language),
    gte(vocabLemma.rank, rankMin),
    lte(vocabLemma.rank, rankMax),
  ];
  if (verbsOnly) conds.push(sql`'VERB' = ANY(${vocabLemma.posAll})`);

  const rows = await db
    .select({ lemma: vocabLemma.lemma })
    .from(vocabLemma)
    .where(and(...conds))
    .orderBy(asc(vocabLemma.rank), asc(vocabLemma.lemma));

  const { isStopword } = loadFrequency(language);
  return rows.map((r) => r.lemma).filter((lemma) => !isStopword(lemma));
}

export function loadFrequencyBand(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): Promise<readonly string[]> {
  return bandQuery(db, language, rankMin, rankMax, false);
}

export function loadVerbBand(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): Promise<readonly string[]> {
  return bandQuery(db, language, rankMin, rankMax, true);
}
