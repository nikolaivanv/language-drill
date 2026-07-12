import { describe, expect, it } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import { ALL_CURRICULA } from '../src/curriculum';
import {
  parseLanguage,
  parseLevel,
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
