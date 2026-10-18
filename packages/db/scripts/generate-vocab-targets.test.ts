import { describe, expect, it, vi } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { ALL_CURRICULA } from '../src/curriculum';
import {
  assertFillMixReady,
  avoidForFamily,
  filterUmbrellaByKey,
  formatUmbrellaLog,
  loadLanguageLemmas,
  parseFillMix,
  parseWordCount,
  preflightPosTagged,
  selectFillMixUmbrellas,
  parseLanguage,
  parseLevel,
  parseUmbrella,
  resolveEsA1VocabUmbrellas,
  resolveVocabUmbrellas,
} from './generate-vocab-targets';

describe('resolveEsA1VocabUmbrellas', () => {
  it('returns only ES A1 vocab umbrellas', () => {
    const out = resolveEsA1VocabUmbrellas(ALL_CURRICULA);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.language).toBe('ES');
      expect(p.cefrLevel).toBe('A1');
      expect(p.kind).toBe('vocab');
    }
    expect(out.map((p) => p.key)).toContain('es-a1-vocab-food-drink');
  });
});

describe('resolveVocabUmbrellas', () => {
  it('returns only TR A1 vocab umbrellas for that scope', () => {
    const out = resolveVocabUmbrellas(ALL_CURRICULA, Language.TR, CefrLevel.A1);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.language).toBe('TR');
      expect(p.cefrLevel).toBe('A1');
      expect(p.kind).toBe('vocab');
    }
    expect(out.map((p) => p.key)).toContain('tr-a1-vocab-food-drink');
    // Does not bleed A2 umbrellas into the A1 scope.
    expect(out.map((p) => p.key)).not.toContain('tr-a2-vocab-work-school');
  });
});

describe('parseLanguage', () => {
  it('defaults to ES', () => {
    expect(parseLanguage([])).toBe(Language.ES);
  });
  it('parses and upper-cases a valid learning language', () => {
    expect(parseLanguage(['--language', 'tr'])).toBe(Language.TR);
  });
  it('rejects EN (not a learning language)', () => {
    expect(() => parseLanguage(['--language', 'EN'])).toThrow();
  });
  it('rejects an unknown language', () => {
    expect(() => parseLanguage(['--language', 'fr'])).toThrow();
  });
});

describe('parseUmbrella', () => {
  it('defaults to undefined (whole scope)', () => {
    expect(parseUmbrella([])).toBeUndefined();
  });
  it('parses the umbrella key verbatim', () => {
    expect(parseUmbrella(['--umbrella', 'tr-b1-vocab-education-career'])).toBe(
      'tr-b1-vocab-education-career',
    );
  });
});

describe('filterUmbrellaByKey', () => {
  const trB1 = resolveVocabUmbrellas(ALL_CURRICULA, Language.TR, CefrLevel.B1);
  it('returns the whole list when key is undefined', () => {
    expect(filterUmbrellaByKey(trB1, undefined)).toHaveLength(trB1.length);
  });
  it('narrows to the single matching umbrella', () => {
    const out = filterUmbrellaByKey(trB1, 'tr-b1-vocab-education-career');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('tr-b1-vocab-education-career');
  });
  it('throws when the key is not in the resolved scope', () => {
    expect(() => filterUmbrellaByKey(trB1, 'tr-a2-vocab-work-school')).toThrow();
    expect(() => filterUmbrellaByKey(trB1, 'does-not-exist')).toThrow();
  });
});

describe('parseLevel', () => {
  it('defaults to A1', () => {
    expect(parseLevel([])).toBe(CefrLevel.A1);
  });
  it('parses and upper-cases a valid level', () => {
    expect(parseLevel(['--level', 'a2'])).toBe(CefrLevel.A2);
  });
  it('rejects an unknown level', () => {
    expect(() => parseLevel(['--level', 'Z9'])).toThrow();
  });
});

describe('--fill-mix', () => {
  it('parses the flag and switches the default word count', () => {
    expect(parseFillMix(['--fill-mix'])).toBe(true);
    expect(parseFillMix([])).toBe(false);
    expect(parseWordCount([], true)).toBe(12);
    expect(parseWordCount([], false)).toBe(30);
    expect(parseWordCount(['--word-count', '8'], true)).toBe(8);
  });

  it('refuses an umbrella with untagged rows', () => {
    expect(() => assertFillMixReady('es-a1-vocab-food-drink', 3)).toThrow(
      'es-a1-vocab-food-drink has 3 rows without pos — run backfill:vocab-target-pos first',
    );
    expect(() => assertFillMixReady('es-a1-vocab-food-drink', 0)).not.toThrow();
  });
});

