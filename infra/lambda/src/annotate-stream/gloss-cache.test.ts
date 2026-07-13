import { describe, it, expect } from 'vitest';
import { wordFlagFromCacheRow } from './gloss-cache';
import type { GlossCacheRow } from '@language-drill/db';
import { CefrLevel, Language } from '@language-drill/shared';

// `language`/`cefr` are backed by real TS enums (not string-literal unions) —
// production code always writes `Language.ES` / `CefrLevel.B1`, never the
// lowercase/plain-string form, so the fixture matches that convention.
const baseRow: GlossCacheRow = {
  language: Language.ES,
  lemma: 'banco',
  baseGloss: 'bench; bank',
  pos: 'noun',
  cefr: CefrLevel.B1,
  freqRank: 4200,
  source: 'skim',
  promptVersion: 'annotate@2026-07-13',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('wordFlagFromCacheRow', () => {
  it('synthesizes a WordFlag using server freq and cache gloss/pos/cefr', () => {
    const flag = wordFlagFromCacheRow(baseRow, 'bancos', 4200);
    expect(flag).toEqual({
      matchedForm: 'bancos',
      lemma: 'banco',
      pos: 'noun',
      gloss: 'bench; bank',
      freq: 4200,
      cefr: 'B1',
    });
  });

  it('returns null when the cached row has no cefr (not a valid skim hit)', () => {
    const flag = wordFlagFromCacheRow({ ...baseRow, cefr: null }, 'banco', 4200);
    expect(flag).toBeNull();
  });
});
