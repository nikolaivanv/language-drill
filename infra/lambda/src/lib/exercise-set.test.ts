import { describe, it, expect } from 'vitest';
import { conjugationSignature, dedupeBySignature } from './exercise-set';

describe('conjugationSignature', () => {
  it('builds a lemma|target|pronoun signature', () => {
    expect(
      conjugationSignature({
        lemma: 'öğrenci',
        targetForm: 'öğrencisin',
        subject: { pronoun: 'sen' },
      }),
    ).toBe('öğrenci|öğrencisin|sen');
  });

  it('tolerates missing fields and non-objects', () => {
    expect(conjugationSignature({})).toBe('||');
    expect(conjugationSignature(null)).toBe('||');
    expect(conjugationSignature(undefined)).toBe('||');
    expect(conjugationSignature({ lemma: 'ev', subject: null })).toBe('ev||');
  });

  it('treats the same prompt with different example sentences as one signature', () => {
    const a = {
      lemma: 'öğrenci',
      targetForm: 'öğrencisin',
      subject: { pronoun: 'sen' },
      exampleSentences: ['A'],
    };
    const b = { ...a, exampleSentences: ['B', 'C'] };
    expect(conjugationSignature(a)).toBe(conjugationSignature(b));
  });
});

describe('dedupeBySignature', () => {
  const sig = (x: { s: string }) => x.s;

  it('keeps first occurrence per signature, preserving order', () => {
    const items = [{ s: 'a' }, { s: 'b' }, { s: 'a' }, { s: 'c' }];
    expect(dedupeBySignature(items, 10, sig).map((x) => x.s)).toEqual(['a', 'b', 'c']);
  });

  it('slices to count after de-duping', () => {
    const items = [{ s: 'a' }, { s: 'b' }, { s: 'a' }, { s: 'c' }, { s: 'd' }];
    expect(dedupeBySignature(items, 2, sig).map((x) => x.s)).toEqual(['a', 'b']);
  });

  it('returns [] for empty input', () => {
    expect(dedupeBySignature([], 5, sig)).toEqual([]);
  });
});
