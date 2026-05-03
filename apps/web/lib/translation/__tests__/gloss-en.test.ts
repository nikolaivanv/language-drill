import { describe, it, expect } from 'vitest';
import { ENGLISH_GLOSS, lookupGloss } from '../gloss-en';

describe('ENGLISH_GLOSS', () => {
  it('contains at least 60 entries', () => {
    expect(Object.keys(ENGLISH_GLOSS).length).toBeGreaterThanOrEqual(60);
  });

  it('has only lowercased keys', () => {
    for (const key of Object.keys(ENGLISH_GLOSS)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('has non-empty glosses for every entry', () => {
    for (const [key, entry] of Object.entries(ENGLISH_GLOSS)) {
      expect(entry.gloss, `gloss for "${key}"`).toBeTruthy();
      expect(entry.gloss.length, `gloss for "${key}"`).toBeGreaterThan(0);
    }
  });

  it('keeps every gloss within 60 characters', () => {
    for (const [key, entry] of Object.entries(ENGLISH_GLOSS)) {
      expect(
        entry.gloss.length,
        `gloss for "${key}" exceeds 60 chars: "${entry.gloss}"`,
      ).toBeLessThanOrEqual(60);
    }
  });

  it('uses one of the allowed POS values', () => {
    const allowed = new Set(['noun', 'verb', 'adj', 'adv', 'phrase']);
    for (const [key, entry] of Object.entries(ENGLISH_GLOSS)) {
      expect(allowed.has(entry.pos), `pos for "${key}"`).toBe(true);
    }
  });
});

describe('lookupGloss', () => {
  it('returns undefined for an unknown word', () => {
    expect(lookupGloss('xyznotaword')).toBeUndefined();
  });

  it('finds an entry for an exact lowercase token', () => {
    expect(lookupGloss('afford')).toBeDefined();
  });

  it('lowercases the token before lookup', () => {
    const exact = lookupGloss('afford');
    expect(lookupGloss('Afford')).toEqual(exact);
    expect(lookupGloss('AFFORD')).toEqual(exact);
  });

  it('strips trailing punctuation before lookup', () => {
    const exact = lookupGloss('afford');
    expect(lookupGloss('afford.')).toEqual(exact);
    expect(lookupGloss('afford,')).toEqual(exact);
    expect(lookupGloss('afford!')).toEqual(exact);
    expect(lookupGloss('afford?')).toEqual(exact);
  });

  it('strips leading punctuation before lookup', () => {
    const exact = lookupGloss('afford');
    expect(lookupGloss('(afford')).toEqual(exact);
    expect(lookupGloss('"afford')).toEqual(exact);
  });

  it('strips both leading and trailing punctuation', () => {
    const exact = lookupGloss('afford');
    expect(lookupGloss('"afford."')).toEqual(exact);
    expect(lookupGloss('(afford)')).toEqual(exact);
  });
});
