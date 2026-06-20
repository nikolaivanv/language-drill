import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Language } from '@language-drill/shared';

import { createDb, type Db } from '../client';
import { vocabLemma } from '../schema/index';
import { loadFrequencyBand, loadVerbBand } from './vocab-band';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;

d('vocab-band loaders', () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(TEST_DB_URL!);
    await db.delete(vocabLemma);
    await db.insert(vocabLemma).values([
      { language: 'ES', lemma: 'hablar', rank: 50, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'comer', rank: 70, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'casa', rank: 60, posAll: ['NOUN'], source: 'wiktextract' },
      { language: 'ES', lemma: 'el', rank: 1, posAll: ['DET'], source: 'wiktextract' }, // stopword
      { language: 'ES', lemma: 'lejano', rank: 9000, posAll: ['ADJ'], source: 'wiktextract' }, // out of band
    ]);
  });

  afterAll(async () => {
    await db.delete(vocabLemma);
  });

  it('returns content-word lemmas in band, ordered by rank, stopwords removed', async () => {
    const band = await loadFrequencyBand(db, Language.ES, 1, 1000);
    expect(band).toEqual(['hablar', 'casa', 'comer']); // 50, 60, 70; 'el' filtered as stopword
  });

  it('excludes out-of-band lemmas', async () => {
    const band = await loadFrequencyBand(db, Language.ES, 1, 1000);
    expect(band).not.toContain('lejano');
  });

  it('loadVerbBand returns only VERB-tagged lemmas', async () => {
    const band = await loadVerbBand(db, Language.ES, 1, 1000);
    expect(band).toEqual(['hablar', 'comer']);
    expect(band).not.toContain('casa');
  });

  it('returns an empty band when nothing matches', async () => {
    const band = await loadVerbBand(db, Language.DE, 1, 1000);
    expect(band).toEqual([]);
  });
});