describe('loadLanguageLemmas', () => {
  it('reads every umbrella of the language, so a word curated elsewhere is avoided', async () => {
    const where = vi.fn().mockResolvedValue([
      { lemma: 'cena', pos: 'noun', umbrellaKey: 'es-a1-vocab-food-drink' },
      { lemma: 'comer', pos: 'verb', umbrellaKey: 'es-a1-vocab-everyday-verbs' },
    ]);
    const db = { select: () => ({ from: () => ({ where }) }) };
    const out = await loadLanguageLemmas(db as never, 'ES');
    expect(out).toEqual([
      { lemma: 'cena', pos: 'noun', umbrellaKey: 'es-a1-vocab-food-drink' },
      { lemma: 'comer', pos: 'verb', umbrellaKey: 'es-a1-vocab-everyday-verbs' },
    ]);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('carries the class so a homograph of another class stays open; untagged and unknown pos become null (wildcard)', async () => {
    const where = vi.fn().mockResolvedValue([
      { lemma: 'yemek', pos: 'noun', umbrellaKey: 'tr-a1-vocab-food-drink' },
      { lemma: 'su', pos: null, umbrellaKey: 'tr-a1-vocab-food-drink' },
      { lemma: 'çay', pos: 'bogus', umbrellaKey: 'tr-a1-vocab-food-drink' },
    ]);
    const db = { select: () => ({ from: () => ({ where }) }) };
    const out = await loadLanguageLemmas(db as never, 'TR');
    expect(out.map((w) => w.pos)).toEqual(['noun', null, null]);
  });
});

describe('avoidForFamily', () => {
  const point = (key: string) => {
    const p = ALL_CURRICULA.find((g) => g.key === key);
    if (!p) throw new Error(`missing ${key}`);
    return p;
  };
  const avoid = [
    { lemma: 'comprar', pos: 'verb' as const, umbrellaKey: 'es-a1-vocab-everyday-verbs' },
    { lemma: 'barato', pos: 'adjective' as const, umbrellaKey: 'es-a1-vocab-describing-words' },
    { lemma: 'tienda', pos: 'noun' as const, umbrellaKey: 'es-a2-vocab-city-shopping' },
    { lemma: 'pagar', pos: 'verb' as const, umbrellaKey: 'es-b1-vocab-money-consumers' },
    { lemma: 'viejo', pos: null, umbrellaKey: 'es-retired-umbrella' },
  ];

  it('lets a themed topic take words held by word-class groups, but not by other themed topics', () => {
    const out = avoidForFamily(avoid, point('es-a2-vocab-city-shopping'), ALL_CURRICULA);
    expect(out.map((w) => w.lemma)).toEqual(['tienda', 'pagar', 'viejo']);
  });

  it('lets a word-class group take words held by themed topics, but not by other groups', () => {
    const out = avoidForFamily(avoid, point('es-a1-vocab-everyday-verbs'), ALL_CURRICULA);
    expect(out.map((w) => w.lemma)).toEqual(['comprar', 'barato']);
  });
});

describe('formatUmbrellaLog', () => {
  const base = {
    umbrellaKey: 'u',
    fillMix: false,
    requestedNothing: false,
    rawCount: 10,
    keptCount: 8,
    keptRows: 8,
    inserted: 8,
    followUp: false,
    remainingShortfall: { verb: 0, adjectiveOrAdverb: 0 },
  };
  it('prints a plain success line', () => {
    expect(formatUmbrellaLog(base)).toBe('[u] proposed 10, kept 8, inserted 8\n');
  });
  it('flags a remaining shortfall and follow-up', () => {
    const line = formatUmbrellaLog({ ...base, followUp: true, remainingShortfall: { verb: 2, adjectiveOrAdverb: 1 } });
    expect(line).toContain('1 follow-up');
    expect(line).toContain('STILL SHORT verbs 2 / adj+adv 1');
  });
  it('marks a run that kept nothing', () => {
    expect(formatUmbrellaLog({ ...base, keptCount: 0, keptRows: 0, inserted: 0 })).toContain('NO WORDS KEPT');
  });
  it('says already balanced when fill-mix requested nothing', () => {
    expect(
      formatUmbrellaLog({ ...base, fillMix: true, requestedNothing: true, rawCount: 0, keptCount: 0, keptRows: 0, inserted: 0 }),
    ).toBe('[u] already balanced\n');
  });
});

describe('fill-mix selection and preflight', () => {
  const themed = { key: 't', kind: 'vocab' } as never;
  const group = { key: 'g', kind: 'vocab', vocabGroup: { label: 'verbs', pos: ['verb'] } } as never;

  it('skips word-class groups', () => {
    expect(selectFillMixUmbrellas([themed, group], undefined)).toEqual([themed]);
  });
  it('errors clearly when --umbrella names a word-class group', () => {
    expect(() => selectFillMixUmbrellas([group], 'g')).toThrow('--fill-mix skips word-class groups');
  });
  it('preflight refuses before any umbrella is authored', async () => {
    const results = [[{ pos: 'noun' }], [{ pos: null }, { pos: null }]];
    let call = 0;
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }) };
    const us = [{ key: 'a' }, { key: 'b' }] as never[];
    await expect(preflightPosTagged(db as never, 'ES', us)).rejects.toThrow('b has 2 rows without pos');
  });
  it('skips word-class groups in the preflight (they are restricted, not mixed)', async () => {
    const select = vi.fn();
    const db = { select };
    const out = await preflightPosTagged(db as never, 'ES', [group]);
    expect(out.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});
