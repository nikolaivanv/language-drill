import { describe, expect, it } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { ALL_CURRICULA } from '../src/curriculum';
import {
  filterUmbrellaByKey,
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
